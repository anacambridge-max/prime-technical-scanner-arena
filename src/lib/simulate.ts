/**
 * Deterministic market simulator.
 *
 * ACTIVE ONLY WHEN UPSTOX_ACCESS_TOKEN IS NOT CONFIGURED — the UI clearly
 * labels this as SIMULATION. It exists so the dashboard, engine and failure
 * handling can be exercised end-to-end without credentials. When a real token
 * is configured, this module is never used.
 *
 * Data is deterministic per (symbol, date): every refresh generates the same
 * candles, so scanner state is stable across polls. Candles flow through the
 * SAME prime engine as live data — statuses are computed, never fabricated.
 */

import type { CandlePoint, PrevDayLevels } from "./types";
import { epochForIst, istTimeLabel } from "./time";

function hash32(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pattern =
  | "PDH_BREAK"
  | "PDL_BREAK"
  | "PDH_FAIL"
  | "PDL_FAIL"
  | "NEAR_PDH"
  | "NEAR_PDL"
  | "CHOP";

function pickPattern(r: number): Pattern {
  if (r < 0.05) return "PDH_BREAK";
  if (r < 0.1) return "PDL_BREAK";
  if (r < 0.125) return "PDH_FAIL";
  if (r < 0.15) return "PDL_FAIL";
  if (r < 0.31) return "NEAR_PDH";
  if (r < 0.47) return "NEAR_PDL";
  return "CHOP";
}

const CANDLE_MS = 5 * 60 * 1000;

function makeCandle(
  ms: number,
  o: number,
  c: number,
  spread: number,
  v: number
): CandlePoint {
  const hi = Math.max(o, c) + spread * 0.5;
  const lo = Math.min(o, c) - spread * 0.5;
  return {
    t: ms,
    label: istTimeLabel(new Date(ms)),
    o,
    h: hi,
    l: lo,
    c,
    v: Math.max(0, Math.round(v)),
  };
}

/**
 * Generate one trading day's 5-minute candles (all 76 slots) for a symbol,
 * plus previous-day levels. Only slots whose close is <= cutoffMs are
 * returned (completed candles only).
 */
export function simulateSymbol(symbol: string, dayKey: string, cutoffMs: number) {
  const baseSeed = hash32(`${symbol}|${dayKey}`);
  const rng = mulberry32(baseSeed);
  const pattern = pickPattern(rng());

  const base = 40 + (baseSeed % 3900) + (baseSeed % 97) / 100; // ₹40 – ₹3940
  const prevRangePct = 0.012 + rng() * 0.016;
  const prevOpen = base;
  const pdh = base * (1 + prevRangePct * (0.55 + rng() * 0.45));
  const pdl = base * (1 - prevRangePct * (0.55 + rng() * 0.45));
  const prevClose = pdl + (pdh - pdl) * (0.25 + rng() * 0.5);

  const levels: PrevDayLevels = {
    pdh: Math.round(pdh * 100) / 100,
    pdl: Math.round(pdl * 100) / 100,
    prevClose: Math.round(prevClose * 100) / 100,
    prevOpen: Math.round(prevOpen * 100) / 100,
    dayKey,
  };

  const dayStart = epochForIst(dayKey, "09:15").getTime();
  const baseVol = 40000 + (baseSeed % 900000);

  // -- today ---------------------------------------------------------
  const breakIdx = 5 + (baseSeed % 4); // 09:40 – 09:55 breakout zone
  const candles: CandlePoint[] = [];
  let price = prevClose * (1 + (rng() - 0.5) * 0.004);

  for (let i = 0; i < 76; i++) {
    const ms = dayStart + i * CANDLE_MS;
    if (ms + CANDLE_MS > cutoffMs) break;
    const noise = (mulberry32(baseSeed + i * 131)() - 0.5) * 0.004;

    let target = price;
    let vol = baseVol * (0.55 + mulberry32(baseSeed + i * 733)() * 0.7);

    switch (pattern) {
      case "PDH_BREAK": {
        if (i < breakIdx) {
          target = prevClose + (pdh - prevClose) * (i / breakIdx) * 0.985;
        } else if (i === breakIdx) {
          target = pdh * (1.0035 + rng() * 0.004);
          vol = baseVol * (2.2 + rng() * 4.4);
        } else {
          target = pdh * (1.004 + rng() * 0.006 + (i - breakIdx) * 0.0004);
          vol = baseVol * (1.1 + rng() * 1.3);
        }
        break;
      }
      case "PDL_BREAK": {
        if (i < breakIdx) {
          target = prevClose - (prevClose - pdl) * (i / breakIdx) * 0.985;
        } else if (i === breakIdx) {
          target = pdl * (1 - (0.0035 + rng() * 0.004));
          vol = baseVol * (2.2 + rng() * 4.4);
        } else {
          target = pdl * (1 - (0.004 + rng() * 0.006 + (i - breakIdx) * 0.0004));
          vol = baseVol * (1.1 + rng() * 1.3);
        }
        break;
      }
      case "PDH_FAIL": {
        if (i < breakIdx) {
          target = prevClose + (pdh - prevClose) * (i / breakIdx) * 0.985;
        } else if (i === breakIdx) {
          target = pdh * 1.003;
          vol = baseVol * (1.8 + rng() * 1.6);
        } else {
          target = pdh * (1 - 0.001 - (i - breakIdx) * 0.0012);
        }
        break;
      }
      case "PDL_FAIL": {
        if (i < breakIdx) {
          target = prevClose - (prevClose - pdl) * (i / breakIdx) * 0.985;
        } else if (i === breakIdx) {
          target = pdl * 0.997;
          vol = baseVol * (1.8 + rng() * 1.6);
        } else {
          target = pdl * (1 + 0.001 + (i - breakIdx) * 0.0012);
        }
        break;
      }
      case "NEAR_PDH": {
        const gapPct = 0.0012 + rng() * 0.005;
        target = prevClose + (pdh * (1 - gapPct) - prevClose) * Math.min(1, i / 8);
        if (i % 4 === 2) vol = baseVol * (1.6 + rng() * 1.6);
        break;
      }
      case "NEAR_PDL": {
        const gapPct = 0.0012 + rng() * 0.005;
        target = prevClose - (prevClose - pdl * (1 + gapPct)) * Math.min(1, i / 8);
        if (i % 4 === 2) vol = baseVol * (1.6 + rng() * 1.6);
        break;
      }
      default: {
        target = prevClose * (1 + Math.sin(i / 2.7 + rng() * 2) * 0.0035);
      }
    }

    const close = target * (1 + noise);
    const open = price;
    const spread = Math.abs(close - open) * (0.25 + rng() * 0.5) + close * 0.0004;
    candles.push(makeCandle(ms, open, close, spread, vol));
    price = close;
  }

  // -- warmup: two previous sessions of 5-min candles (EMA/volume seed) ----
  const warmup: CandlePoint[] = [];
  for (let d = 2; d >= 1; d--) {
    const seed = hash32(`${symbol}|warm|${dayKey}|-${d}`);
    const wrng = mulberry32(seed);
    const wStart = epochForIst(dayKey, "09:15").getTime() - d * 24 * 3600 * 1000;
    let wp = prevClose * (1 - d * 0.004) * (0.996 + wrng() * 0.008);
    for (let i = 0; i < 76; i++) {
      const ms = wStart + i * CANDLE_MS;
      const wn = (wrng() - 0.5) * 0.0035;
      const drift = d === 1 ? (prevClose - wp) / (76 - i) * 0.4 : 0;
      const close = wp * (1 + wn) + drift;
      const spread = Math.abs(close - wp) * 0.4 + close * 0.0005;
      const vol = baseVol * (0.5 + wrng() * 0.8);
      warmup.push(makeCandle(ms, wp, close, spread, vol));
      wp = close;
    }
  }

  return { candles, warmup, levels };
}
