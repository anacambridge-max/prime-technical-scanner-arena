import type { CandlePoint, PrevDayLevels } from "./types";
import { resolveInstrumentKeys, mapPool, normalizeCandles, fetchPrevDayLevels } from "./upstox";
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
const FEED_TIMEOUT_MS = Math.max(8000, SCANNER_CONFIG.requestTimeoutMs);
let nextRequestAt = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt);
  nextRequestAt = slot + SCANNER_CONFIG.upstoxMinRequestIntervalMs;
  const delay = slot - now;
  if (delay > 0) await new Promise(r => setTimeout(r, delay));
}

class FeedHttpError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "FeedHttpError"; }
}

function errorText(err: unknown): string {
  if (err instanceof FeedHttpError) return err.message;
  if (err instanceof Error && err.name === "AbortError") return "request timeout";
  return err instanceof Error ? err.message : String(err);
}

async function fetchJson(url: string): Promise<unknown> {
  await pace();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const token = process.env.UPSTOX_ACCESS_TOKEN?.trim();
    if (!token) throw new Error("UPSTOX_ACCESS_TOKEN is not configured");
    const res = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const detail = body.replace(/\s+/g, " ").slice(0, 180);
      throw new FeedHttpError(res.status, `HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function fetch1mIntraday(key: string): Promise<CandlePoint[]> {
  const encoded = encodeURIComponent(key);
  let v3Error: unknown = null;
  try {
    const v3 = normalizeCandles(await fetchJson(`${API_BASE}/v3/historical-candle/intraday/${encoded}/minutes/1`));
    if (v3.length) return v3;
  } catch (err) { v3Error = err; }

  // Never turn a 429 into another request. If the token is rate-limited,
  // trying V2 for the same symbol only makes the quota problem worse.
  if (v3Error instanceof FeedHttpError && v3Error.status === 429) throw v3Error;
  try {
    const v2 = normalizeCandles(await fetchJson(`${API_BASE}/v2/historical-candle/intraday/${encoded}/1minute`));
    if (v2.length) return v2;
    if (v3Error) throw v3Error;
    return v2;
  } catch (v2Error) {
    if (v3Error) throw new Error(`V3 ${errorText(v3Error)}; V2 ${errorText(v2Error)}`);
    throw v2Error;
  }
}

async function fetchPreviousWarmup(key: string, todayKey: string): Promise<CandlePoint[]> {
  const todayStart = epochForIst(todayKey, "00:00").getTime();
  const fromKey = istDateKey(new Date(todayStart - 7 * 86400000));
  const candles = normalizeCandles(await fetchJson(`${API_BASE}/v3/historical-candle/${encodeURIComponent(key)}/minutes/1/${todayKey}/${fromKey}`));
  return candles.filter(c => c.t < todayStart);
}

function dayKey(t: number): string { return new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); }

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

async function fetchDailyLevels(keys: Map<string, string>): Promise<{ levels: Map<string, DailyQuote>; errors: string[]; rateLimited: boolean }> {
  const result = new Map<string, DailyQuote>();
  const errors: string[] = [];
  let rateLimited = false;
  const entries = Array.from(keys.entries());
  if (!entries.length) return { levels: result, errors, rateLimited };

  const chunkSize = 50;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    try {
      const instrumentKeys = chunk.map(([, key]) => key).join(",");
      const payload = await fetchJson(`${API_BASE}/v3/market-quote/ohlc?instrument_key=${encodeURIComponent(instrumentKeys)}&interval=1d`) as { data?: Record<string, DailyQuoteItem> };
      const data = payload?.data ?? {};
      for (const [symbol, instrumentKey] of chunk) {
        const item = Object.entries(data).find(([dataKey, value]) => dataKey === instrumentKey || value?.instrument_token === instrumentKey)?.[1];
        const prev = item?.prev_ohlc;
        if (!prev || !Number.isFinite(Number(prev.high)) || !Number.isFinite(Number(prev.low)) || !Number.isFinite(Number(prev.close))) continue;
        result.set(symbol, { pdh: Number(prev.high), pdl: Number(prev.low), prevClose: Number(prev.close), prevOpen: Number(prev.open ?? prev.close), dayKey: prev.ts ? dayKey(typeof prev.ts === "number" ? prev.ts : Date.parse(String(prev.ts))) : "" });
      }
      if (Object.keys(data).length === 0) errors.push(`daily OHLC chunk ${i / chunkSize + 1}: empty data`);
    } catch (err) {
      const text = errorText(err);
      errors.push(`daily OHLC chunk ${i / chunkSize + 1}: ${text}`);
      if (err instanceof FeedHttpError && err.status === 429) { rateLimited = true; break; }
    }
  }
  return { levels: result, errors, rateLimited };
}

export async function collectMultiMarketData(symbols: string[], dateKey: string, cutoff: Date, concurrency: number): Promise<{ feeds: MultiFeed[]; source: "UPSTOX" | "SIMULATION"; notes: string[] }> {
  if (!process.env.UPSTOX_ACCESS_TOKEN?.trim()) return { feeds: [], source: "SIMULATION", notes: ["UPSTOX_ACCESS_TOKEN is not configured"] };

  let keys = new Map<string, string>();
  let keyResolutionError = "";
  try { keys = await resolveInstrumentKeys(symbols, FEED_TIMEOUT_MS); } catch (err) { keyResolutionError = errorText(err); }

  const feeds: MultiFeed[] = symbols.map(symbol => ({ symbol, candles1m: [], warmup1m: [], levels: null, ltp: null, error: null }));
  for (const feed of feeds) if (!keys.has(feed.symbol)) feed.error = "instrument key unresolved";

  const dailyResult = await fetchDailyLevels(keys);
  const dailyLevels = dailyResult.levels;

  // If the batched daily endpoint is rate-limited, stop here. Do NOT issue
  // 206 individual daily requests; that cascade guarantees more 429s.
  const missingLevelFeeds = dailyResult.rateLimited ? [] : feeds.filter(f => keys.has(f.symbol) && !dailyLevels.has(f.symbol));
  await mapPool(missingLevelFeeds, Math.max(1, Math.min(concurrency, 4)), async feed => {
    const key = keys.get(feed.symbol);
    if (!key) return;
    try {
      const levels = await fetchPrevDayLevels(key, dateKey, FEED_TIMEOUT_MS, 0);
      if (levels) feed.levels = levels;
    } catch (err) { feed.error = feed.error ?? `daily fallback: ${errorText(err)}`; }
  });
  for (const feed of feeds) {
    if (!feed.levels) {
      const daily = dailyLevels.get(feed.symbol);
      if (daily) feed.levels = daily;
    }
  }

  // If the account is already rate-limited on the daily batch, don't launch
  // 206 more intraday calls that are guaranteed to fail. Surface the reason.
  if (dailyResult.rateLimited) {
    const rateLimitedFeeds = feeds.filter(f => keys.has(f.symbol) && !f.error);
    for (const feed of rateLimitedFeeds) feed.error = "HTTP 429 (daily feed rate limited)";
  } else {
    await mapPool(feeds, Math.max(1, concurrency), async feed => {
      const key = keys.get(feed.symbol);
      if (!key) return;
      try {
        const current = await fetch1mIntraday(key);
        feed.candles1m = current.filter(c => isCandleCompleted(c.t, 1, cutoff));
        feed.ltp = feed.candles1m[feed.candles1m.length - 1]?.c ?? null;
        if (!feed.candles1m.length && !feed.error) feed.error = "no completed 1m candles returned";
      } catch (err) { feed.error = errorText(err); }
    });
  }

  const candidates = feeds.filter(f => likelyLevelBreak(f.candles1m, f.levels));
  await mapPool(candidates, Math.max(1, Math.min(concurrency, 4)), async feed => {
    const key = keys.get(feed.symbol);
    if (!key) return;
    try {
      feed.warmup1m = await fetchPreviousWarmup(key, dateKey);
      if (!feed.levels) feed.levels = previousLevels(feed.warmup1m);
      if (!feed.levels) feed.error = "previous day levels unavailable";
    } catch (err) { feed.error = errorText(err); }
  });

  const resolved = feeds.filter(f => f.levels).length;
  const usable = feeds.filter(f => f.levels && f.candles1m.length).length;
  const errorCounts = new Map<string, number>();
  for (const feed of feeds) {
    if (!feed.error) continue;
    const normalized = feed.error.replace(/HTTP 4\d\d:.*$/i, m => m.startsWith("HTTP 401") ? "HTTP 401" : m.startsWith("HTTP 429") ? "HTTP 429" : m.split(":")[0]);
    errorCounts.set(normalized, (errorCounts.get(normalized) ?? 0) + 1);
  }
  const errorSummary = Array.from(errorCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([msg, count]) => `${msg} (${count})`);
  const unresolved = feeds.filter(f => f.error === "instrument key unresolved").length;
  const notes = [
    `Fast staged feed: batched daily PDH/PDL quotes + current-day 1M requests; historical EMA/volume warmup only for PDH/PDL candidates`,
    `${candidates.length} stocks touched/crossed PDH/PDL and required historical warmup`,
    `${resolved}/${symbols.length} symbols have PDH/PDL levels; ${usable}/${symbols.length} symbols have usable completed candles`,
  ];
  if (keyResolutionError) notes.push(`Instrument resolver error: ${keyResolutionError}`);
  if (unresolved) notes.push(`Instrument keys unresolved: ${unresolved}/${symbols.length}`);
  if (dailyResult.errors.length) notes.push(`Daily PDH/PDL feed: ${dailyResult.errors.slice(0, 3).join(" | ")}`);
  if (errorSummary.length) notes.push(`Feed errors: ${errorSummary.join(" | ")}`);
  if (dailyResult.rateLimited) notes.push("Upstox rate limit reached on daily feed; intraday requests were intentionally stopped to prevent a 429 cascade. Scanner will retry on the next cycle.");
  if (!keys.size) notes.push("No Upstox instrument keys resolved; check instrument map and UPSTOX_ACCESS_TOKEN");

  return { feeds, source: "UPSTOX", notes };
}

export function buildTimeframeCandles(feed: MultiFeed, timeframe: 1 | 3 | 5, cutoff: Date): { candles: CandlePoint[]; warmup: CandlePoint[] } {
  const all = timeframe === 1 ? [...feed.warmup1m, ...feed.candles1m] : aggregate([...feed.warmup1m, ...feed.candles1m], timeframe);
  const todayKey = istDateKey(cutoff);
  return { candles: all.filter(c => dayKey(c.t) === todayKey && isCandleCompleted(c.t, timeframe, cutoff)), warmup: all.filter(c => dayKey(c.t) !== todayKey) };
}
