import type { PrevDayLevels, CandlePoint } from "./types";
import { fetchIntraday5m, fetchPrevDayLevels } from "./upstox";

/** Fast bootstrap: today's 5m candles + previous-day levels, avoiding a huge multi-day 5m payload. */
export async function fetchRecent5mWithLevelsFast(
  instrumentKey: string,
  todayKey: string,
  timeoutMs: number,
  maxRetries: number,
): Promise<{ candles: CandlePoint[]; warmup: CandlePoint[]; levels: PrevDayLevels | null }> {
  const [candles, levels] = await Promise.all([
    fetchIntraday5m(instrumentKey, timeoutMs, maxRetries),
    fetchPrevDayLevels(instrumentKey, todayKey, timeoutMs, maxRetries),
  ]);
  return { candles, warmup: candles.slice(0, 25), levels };
}
