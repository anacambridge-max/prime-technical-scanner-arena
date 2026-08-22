/**
 * Standalone engine unit tests (run: node --experimental-strip-types scripts/engine-test.ts)
 * Validates the strict Prime Technical confirmation rules — no fake confirmations.
 */
import { analyzeSymbol, type EngineConfig } from "../src/lib/prime";
import type { CandlePoint } from "../src/lib/types";

const CFG: EngineConfig = {
  timeframeMinutes: 5,
  emaPeriod: 20,
  emaSlopeLookback: 3,
  volumeRefCandles: 20,
  volumeRefMinimum: 5,
  volStrong: 1.5,
  volHigh: 2.0,
  volVeryHigh: 4.0,
  volExtreme: 6.0,
  breakoutVolMin: 1.5,
  continuationVolMin: 1.5,
  nearLevelPct: 0.75,
  followThroughCandles: 1,
  retestPct: 0.35,
  continuationLookback: 12,
  riskReward: 2,
  slBufferPct: 0.15,
  minCandlesRequired: 3,
};

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${extra ?? ""}`);
  }
}

function candle(minutesFrom915: number, o: number, h: number, l: number, c: number, v: number): CandlePoint {
  const base = new Date("2026-08-21T09:15:00+05:30").getTime();
  const t = base + minutesFrom915 * 60000;
  const hh = new Date(t + 330 * 60000);
  const label = `${String(hh.getUTCHours()).padStart(2, "0")}:${String(hh.getUTCMinutes()).padStart(2, "0")}`;
  return { t, label, o, h, l, c, v };
}

/** warmup: 25 flat candles at ~100 with vol 1000 -> EMA20 ~ 100 */
function warmup(priceDrift = 0): CandlePoint[] {
  const out: CandlePoint[] = [];
  let p = 100;
  for (let i = 0; i < 25; i++) {
    p += priceDrift;
    out.push(candle(-(26 - i) * 5, p - 0.1, p + 0.2, p - 0.3, p, 1000));
  }
  return out;
}

const levels = { pdh: 105, pdl: 95, prevClose: 100, prevOpen: 99.5, dayKey: "2026-08-20" };

/* 1) Clean PDH breakout + volume + follow-through -> CONFIRMED BUY */
{
  const today = [
    candle(0, 100, 101.2, 99.9, 101, 1100),
    candle(5, 101, 102.3, 100.8, 102, 1150),
    candle(10, 102, 103.4, 101.9, 103.2, 1200),
    candle(15, 103.2, 104.6, 103.1, 104.4, 1300),
    candle(20, 104.5, 105.9, 104.4, 105.6, 3200), // breakout candle
    candle(25, 105.5, 106.1, 105.2, 105.8, 1500), // follow-through holds
    candle(30, 105.8, 106.4, 105.6, 106.2, 1400),
  ];
  const r = analyzeSymbol({ symbol: "T1", candles: today, warmup: warmup(0.12), levels }, CFG);
  check("PDH breakout confirms BUY", r.status === "CONFIRMED" && r.direction === "BUY", `got ${r.status}/${r.direction}`);
  check("confirmation time is candle-based", r.details?.confirmationTime != null);
  check("entry/sl/target present, 1:2 RR", r.entry != null && r.stopLoss != null && r.target != null &&
    Math.abs((r.target! - r.entry!) - 2 * (r.entry! - r.stopLoss!)) < 0.05);
  check("pdh stays 105 (today wick 106.4 ignored)", r.pdh === 105);
  check("reason is specific", r.reason.includes("PDH breakout") && r.reason.includes("follow-through") && r.reason.includes("20 EMA"));
  check("confirmation checklist has 6 checks", (r.details?.checks.length ?? 0) >= 6);
}

/* 2) Failed breakout (closes back below PDH) -> never CONFIRMED */
{
  const today = [
    candle(0, 100, 101.2, 99.9, 101, 1100),
    candle(5, 101, 102.3, 100.8, 102, 1150),
    candle(10, 102, 104.9, 101.9, 104.6, 1200),
    candle(15, 104.6, 105.9, 104.4, 105.6, 3200), // breakout
    candle(20, 105.5, 105.7, 104.3, 104.7, 1600), // FAILS back below
    candle(25, 104.7, 104.9, 104.1, 104.4, 1200),
  ];
  const r = analyzeSymbol({ symbol: "T2", candles: today, warmup: warmup(0.1), levels }, CFG);
  check("failed breakout is NOT confirmed", r.status !== "CONFIRMED", `got ${r.status}`);
  check("failure note recorded", Boolean(r.details?.failureNote), r.details?.failureNote ?? "");
  check("no entry/target fabricated", r.entry == null && r.target == null);
}

/* 3) Near PDH + above EMA, no break -> WATCH only */
{
  const today = [
    candle(0, 100, 101, 99.8, 100.8, 1100),
    candle(5, 100.8, 102, 100.7, 101.8, 1200),
    candle(10, 101.8, 103, 101.7, 102.8, 2400),
    candle(15, 102.8, 104, 102.7, 103.8, 2300),
    candle(20, 103.8, 104.6, 103.7, 104.5, 2100), // wick max 104.6 < 105, dist ~0.48%
  ];
  const r = analyzeSymbol({ symbol: "T3", candles: today, warmup: warmup(0.1), levels }, CFG);
  check("near PDH above EMA => WATCH", r.status === "WATCH" && r.direction === "BUY", `got ${r.status}`);
  check("watch reason waits for breakout", r.reason.includes("waiting for PDH breakout confirmation"), r.reason);
}

/* 4) Breakout with weak volume -> SETUP, never CONFIRMED */
{
  const today = [
    candle(0, 103.5, 104, 103.2, 103.8, 900),
    candle(5, 103.8, 104.5, 103.7, 104.3, 900),
    candle(10, 104.3, 105.9, 104.2, 105.5, 1100), // only 1.1x
    candle(15, 105.5, 105.8, 105.3, 105.6, 950),
    candle(20, 105.6, 105.9, 105.4, 105.7, 900),
  ];
  const r = analyzeSymbol({ symbol: "T4", candles: today, warmup: warmup(0.1), levels }, CFG);
  check("weak-volume break stays SETUP", r.status === "SETUP", `got ${r.status}`);
  check("reason cites volume gap", r.reason.includes("below required 1.5x"), r.reason);
}

/* 5) Breakout on the latest candle -> SETUP (awaiting follow-through) */
{
  const today = [
    candle(0, 100, 101.2, 99.9, 101, 1100),
    candle(5, 101, 102.4, 100.9, 102.2, 1200),
    candle(10, 102.2, 103.8, 102.1, 103.6, 1300),
    candle(15, 103.6, 105.9, 103.5, 105.7, 3200), // breakout is the last candle
  ];
  const r = analyzeSymbol({ symbol: "T5", candles: today, warmup: warmup(0.12), levels }, CFG);
  check("fresh breakout without FT => SETUP", r.status === "SETUP", `got ${r.status}`);
  check("reason waits for follow-through", r.reason.includes("waiting for follow-through"), r.reason);
}

/* 6) Clean PDL breakdown -> CONFIRMED SELL (mirror) */
{
  const today = [
    candle(0, 100, 100.2, 98.9, 99.1, 1100),
    candle(5, 99.1, 99.3, 97.8, 98.0, 1200),
    candle(10, 98.0, 98.2, 96.7, 96.9, 1250),
    candle(15, 96.9, 97.1, 95.8, 96.0, 1300),
    candle(20, 96.0, 96.1, 94.1, 94.4, 3400), // breakdown candle
    candle(25, 94.3, 94.8, 93.9, 94.2, 1500), // holds below PDL
    candle(30, 94.2, 94.4, 93.5, 93.8, 1400),
  ];
  const r = analyzeSymbol({ symbol: "T6", candles: today, warmup: warmup(-0.12), levels }, CFG);
  check("PDL breakdown confirms SELL", r.status === "CONFIRMED" && r.direction === "SELL", `got ${r.status}/${r.direction}`);
  check("sell target below entry", r.target != null && r.entry != null && r.target < r.entry);
  check("sell SL above entry", r.stopLoss != null && r.entry != null && r.stopLoss > r.entry);
}

/* 7) Insufficient candles -> NONE (graceful) */
{
  const today = [candle(0, 100, 100.5, 99.8, 100.2, 1000)];
  const r = analyzeSymbol({ symbol: "T7", candles: today, warmup: warmup(), levels }, CFG);
  check("insufficient candles => NONE", r.status === "NONE", `got ${r.status}`);
}

/* 8) Incomplete-candle exclusion is handled upstream; engine sees only what it is given.
      Here: verify NO look-ahead — a later huge candle must not change an earlier decision. */
{
  const makeToday = (ftClose: number) => [
    candle(0, 100, 101.2, 99.9, 101, 1100),
    candle(5, 101, 102.3, 100.8, 102, 1150),
    candle(10, 102, 104.9, 101.9, 104.6, 1200),
    candle(15, 104.6, 105.9, 104.4, 105.6, 3200),
    candle(20, 105.5, 106.0, 105.3, ftClose, 1500),
  ];
  const confirmed = analyzeSymbol({ symbol: "T8", candles: makeToday(105.8), warmup: warmup(0.12), levels }, CFG);
  const failed = analyzeSymbol({ symbol: "T8", candles: makeToday(104.5), warmup: warmup(0.12), levels }, CFG);
  check("FT holding above PDH confirms", confirmed.status === "CONFIRMED");
  check("FT closing back below PDH rejects", failed.status !== "CONFIRMED");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
