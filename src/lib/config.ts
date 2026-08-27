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
  followThroughCandles: num(process.env.FOLLOW_THROUGH_CANDLES, 1),
  retestPct: num(process.env.RETEST_PCT, 0.35),
  continuationLookback: 12,
  riskReward: num(process.env.RISK_REWARD, 2),
  slBufferPct: num(process.env.SL_BUFFER_PCT, 0.15),
  rescanSeconds: num(process.env.RESCAN_SECONDS, 45),
  minCandlesRequired: 5,

  // Upstox standard APIs allow 50 requests/sec and 500 requests/minute.
  // The scanner deliberately keeps concurrency below the per-second ceiling
  // because each symbol currently needs an intraday + historical request.
  // This prevents burst 429s while still completing a rotating batch well
  // inside the 45-second refresh window.
  upstoxConcurrency: 8,
  requestTimeoutMs: 3000,
  maxRetries: 2,
  eventLogLimit: 250,
} as const;

export type ScannerConfig = typeof SCANNER_CONFIG;
