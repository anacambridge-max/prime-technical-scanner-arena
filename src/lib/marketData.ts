import type { CandlePoint, PrevDayLevels } from "./types";
import { upstoxConfigured, resolveInstrumentKeys, fetchRecent5mWithLevels, fetchLtpBatch, mapPool } from "./upstox";
import { simulateSymbol } from "./simulate";
import { isCandleCompleted } from "./time";

export interface SymbolFeed { symbol: string; candles: CandlePoint[]; warmup: CandlePoint[]; levels: PrevDayLevels | null; ltp: number | null; error: string | null; }
export interface CollectedMarketData { feeds: SymbolFeed[]; source: "UPSTOX" | "SIMULATION"; notes: string[]; }
export interface CollectOptions { concurrency: number; requestTimeoutMs: number; maxRetries: number; timeframeMinutes: number; budgetMs: number; }

function completedOnly(candles: CandlePoint[], cutoff: Date, timeframeMinutes: number): CandlePoint[] { return candles.filter((c) => isCandleCompleted(c.t, timeframeMinutes, cutoff)); }

async function collectLive(symbols: string[], dateKey: string, cutoff: Date, opts: CollectOptions): Promise<CollectedMarketData> {
  const notes: string[] = [];
  const feeds: SymbolFeed[] = symbols.map((symbol) => ({ symbol, candles: [], warmup: [], levels: null, ltp: null, error: null }));
  let keys: Map<string, string> = new Map();
  try { keys = await resolveInstrumentKeys(symbols, opts.requestTimeoutMs); } catch (err) { notes.push(`instrument resolution failed: ${(err as Error).message}`); }
  const deadline = Date.now() + opts.budgetMs;
  await mapPool(feeds, opts.concurrency, async (feed) => {
    if (Date.now() >= deadline) { feed.error = "scan budget exceeded"; return; }
    const key = keys.get(feed.symbol);
    if (!key) { feed.error = "instrument key unresolved"; return; }
    try {
      const result = await fetchRecent5mWithLevels(key, dateKey, opts.requestTimeoutMs, opts.maxRetries);
      feed.candles = completedOnly(result.candles, cutoff, opts.timeframeMinutes);
      feed.warmup = result.warmup;
      feed.levels = result.levels;
      if (feed.candles.length === 0) feed.error = "no usable completed 5-minute candles";
    } catch (err) { feed.error = (err as Error).message; }
  });
  try {
    const keyList = symbols.map((s) => keys.get(s)).filter((k): k is string => Boolean(k));
    const ltpByKey = await fetchLtpBatch(keyList, Math.min(opts.requestTimeoutMs, 5000));
    for (const feed of feeds) { const key = keys.get(feed.symbol); if (key && ltpByKey.has(key)) feed.ltp = ltpByKey.get(key) ?? null; }
  } catch { /* display-only */ }
  const resolved = feeds.filter((f) => f.candles.length > 0 && f.levels).length;
  notes.push(`upstox feeds usable: ${resolved}/${feeds.length}`);
  return { feeds, source: "UPSTOX", notes };
}

function collectSimulated(symbols: string[], dateKey: string, cutoff: Date): CollectedMarketData {
  const feeds: SymbolFeed[] = symbols.map((symbol) => {
    try { const sim = simulateSymbol(symbol, dateKey, cutoff.getTime()); return { symbol, candles: sim.candles, warmup: sim.warmup, levels: sim.levels, ltp: sim.candles.length ? sim.candles[sim.candles.length - 1].c : null, error: null }; }
    catch (err) { return { symbol, candles: [], warmup: [], levels: null, ltp: null, error: `simulation failed: ${(err as Error).message}` }; }
  });
  return { feeds, source: "SIMULATION", notes: ["deterministic simulation feed"] };
}

export async function collectMarketData(symbols: string[], dateKey: string, cutoff: Date, opts: CollectOptions): Promise<CollectedMarketData> {
  if (!upstoxConfigured()) return collectSimulated(symbols, dateKey, cutoff);
  try { return await collectLive(symbols, dateKey, cutoff, opts); }
  catch (err) { return { feeds: symbols.map((symbol) => ({ symbol, candles: [], warmup: [], levels: null, ltp: null, error: `upstox collection failed: ${(err as Error).message}` })), source: "UPSTOX", notes: ["live collection failed; previous persisted scan is preserved"] }; }
}
