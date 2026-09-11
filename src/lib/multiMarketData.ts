import type { CandlePoint, PrevDayLevels } from "./types";
import { resolveInstrumentKeys, mapPool, normalizeCandles } from "./upstox";
import { istDateKey, epochForIst, isCandleCompleted } from "./time";
import { SCANNER_CONFIG } from "./config";

export interface MultiFeed {
  symbol: string;
  candles1m: CandlePoint[];
  warmup1m: CandlePoint[];
  levels: PrevDayLevels | null;
  ltp: number | null;
  error: string | null;
}

export const MULTI_TIMEFRAMES = [1, 3, 5] as const;
const API_BASE = "https://api.upstox.com";
let nextRequestAt = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt);
  nextRequestAt = slot + SCANNER_CONFIG.upstoxMinRequestIntervalMs;
  const delay = slot - now;
  if (delay > 0) await new Promise(r => setTimeout(r, delay));
}

async function fetchJson(url: string): Promise<unknown> {
  await pace();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCANNER_CONFIG.requestTimeoutMs);
  try {
    const token = process.env.UPSTOX_ACCESS_TOKEN?.trim();
    const res = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetch1mIntraday(key: string): Promise<CandlePoint[]> {
  const v3 = normalizeCandles(await fetchJson(
    `${API_BASE}/v3/historical-candle/intraday/${encodeURIComponent(key)}/minutes/1`,
  ));
  if (v3.length) return v3;
  try {
    return normalizeCandles(await fetchJson(
      `${API_BASE}/v2/historical-candle/intraday/${encodeURIComponent(key)}/1minute`,
    ));
  } catch {
    return v3;
  }
}

async function fetchPreviousWarmup(key: string, todayKey: string): Promise<CandlePoint[]> {
  const todayStart = epochForIst(todayKey, "00:00").getTime();
  const fromKey = istDateKey(new Date(todayStart - 7 * 86400000));
  const candles = normalizeCandles(await fetchJson(
    `${API_BASE}/v3/historical-candle/${encodeURIComponent(key)}/minutes/1/${todayKey}/${fromKey}`,
  ));
  return candles.filter(c => c.t < todayStart);
}

function dayKey(t: number): string {
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function aggregate(candles: CandlePoint[], minutes: 3 | 5): CandlePoint[] {
  const groups = new Map<string, CandlePoint>();
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  for (const c of candles) {
    const parts = fmt.formatToParts(new Date(c.t));
    const h = Number(parts.find(p => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find(p => p.type === "minute")?.value ?? 0);
    const marketMinute = h * 60 + m - 555;
    if (marketMinute < 0 || marketMinute >= 375) continue;
    const bucket = Math.floor(marketMinute / minutes);
    const startMinutes = 555 + bucket * minutes;
    const bh = Math.floor(startMinutes / 60);
    const bm = startMinutes % 60;
    const label = `${bh.toString().padStart(2, "0")}:${bm.toString().padStart(2, "0")}`;
    const key = `${dayKey(c.t)}-${label}`;
    const existing = groups.get(key);
    if (!existing) groups.set(key, { t: epochForIst(dayKey(c.t), label).getTime(), label, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    else { existing.h = Math.max(existing.h, c.h); existing.l = Math.min(existing.l, c.l); existing.c = c.c; existing.v += c.v; }
  }
  return Array.from(groups.values()).sort((a, b) => a.t - b.t);
}

function previousLevels(prior: CandlePoint[]): PrevDayLevels | null {
  if (!prior.length) return null;
  const prevKey = dayKey(prior[prior.length - 1].t);
  const prev = prior.filter(c => dayKey(c.t) === prevKey);
  if (!prev.length) return null;
  return { pdh: Math.max(...prev.map(c => c.h)), pdl: Math.min(...prev.map(c => c.l)), prevClose: prev[prev.length - 1].c, prevOpen: prev[0].o, dayKey: prevKey };
}

function likelyLevelBreak(candles: CandlePoint[], levels: PrevDayLevels | null): boolean {
  if (!levels || !candles.length) return false;
  return candles.some(c => c.h >= levels.pdh || c.l <= levels.pdl || c.c >= levels.pdh || c.c <= levels.pdl);
}

interface DailyQuote { pdh: number; pdl: number; prevClose: number; prevOpen: number; dayKey: string; }

type DailyQuoteItem = { instrument_token?: string; prev_ohlc?: { open?: number; high?: number; low?: number; close?: number; ts?: string | number } };

async function fetchDailyLevels(keys: Map<string, string>): Promise<Map<string, DailyQuote>> {
  const result = new Map<string, DailyQuote>();
  const entries = Array.from(keys.entries());
  if (!entries.length) return result;

  // Keep the multi-key OHLC URL comfortably below proxy/URL-length limits.
  // Upstox accepts multiple instrument keys in one request, so 50-key chunks
  // still reduce this from 206 requests to only a handful of calls.
  const chunkSize = 50;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    try {
      const instrumentKeys = chunk.map(([, key]) => key).join(",");
      const payload = await fetchJson(
        `${API_BASE}/v3/market-quote/ohlc?instrument_key=${encodeURIComponent(instrumentKeys)}&interval=1d`,
      ) as { data?: Record<string, DailyQuoteItem> };
      const data = payload?.data ?? {};
      for (const [symbol, instrumentKey] of chunk) {
        const item = Object.entries(data).find(([dataKey, value]) => dataKey === instrumentKey || value?.instrument_token === instrumentKey)?.[1];
        const prev = item?.prev_ohlc;
        if (!prev || !Number.isFinite(Number(prev.high)) || !Number.isFinite(Number(prev.low)) || !Number.isFinite(Number(prev.close))) continue;
        result.set(symbol, {
          pdh: Number(prev.high),
          pdl: Number(prev.low),
          prevClose: Number(prev.close),
          prevOpen: Number(prev.open ?? prev.close),
          dayKey: prev.ts ? dayKey(typeof prev.ts === "number" ? prev.ts : Date.parse(String(prev.ts))) : "",
        });
      }
    } catch {
      // Continue with the remaining chunks; historical warmup remains the
      // fallback for candidates that later need a previous-session level.
    }
  }
  return result;
}

export async function collectMultiMarketData(symbols: string[], dateKey: string, cutoff: Date, concurrency: number): Promise<{ feeds: MultiFeed[]; source: "UPSTOX" | "SIMULATION"; notes: string[] }> {
  if (!process.env.UPSTOX_ACCESS_TOKEN?.trim()) return { feeds: [], source: "SIMULATION", notes: ["UPSTOX_ACCESS_TOKEN is not configured"] };
  let keys = new Map<string, string>();
  try { keys = await resolveInstrumentKeys(symbols, SCANNER_CONFIG.requestTimeoutMs); } catch {}

  const feeds: MultiFeed[] = symbols.map(symbol => ({ symbol, candles1m: [], warmup1m: [], levels: null, ltp: null, error: null }));

  // Phase 1: batched daily quote supplies PDH/PDL; one current-day 1M
  // request per stock supplies all 1M/3M/5M candles.
  const dailyLevels = await fetchDailyLevels(keys);
  await mapPool(feeds, Math.max(1, concurrency), async feed => {
    const key = keys.get(feed.symbol);
    if (!key) { feed.error = "instrument key unresolved"; return; }
    const daily = dailyLevels.get(feed.symbol);
    if (daily) feed.levels = daily;
    try {
      const current = await fetch1mIntraday(key);
      feed.candles1m = current.filter(c => isCandleCompleted(c.t, 1, cutoff));
      feed.ltp = feed.candles1m[feed.candles1m.length - 1]?.c ?? null;
    } catch (err) {
      feed.error = (err as Error).message;
    }
  });

  // Phase 2: only actual PDH/PDL touches need historical 1M warmup for the
  // PRIME EMA/volume checks. Non-candidates cannot produce a PDH/PDL signal.
  const candidates = feeds.filter(f => likelyLevelBreak(f.candles1m, f.levels));
  await mapPool(candidates, Math.max(1, Math.min(concurrency, 8)), async feed => {
    const key = keys.get(feed.symbol);
    if (!key) return;
    try {
      feed.warmup1m = await fetchPreviousWarmup(key, dateKey);
      if (!feed.levels) feed.levels = previousLevels(feed.warmup1m);
      if (!feed.levels) feed.error = "previous day levels unavailable";
    } catch (err) {
      feed.error = (err as Error).message;
    }
  });

  const resolved = feeds.filter(f => f.levels).length;
  const usable = feeds.filter(f => f.levels && f.candles1m.length).length;
  return {
    feeds,
    source: "UPSTOX",
    notes: [
      `Fast staged feed: batched daily PDH/PDL quotes + current-day 1M requests; historical EMA/volume warmup only for PDH/PDL candidates`,
      `${candidates.length} stocks touched/crossed PDH/PDL and required historical warmup`,
      `${resolved}/${symbols.length} symbols have PDH/PDL levels; ${usable}/${symbols.length} symbols have usable completed candles`,
    ],
  };
}

export function buildTimeframeCandles(feed: MultiFeed, timeframe: 1 | 3 | 5, cutoff: Date): { candles: CandlePoint[]; warmup: CandlePoint[] } {
  const all = timeframe === 1 ? [...feed.warmup1m, ...feed.candles1m] : aggregate([...feed.warmup1m, ...feed.candles1m], timeframe);
  const todayKey = istDateKey(cutoff);
  return { candles: all.filter(c => dayKey(c.t) === todayKey && isCandleCompleted(c.t, timeframe, cutoff)), warmup: all.filter(c => dayKey(c.t) !== todayKey) };
}
