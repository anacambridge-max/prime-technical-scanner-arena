const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const SCANNER_CONFIG = {
  scanStart: "09:15",
  scanEnd: "15:30",
  emaPeriod: 20,
  volumeRefCandles: 20,
  volumeRefMinimum: 5,
  volHigh: 2.0,
  volVeryHigh: 4.0,
  volExtreme: 6.0,
  breakoutVolMin: num(process.env.BREAKOUT_VOL_MIN, 1.5),
  continuationVolMin: num(process.env.CONTINUATION_VOL_MIN, 1.5),
  nearLevelPct: num(process.env.NEAR_LEVEL_PCT, 0.75),
  followThroughCandles: num(process.env.FOLLOW_THROUGH_CANDLES, 0),
  retestPct: num(process.env.RETEST_PCT, 0.35),
  continuationLookback: 12,
  riskReward: num(process.env.RISK_REWARD, 2),
  slBufferPct: num(process.env.SL_BUFFER_PCT, 0.15),
  rescanSeconds: num(process.env.RESCAN_SECONDS, 45),
  minCandlesRequired: 1,
  // Upstox has both per-second and per-minute limits. Keep the scanner below
  // the stricter 500-request/minute ceiling. 125ms gives at most 480 launches
  // per minute in this invocation while still scanning the 206-stock universe
  // in roughly 26 seconds before any candidate warmup.
  upstoxConcurrency: 6,
  upstoxMinRequestIntervalMs: 125,
  requestTimeoutMs: 8000,
  maxRetries: 2,
} as const;
