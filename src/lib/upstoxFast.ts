import type { PrevDayLevels, CandlePoint } from "./types";
import { fetchHistorical5m } from "./upstox";

/**
 * Fast bootstrap for the live scanner.
 *
 * One V3 historical 5m request supplies BOTH:
 *   1) today's completed 5m candles;
 *   2) previous-session candles used to warm the 20 EMA/volume reference and
 *      calculate PDH/PDL.
 *
 * The previous implementation made a second intraday request for every stock.
 * Across the 206-stock F&O universe that doubled the Upstox request load and
 * forced the scanner to rotate through only a fraction of the universe per
 * 45-second pass. Keeping this path to one candle request per symbol lets the
 * full F&O universe be evaluated inside the serverless time budget.
 */
export async function fetchRecent5mWithLevelsFast(
  instrumentKey: string,
  todayKey: string,
  timeoutMs: number,
  maxRetries: number,
): Promise<{ candles: CandlePoint[]; warmup: CandlePoint[]; levels: PrevDayLevels | null }> {
  const todayStart = new Date(`${todayKey}T00:00:00+05:30`).getTime();

  const historical = await fetchHistorical5m(
    instrumentKey,
    todayKey,
    timeoutMs,
    Math.max(2, maxRetries),
  );

  const today = historical.filter((c) => c.t >= todayStart);
  const prior = historical.filter((c) => c.t < todayStart);

  if (!prior.length) {
    return { candles: today, warmup: [], levels: null };
  }

  // Pick the latest trading session represented in the historical response.
  // This automatically handles weekends/holidays without assuming yesterday
  // was a trading day.
  const prevDayKey = new Date(prior[prior.length - 1].t)
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const prevDay = prior.filter(
    (c) => new Date(c.t).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === prevDayKey
  );
  if (!prevDay.length) {
    return { candles: today, warmup: prior.slice(-160), levels: null };
  }

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

  return { candles: today, warmup, levels };
}
