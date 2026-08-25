import type { PrevDayLevels, CandlePoint } from "./types";
import { fetchIntraday5m, fetchHistorical5m, normalizeCandles } from "./upstox";

/**
 * Fast bootstrap for the live scanner.
 *
 * One historical 5m request now supplies BOTH:
 *   1) the previous-session candles used to warm the 20 EMA/volume reference;
 *   2) the previous-session OHLC used for PDH/PDL.
 *
 * This removes the old third request to the daily endpoint and, importantly,
 * uses the same retry/backoff path as the rest of the Upstox client. A 429 on
 * the warmup request must not silently leave every 20 EMA as null.
 */
export async function fetchRecent5mWithLevelsFast(
  instrumentKey: string,
  todayKey: string,
  timeoutMs: number,
  maxRetries: number,
): Promise<{ candles: CandlePoint[]; warmup: CandlePoint[]; levels: PrevDayLevels | null }> {
  const todayStart = new Date(`${todayKey}T00:00:00+05:30`).getTime();

  const [intraday, historical] = await Promise.all([
    fetchIntraday5m(instrumentKey, timeoutMs, maxRetries),
    fetchHistorical5m(instrumentKey, todayKey, timeoutMs, Math.max(2, maxRetries)),
  ]);

  const prior = historical.filter((c) => c.t < todayStart);
  if (!prior.length) {
    return { candles: intraday, warmup: [], levels: null };
  }

  // Pick the latest trading session represented in the historical response.
  // This automatically handles weekends/holidays without assuming yesterday
  // was a trading day.
  const prevDayKey = new Date(prior[prior.length - 1].t)
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const prevDay = prior.filter(
    (c) => new Date(c.t).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === prevDayKey
  );
  if (!prevDay.length) return { candles: intraday, warmup: prior.slice(-160), levels: null };

  const levels: PrevDayLevels = {
    pdh: Math.max(...prevDay.map((c) => c.h)),
    pdl: Math.min(...prevDay.map((c) => c.l)),
    prevClose: prevDay[prevDay.length - 1].c,
    prevOpen: prevDay[0].o,
    dayKey: prevDayKey,
  };

  // Keep enough prior-session bars to seed a standard 20 EMA and the
  // 20-candle volume reference before today's first completed candle.
  const warmup = prior.slice(-160);

  return { candles: intraday, warmup, levels };
}
