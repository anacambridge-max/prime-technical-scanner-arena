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
  /** Execution timeframe — strictly 5-minute candles. */
  timeframeMinutes: 5,

  /** NSE market + live scanning window (IST). */
  marketOpen: "09:15",
  scanStart: hhmm(process.env.SCAN_START, "09:15"),
  /** User requirement: live scan 09:15 -> 10:00, then results persist for the day. */
  scanEnd: hhmm(process.env.SCAN_END, "10:00"),
  marketClose: "15:30",

  /** 20 EMA (trend filter, on 5-minute closes). */
  emaPeriod: num(process.env.EMA_PERIOD, 20),
  emaSlopeLookback: 3,

  /** Volume: current completed candle vs rolling mean of previous N completed candles. */
  volumeRefCandles: num(process.env.VOLUME_REF_CANDLES, 20),
  volumeRefMinimum: 5, // need at least this many reference candles, else null

  /** Volume multiple classification bands. */
  volStrong: 1.5,
  volHigh: 2.0,
  volVeryHigh: 4.0,
  volExtreme: 6.0,

  /** Minimum volume multiple required on a breakout/breakdown candle. */
  breakoutVolMin: num(process.env.BREAKOUT_VOL_MIN, 1.5),
  continuationVolMin: num(process.env.CONTINUATION_VOL_MIN, 1.5),

  /** How close (%) price must be to PDH/PDL to count as "approaching". */
  nearLevelPct: num(process.env.NEAR_LEVEL_PCT, 0.75),

  /** Follow-through: completed candles after the trigger that must hold the level. */
  followThroughCandles: num(process.env.FOLLOW_THROUGH_CANDLES, 1),

  /** Continuation retest tolerance (%) around the broken level / EMA. */
  retestPct: num(process.env.RETEST_PCT, 0.35),
  continuationLookback: 12,

  /** Trade plan (display only — this dashboard never places orders). */
  riskReward: num(process.env.RISK_REWARD, 2),
  slBufferPct: num(process.env.SL_BUFFER_PCT, 0.15),

  /** Scan orchestration. */
  rescanSeconds: num(process.env.RESCAN_SECONDS, 45),
  minCandlesRequired: 5,
  upstoxConcurrency: 6,
  requestTimeoutMs: 9000,
  maxRetries: 3,
  eventLogLimit: 250,
} as const;

export type ScannerConfig = typeof SCANNER_CONFIG;
