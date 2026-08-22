/**
 * Market data orchestration: turns the symbol universe into per-symbol
 * completed 5-minute candles + PDH/PDL levels.
 *
 * Resilience rules:
 *  - one bad symbol NEVER breaks the scan (feeds carry per-symbol errors);
 *  - only COMPLETED candles (close time <= scan cutoff) reach the engine;
 *  - PDH/PDL come from the previous COMPLETED daily candle, cached per day;
 *  - prior-session 5-minute candles (warmup) are fetched once per day and
 *    cached, so the 20 EMA + volume reference are valid from 09:15 itself.
 */

import { db } from "@/db";
import { kvStore } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { CandlePoint, PrevDayLevels } from "./types";
import {
  upstoxConfigured,
  resolveInstrumentKeys,
  fetchIntraday5m,
  fetchPrevDayLevels,
  fetchLtpBatch,
  mapPool,
} from "./upstox";
import { simulateSymbol } from "./simulate";
import { istDateKey, epochForIst, isCandleCompleted } from "./time";

export interface SymbolFeed {
  symbol: string;
  candles: CandlePoint[];
  warmup: CandlePoint[];
  levels: PrevDayLevels | null;
  ltp: number | null;
  error: string | null;
}

export interface CollectedMarketData {
  feeds: SymbolFeed[];
  source: "UPSTOX" | "SIMULATION";
  notes: string[];
}

interface DayCache {
  levels: Record<string, PrevDayLevels>;
  warmup: Record<string, CandlePoint[]>;
}

async function readDayCache(dateKey: string): Promise<DayCache | null> {
  try {
    const rows = await db
      .select()
      .from(kvStore)
      .where(eq(kvStore.key, `DAYCACHE:${dateKey}`));
    if (rows.length && rows[0].value) return rows[0].value as DayCache;
  } catch {
    // cache is best-effort
  }
  return null;
}

async function writeDayCache(dateKey: string, cache: DayCache): Promise<void> {
  try {
    await db
      .insert(kvStore)
      .values({ key: `DAYCACHE:${dateKey}`, value: cache, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: kvStore.key,
        set: { value: cache, updatedAt: new Date() },
      });
  } catch {
    // ignore cache write failures
  }
}

export interface CollectOptions {
  concurrency: number;
  requestTimeoutMs: number;
  maxRetries: number;
  timeframeMinutes: number;
  budgetMs: number;
}

/** Filter to COMPLETED candles relative to the scan cutoff. */
function completedOnly(
  candles: CandlePoint[],
  cutoff: Date,
  timeframeMinutes: number
): CandlePoint[] {
  return candles.filter((c) => isCandleCompleted(c.t, timeframeMinutes, cutoff));
}

