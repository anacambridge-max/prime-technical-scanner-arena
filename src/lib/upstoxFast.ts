import type { PrevDayLevels, CandlePoint } from "./types";
import { fetchHistorical5m, fetchIntraday5m } from "./upstox";

/**
 * Fast bootstrap for the live scanner.
 *
 * Historical V3 is used for previous-session warmup + PDH/PDL. The current
 * session is explicitly sourced from Upstox's intraday V3 endpoint when the
 * historical response does not contain today's candles. This matters because
 * the scanner must see the first completed 5-minute candle at 09:20 rather
 * than waiting for the historical endpoint to expose the current session.
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

  let today = historical.filter((c) => c.t >= todayStart);
  const prior = historical.filter((c) => c.t < todayStart);

  // V3 intraday is the authoritative current-session feed. Use it whenever
  // historical V3 has not yet exposed today's candles (or returns a stale
  // current-session slice). This keeps 09:20/09:25/... signals live.
  if (today.length === 0) {
    try {
      const intraday = await fetchIntraday5m(instrumentKey, timeoutMs, maxRetries);
      today = intraday.filter((c) => c.t >= todayStart);
    } catch {
      // Preserve the historical result/error path if intraday is unavailable.
    }
  }

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
