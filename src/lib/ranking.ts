/**
 * PRIME ranking layer.
 *
 * This does NOT change the hard signal rules. It ranks already-qualified
 * PDH/PDL candidates by the quality of the move that produced the signal.
 * Inputs are limited to data available at the scan cutoff / trigger candle.
 */

import type { ScanRow } from "./types";

export interface PrimeScore {
  total: number;
  grade: "A+" | "A" | "B" | "C";
  status: number;
  penetration: number;
  volume: number;
  candle: number;
  closeLocation: number;
  ema: number;
  impulse: number;
  early: number;
  rangeExpansion: number;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Score one scanner row out of 100. */
export function primeScore(row: ScanRow): PrimeScore {
  if (row.level === "-" || !row.details) {
    return { total: 0, grade: "C", status: 0, penetration: 0, volume: 0, candle: 0, closeLocation: 0, ema: 0, impulse: 0, early: 0, rangeExpansion: 0 };
  }

  const d = row.details;
  const isBuy = row.direction === "BUY";
  const level = row.level === "PDH" ? row.pdh : row.pdl;
  const triggerClose = d.triggerClose;
  const triggerOpen = d.triggerOpen;
  const triggerHigh = d.triggerHigh;
  const triggerLow = d.triggerLow;

  // Confirmation state is important, but quality decides the ordering within it.
  const status = row.status === "CONFIRMED" ? 20 : row.status === "SETUP" ? 12 : 5;

  // 1) How decisively did the trigger close clear PDH/PDL?
  const penetrationPct = level && triggerClose
    ? Math.abs((triggerClose - level) / level) * 100
    : 0;
  const penetration = clamp((penetrationPct / 1.50) * 15, 0, 15);

  // 2) Relative volume: reward genuine participation, cap extreme outliers.
  const vm = d.volumeMultiple ?? row.volumeMultiple ?? 0;
  const volume = vm >= 1.5 ? clamp(4 + ((vm - 1.5) / 4.5) * 11, 0, 15) : 0;

  // 3) Trigger candle body quality: avoid wick-only breaks.
  const range = triggerHigh != null && triggerLow != null ? Math.max(0, triggerHigh - triggerLow) : 0;
  const body = triggerOpen != null && triggerClose != null ? Math.abs(triggerClose - triggerOpen) : 0;
  const candle = range > 0 ? clamp((body / range) * 10, 0, 10) : 0;

  // 4) Close location inside the candle. A directional close near the extreme is stronger.
  let closeLocation = 0;
  if (range > 0 && triggerClose != null && triggerHigh != null && triggerLow != null) {
    const loc = isBuy
      ? (triggerClose - triggerLow) / range
      : (triggerHigh - triggerClose) / range;
    closeLocation = clamp(loc * 10, 0, 10);
  }

  // 5) EMA structure: separation + directional slope.
  let ema = 0;
  if (d.emaAtTrigger != null && triggerClose != null && d.emaAtTrigger > 0) {
    const separationPct = Math.abs((triggerClose - d.emaAtTrigger) / d.emaAtTrigger) * 100;
    const separationScore = clamp((separationPct / 1.0) * 10, 0, 10);
    const slopeAligned = isBuy
      ? d.emaSlope === "RISING"
      : d.emaSlope === "FALLING";
    const slopeScore = slopeAligned ? 5 : d.emaSlope === "FLAT" ? 3 : 0;
    ema = clamp(separationScore + slopeScore, 0, 15);
  }

  // 6) Immediate directional impulse in the trigger candle.
  const impulsePct = triggerOpen && triggerClose
    ? Math.abs((triggerClose - triggerOpen) / triggerOpen) * 100
    : 0;
  const impulse = clamp((impulsePct / 2.0) * 10, 0, 10);

  // 7) Earlier trigger gets priority. 09:15 is the cleanest opening impulse.
  const t = d.triggerTime ?? "";
  const early = t.startsWith("09:15") ? 5 : t.startsWith("09:20") ? 4 : t.startsWith("09:25") ? 3 : t.startsWith("09:30") ? 2 : t.startsWith("09:35") ? 1 : 0;

  // 8) Trigger range relative to the previous-day range. Large opening expansion
  // is more likely to produce a sustained directional move than a tiny break.
  const prevRange = row.pdh != null && row.pdl != null ? Math.abs(row.pdh - row.pdl) : 0;
  const rangeExpansionPct = prevRange > 0 && range > 0 ? (range / prevRange) * 100 : 0;
  const rangeExpansion = clamp((rangeExpansionPct / 5.0) * 10, 0, 10);

  const total = Math.round(clamp(
    status + penetration + volume + candle + closeLocation + ema + impulse + early + rangeExpansion,
    0,
    100
  ));
  const grade = total >= 85 ? "A+" : total >= 75 ? "A" : total >= 65 ? "B" : "C";

  return {
    total,
    grade,
    status,
    penetration: Math.round(penetration),
    volume: Math.round(volume),
    candle: Math.round(candle),
    closeLocation: Math.round(closeLocation),
    ema: Math.round(ema),
    impulse: Math.round(impulse),
    early,
    rangeExpansion: Math.round(rangeExpansion),
  };
}

export function rankScanRow(row: ScanRow): number {
  return primeScore(row).total;
}