async function collectLive(
  symbols: string[],
  dateKey: string,
  cutoff: Date,
  opts: CollectOptions
): Promise<CollectedMarketData> {
  const notes: string[] = [];
  const feeds: SymbolFeed[] = symbols.map((s) => ({
    symbol: s,
    candles: [],
    warmup: [],
    levels: null,
    ltp: null,
    error: null,
  }));

  // 1) Resolve instrument keys (DB cached).
  let keys: Map<string, string> = new Map();
  try {
    keys = await resolveInstrumentKeys(symbols, opts.requestTimeoutMs);
  } catch (err) {
    notes.push(`instrument resolution failed: ${(err as Error).message}`);
  }

  // 2) Day cache: PDH/PDL + warmup candles (fetched once per trading day).
  let cache = await readDayCache(dateKey);
  if (!cache) {
    cache = { levels: {}, warmup: {} };
    const deadline = Date.now() + opts.budgetMs;
    await mapPool(symbols, opts.concurrency, async (symbol) => {
      if (Date.now() > deadline) return;
      const key = keys.get(symbol);
      if (!key) return;
      try {
        const lv = await fetchPrevDayLevels(
          key,
          dateKey,
          opts.requestTimeoutMs,
          opts.maxRetries
        );
        if (lv) cache!.levels[symbol] = lv;
      } catch {
        // single symbol failure is isolated
      }
      try {
        if (Date.now() > deadline) return;
        // Warmup: last ~4 days of 5-minute candles (excludes today).
        const from = istDateKey(
          new Date(epochForIst(dateKey, "00:00").getTime() - 6 * 86400000)
        );
        const to = istDateKey(
          new Date(epochForIst(dateKey, "00:00").getTime() - 86400000)
        );
        const keyEsc = encodeURIComponent(key);
        const urls = [
          `https://api.upstox.com/v3/historical-candle/${keyEsc}/minutes/5/${to}/${from}`,
          `https://api.upstox.com/v2/historical-candle/${keyEsc}/5minute/${to}/${from}`,
        ];
        for (const url of urls) {
          try {
            const res = await fetch(url, {
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${process.env.UPSTOX_ACCESS_TOKEN?.trim()}`,
              },
              cache: "no-store",
            });
            if (!res.ok) continue;
            const payload: unknown = await res.json();
            const { normalizeCandles } = await import("./upstox");
            const dayStart = epochForIst(dateKey, "00:00").getTime();
            const candles = normalizeCandles(payload).filter(
              (c) => c.t < dayStart
            );
            if (candles.length > 0) {
              cache!.warmup[symbol] = candles.slice(-160);
              break;
            }
          } catch {
            // try next url
          }
        }
      } catch {
        // isolated
      }
    });
    await writeDayCache(dateKey, cache);
  }

  // 3) Intraday candles per symbol (fresh every scan).
  const deadline = Date.now() + opts.budgetMs;
  await mapPool(feeds, opts.concurrency, async (feed) => {
    if (Date.now() > deadline) {
      feed.error = "scan budget exceeded";
      return;
    }
    const key = keys.get(feed.symbol);
    if (!key) {
      feed.error = "instrument key unresolved";
      return;
    }
    try {
      const raw = await fetchIntraday5m(key, opts.requestTimeoutMs, opts.maxRetries);
      feed.candles = completedOnly(raw, cutoff, opts.timeframeMinutes).filter(
        (c) => c.t >= epochForIst(dateKey, "00:00").getTime()
      );
      if (feed.candles.length === 0) {
        feed.error = "no usable 5-minute candles";
      }
    } catch (err) {
      feed.error = (err as Error).message;
    }
    const lv = cache!.levels[feed.symbol];
    if (lv) feed.levels = lv;
    feed.warmup = cache!.warmup[feed.symbol] ?? [];
  });

  // 4) Optional live LTP ticks (display only; never for confirmations).
  try {
    const keyList = symbols
      .map((s) => keys.get(s))
      .filter((k): k is string => Boolean(k));
    const ltpByKey = await fetchLtpBatch(keyList, opts.requestTimeoutMs);
    for (const feed of feeds) {
      const key = keys.get(feed.symbol);
      if (key && ltpByKey.has(key)) feed.ltp = ltpByKey.get(key) ?? null;
    }
  } catch {
    // optional
  }

  const resolved = feeds.filter((f) => !f.error || f.candles.length > 0).length;
  notes.push(`upstox feeds ok: ${resolved}/${feeds.length}`);
  return { feeds, source: "UPSTOX", notes };
}

function collectSimulated(
  symbols: string[],
  dateKey: string,
  cutoff: Date
): CollectedMarketData {
  const feeds: SymbolFeed[] = symbols.map((symbol) => {
    try {
      const sim = simulateSymbol(symbol, dateKey, cutoff.getTime());
      return {
        symbol,
        candles: sim.candles,
        warmup: sim.warmup,
        levels: sim.levels,
        ltp: sim.candles.length ? sim.candles[sim.candles.length - 1].c : null,
        error: null,
      };
    } catch (err) {
      return {
        symbol,
        candles: [],
        warmup: [],
        levels: null,
        ltp: null,
        error: `simulation failed: ${(err as Error).message}`,
      };
    }
  });
  return { feeds, source: "SIMULATION", notes: ["deterministic simulation feed"] };
}

export async function collectMarketData(
  symbols: string[],
  dateKey: string,
  cutoff: Date,
  opts: CollectOptions
): Promise<CollectedMarketData> {
  if (upstoxConfigured()) {
    try {
      return await collectLive(symbols, dateKey, cutoff, opts);
    } catch {
      // fall through to an empty-but-honest live result (callers keep last data)
      return {
        feeds: symbols.map((s) => ({
          symbol: s,
          candles: [],
          warmup: [],
          levels: null,
          ltp: null,
          error: "upstox unavailable",
        })),
        source: "UPSTOX",
        notes: ["live collection crashed; see per-symbol errors"],
      };
    }
  }
  return collectSimulated(symbols, dateKey, cutoff);
}
