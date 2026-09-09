import type { CandlePoint, PrevDayLevels } from "./types";
import { resolveInstrumentKeys, fetchLtpBatch, mapPool, normalizeCandles } from "./upstox";
import { istDateKey, epochForIst, isCandleCompleted } from "./time";
import { SCANNER_CONFIG } from "./config";

export interface MultiFeed { symbol: string; candles1m: CandlePoint[]; warmup1m: CandlePoint[]; levels: PrevDayLevels | null; ltp: number | null; error: string | null; }
const API_BASE = "https://api.upstox.com";
let nextRequestAt = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt);
  nextRequestAt = slot + SCANNER_CONFIG.upstoxMinRequestIntervalMs;
  const delay = slot - now;
  if (delay > 0) await new Promise(r => setTimeout(r, delay));
}

async function fetch1m(url: string): Promise<CandlePoint[]> {
  await pace();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCANNER_CONFIG.requestTimeoutMs);
  try {
    const token = process.env.UPSTOX_ACCESS_TOKEN?.trim();
    const res = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeCandles(await res.json());
  } finally { clearTimeout(timer); }
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
    if (!existing) {
      groups.set(key, { t: epochForIst(dayKey(c.t), label).getTime(), label, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    } else {
      existing.h = Math.max(existing.h, c.h); existing.l = Math.min(existing.l, c.l); existing.c = c.c; existing.v += c.v;
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.t - b.t);
}

function previousLevels(prior: CandlePoint[]): PrevDayLevels | null {
  if (!prior.length) return null;
  const prevKey = dayKey(prior[prior.length - 1].t);
  const prev = prior.filter(c => dayKey(c.t) === prevKey);
  if (!prev.length) return null;
  return { pdh: Math.max(...prev.map(c => c.h)), pdl: Math.min(...prev.map(c => c.l)), prevClose: prev.at(-1)!.c, prevOpen: prev[0].o, dayKey: prevKey };
}

async function fetchSymbol(symbol: string, key: string, todayKey: string): Promise<MultiFeed> {
  try {
    const todayStart = epochForIst(todayKey, "00:00").getTime();
    const fromKey = istDateKey(new Date(todayStart - 5 * 86400000));
    const encoded = encodeURIComponent(key);
    const historical = await fetch1m(`${API_BASE}/v3/historical-candle/${encoded}/minutes/1/${todayKey}/${fromKey}`);
    let all = historical;
    let today = historical.filter(c => c.t >= todayStart);
    if (!today.length) {
      try {
        const intraday = await fetch1m(`${API_BASE}/v3/historical-candle/intraday/${encoded}/minutes/1`);
        today = intraday.filter(c => c.t >= todayStart);
        all = [...historical.filter(c => c.t < todayStart), ...today].sort((a, b) => a.t - b.t);
      } catch {}
    }
    const prior = all.filter(c => c.t < todayStart);
    const levels = previousLevels(prior);
    return { symbol, candles1m: today, warmup1m: prior, levels, ltp: today.at(-1)?.c ?? null, error: levels ? null : "previous day levels unavailable" };
  } catch (err) {
    return { symbol, candles1m: [], warmup1m: [], levels: null, ltp: null, error: (err as Error).message };
  }
}

export async function collectMultiMarketData(symbols: string[], dateKey: string, cutoff: Date, concurrency: number): Promise<{ feeds: MultiFeed[]; source: "UPSTOX" | "SIMULATION"; notes: string[] }> {
  if (!process.env.UPSTOX_ACCESS_TOKEN?.trim()) return { feeds: [], source: "SIMULATION", notes: ["UPSTOX_ACCESS_TOKEN is not configured"] };
  let keys = new Map<string, string>();
  try { keys = await resolveInstrumentKeys(symbols, SCANNER_CONFIG.requestTimeoutMs); } catch {}
  const feeds: MultiFeed[] = symbols.map(symbol => ({ symbol, candles1m: [], warmup1m: [], levels: null, ltp: null, error: null }));
  await mapPool(feeds, concurrency, async feed => {
    const key = keys.get(feed.symbol);
    if (!key) { feed.error = "instrument key unresolved"; return; }
    const result = await fetchSymbol(feed.symbol, key, dateKey);
    feed.candles1m = result.candles1m.filter(c => isCandleCompleted(c.t, 1, cutoff));
    feed.warmup1m = result.warmup1m; feed.levels = result.levels; feed.ltp = result.ltp; feed.error = result.error;
  });
  try {
    const keyList = symbols.map(s => keys.get(s)).filter((k): k is string => Boolean(k));
    const ltps = await fetchLtpBatch(keyList, Math.min(SCANNER_CONFIG.requestTimeoutMs, 1500));
    for (const f of feeds) { const key = keys.get(f.symbol); if (key && ltps.has(key)) f.ltp = ltps.get(key) ?? f.ltp; }
  } catch {}
  return { feeds, source: "UPSTOX", notes: ["1-minute base feed locally aggregated into 1M / 3M / 5M", `${feeds.filter(f => f.levels && f.candles1m.length).length}/${symbols.length} symbols usable`] };
}

export function buildTimeframeCandles(feed: MultiFeed, timeframe: 1 | 3 | 5, cutoff: Date): { candles: CandlePoint[]; warmup: CandlePoint[] } {
  const all = timeframe === 1 ? [...feed.warmup1m, ...feed.candles1m] : aggregate([...feed.warmup1m, ...feed.candles1m], timeframe);
  const todayKey = istDateKey(cutoff);
  return {
    candles: all.filter(c => dayKey(c.t) === todayKey && isCandleCompleted(c.t, timeframe, cutoff)),
    warmup: all.filter(c => dayKey(c.t) !== todayKey),
  };
}
