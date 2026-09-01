/**
 * Central scanner configuration. Every threshold used by the Prime Technical
 * engine lives here so it can be tuned in one place.
 */

function num(envValue: string | undefined, fallback: number): number {
  if (envValue == null || envValue.trim() === "") return fallback;
  const n = Number(envValue);
  return Number.isFinite(n) ? n : fallback;
}

function hhmm(envValue: string | undefined, fallback: string): string {
  if (envValue && /^\d{1,2}:\d{2}$/.test(envValue.trim())) return envValue.trim();
  return fallback;
}

export const SCANNER_CONFIG = {
  timeframeMinutes: 5,
  marketOpen: "09:15",
  scanStart: hhmm(process.env.SCAN_START, "09:15"),
  scanEnd: hhmm(process.env.SCAN_END, "10:00"),
  marketClose: "15:30",
  emaPeriod: num(process.env.EMA_PERIOD, 20),
  emaSlopeLookback: 3,
  volumeRefCandles: num(process.env.VOLUME_REF_CANDLES, 20),
  volumeRefMinimum: 5,
  volStrong: 1.5,
  volHigh: 2.0,
  volVeryHigh: 4.0,
  volExtreme: 6.0,
  breakoutVolMin: num(process.env.BREAKOUT_VOL_MIN, 1.5),
  continuationVolMin: num(process.env.CONTINUATION_VOL_MIN, 1.5),
  nearLevelPct: num(process.env.NEAR_LEVEL_PCT, 0.75),
  // Bullish PDH breakouts are confirmed on the first completed 5-minute
  // candle itself when volume + 20 EMA conditions are satisfied. No extra
  // follow-through candle is required. A later close back below PDH still
  // invalidates the signal through the engine's failure check.
  followThroughCandles: num(process.env.FOLLOW_THROUGH_CANDLES, 0),
  retestPct: num(process.env.RETEST_PCT, 0.35),
  continuationLookback: 12,
  riskReward: num(process.env.RISK_REWARD, 2),
  slBufferPct: num(process.env.SL_BUFFER_PCT, 0.15),
  rescanSeconds: num(process.env.RESCAN_SECONDS, 45),

  // A single completed 5-minute candle is enough to evaluate a symbol.
  // Therefore the 09:15 candle becomes eligible at 09:20. This is important:
  // do not wait for 5 completed candles (09:40) just to start showing WATCH /
  // SETUP signals. The 20 EMA and volume reference are already warmed from
  // previous-session candles, so opening-minute analysis is valid.
  minCandlesRequired: 1,

  // Upstox standard APIs allow 50 requests/sec and 500 requests/minute.
  // Keep concurrency modest AND pace every HTTP request globally inside the
  // serverless worker. This avoids burst 429s when each symbol needs both
  // intraday and historical candle data.
  upstoxConcurrency: 4,
  upstoxMinRequestIntervalMs: 120,
  requestTimeoutMs: 3000,
  maxRetries: 1,
  eventLogLimit: 250,
} as const;

export type ScannerConfig = typeof SCANNER_CONFIG;
