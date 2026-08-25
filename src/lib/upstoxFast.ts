import type { PrevDayLevels, CandlePoint } from "./types";
import { fetchIntraday5m, fetchPrevDayLevels, normalizeCandles } from "./upstox";

/**
 * Fast bootstrap for the live scanner:
 * - today's completed 5m candles come from the intraday endpoint;
 * - previous-day levels come from the daily endpoint;
 * - a small historical 5m window supplies real prior-session candles for the
 *   20 EMA and volume-reference calculations.
 *
 * IMPORTANT: warmup must NEVER be today's candles. Using today's candles as
 * warmup makes the engine duplicate the opening session and can leave the
 * 20-EMA unavailable during the 09:15-10:00 scan window.
 */
export async function fetchRecent5mWithLevelsFast(
  instrumentKey: string,
  todayKey: string,
  timeoutMs: number,
  maxRetries: number,
): Promise<{ candles: CandlePoint[]; warmup: CandlePoint[]; levels: PrevDayLevels | null }> {
  const key = encodeURIComponent(instrumentKey);

  const todayStart = new Date(`${todayKey}T00:00:00+05:30`).getTime();
  const fromDate = new Date(todayStart - 5 * 86400000);
  const fromKey = fromDate.toISOString().slice(0, 10);

  const historicalUrl = `https://api.upstox.com/v3/historical-candle/${key}/minutes/5/${todayKey}/${fromKey}`;

  const [intraday, levels, historicalRaw] = await Promise.all([
    fetchIntraday5m(instrumentKey, timeoutMs, maxRetries),
    fetchPrevDayLevels(instrumentKey, todayKey, timeoutMs, maxRetries),
    fetch(historicalUrl, {
      headers: {
        Accept: "application/json",
        ...(process.env.UPSTOX_ACCESS_TOKEN?.trim()
          ? { Authorization: `Bearer ${process.env.UPSTOX_ACCESS_TOKEN.trim()}` }
          : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`historical 5m HTTP ${res.status}`);
      return res.json() as Promise<unknown>;
    }),
  ]);

  const historical = normalizeCandles(historicalRaw);
  const prior = historical.filter((c) => c.t < todayStart);

  // Use the latest completed prior-session candles only. 160 bars is more
  // than enough to seed a 20 EMA and a 20-candle volume reference while still
  // keeping the payload small.
  const warmup = prior.slice(-160);

  return { candles: intraday, warmup, levels };
}
