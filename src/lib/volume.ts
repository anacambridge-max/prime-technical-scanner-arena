/**
 * 5-minute volume logic. Reference = mean volume of the previous N COMPLETED
 * candles (strictly before index i — no future/current candle contamination).
 */

/** Rolling reference volume for candle i (null if insufficient history). */
export function referenceVolume(
  volumes: number[],
  i: number,
  refCandles: number,
  minimum: number
): number | null {
  const from = Math.max(0, i - refCandles);
  const count = i - from;
  if (count < minimum) return null;
  let sum = 0;
  for (let j = from; j < i; j++) sum += volumes[j];
  const avg = sum / count;
  return avg > 0 ? avg : null;
}

/** volumeMultiple = current 5-min volume / reference 5-min volume. */
export function volumeMultiple(
  volumes: number[],
  i: number,
  refCandles: number,
  minimum: number
): { multiple: number | null; reference: number | null } {
  const reference = referenceVolume(volumes, i, refCandles, minimum);
  if (reference == null || reference <= 0) return { multiple: null, reference: null };
  return { multiple: volumes[i] / reference, reference };
}

export type VolumeLabel =
  | "EXTREME VOLUME"
  | "VERY HIGH VOLUME"
  | "HIGH VOLUME"
  | "STRONG VOLUME"
  | "NORMAL VOLUME"
  | "NO DATA";

export function volumeLabel(
  m: number | null,
  bands = { strong: 1.5, high: 2.0, veryHigh: 4.0, extreme: 6.0 }
): VolumeLabel {
  if (m == null || !Number.isFinite(m)) return "NO DATA";
  if (m >= bands.extreme) return "EXTREME VOLUME";
  if (m >= bands.veryHigh) return "VERY HIGH VOLUME";
  if (m >= bands.high) return "HIGH VOLUME";
  if (m >= bands.strong) return "STRONG VOLUME";
  return "NORMAL VOLUME";
}
