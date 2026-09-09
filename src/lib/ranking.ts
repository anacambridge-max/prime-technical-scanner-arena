import type { ScanRow } from "./types";

export interface PrimeScore {
  total: number;
  grade: "A+" | "A" | "B" | "C";
  volume: number;
  penetration: number;
  candle: number;
  closeLocation: number;
  ema: number;
  rangeExpansion: number;
  timing: number;
  compression: number;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function primeScore(row: ScanRow): PrimeScore {
  const d = row.details;
  if (!d || row.level === "-" || d.triggerClose == null) {
    return { total: 0, grade: "C", volume: 0, penetration: 0, candle: 0, closeLocation: 0, ema: 0, rangeExpansion: 0, timing: 0, compression: 0 };
  }

  const level = row.level === "PDH" ? row.pdh : row.pdl;
  const range = d.triggerHigh != null && d.triggerLow != null ? Math.max(0, d.triggerHigh - d.triggerLow) : 0;
  const body = d.triggerOpen != null ? Math.abs(d.triggerClose - d.triggerOpen) : 0;
  const isBuy = row.direction === "BUY";
  const closeLocation = range > 0 && d.triggerHigh != null && d.triggerLow != null
    ? (isBuy ? (d.triggerClose - d.triggerLow) / range : (d.triggerHigh - d.triggerClose) / range)
    : 0;

  const volumeMultiple = d.volumeMultiple ?? row.volumeMultiple ?? 0;
  const volume = volumeMultiple >= 6.5 ? 20 : volumeMultiple >= 4 ? 18 : volumeMultiple >= 2 ? 15 : volumeMultiple >= 1.5 ? 10 : 0;
  const penetrationPct = level ? Math.abs((d.triggerClose - level) / level) * 100 : 0;
  const penetration = clamp(penetrationPct * 15, 0, 15);
  const candle = clamp((range > 0 ? body / range : 0) * 15, 0, 15);
  const close = clamp(closeLocation * 10, 0, 10);
  const emaDistance = d.emaAtTrigger && d.emaAtTrigger > 0 ? Math.abs((d.triggerClose - d.emaAtTrigger) / d.emaAtTrigger) * 100 : 0;
  const ema = clamp(emaDistance * 15, 0, 15);
  const rangeExpansion = d.checks.find(c => c.label === "Range expansion")?.value?.replace("x", "") ?? "0";
  const rangeScoreValue = Number(rangeExpansion) || 0;
  const rangeScore = rangeScoreValue >= 2 ? 10 : rangeScoreValue >= 1.75 ? 9 : rangeScoreValue >= 1.5 ? 8 : rangeScoreValue >= 1.3 ? 6 : rangeScoreValue >= 1.1 ? 3 : 0;

  const time = d.triggerTime ?? "";
  const mins = time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) - 555 : 999;
  const timing = mins <= 5 ? 10 : mins <= 10 ? 9 : mins <= 15 ? 8 : mins <= 20 ? 6 : mins <= 30 ? 4 : mins <= 45 ? 2 : 0;
  const compression = d.checks.some(c => c.label === "Range expansion" && c.ok === true) ? 2 : 0;

  const total = Math.round(clamp(volume + penetration + candle + close + ema + rangeScore + timing + compression));
  const grade = total >= 90 ? "A+" : total >= 80 ? "A" : total >= 70 ? "B" : "C";
  return { total, grade, volume, penetration: Math.round(penetration), candle: Math.round(candle), closeLocation: Math.round(close), ema: Math.round(ema), rangeExpansion: rangeScore, timing, compression };
}

export function rankScanRow(row: ScanRow): number { return primeScore(row).total; }
