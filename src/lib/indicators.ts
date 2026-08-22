/**
 * Technical indicators. 5-minute timeframe only — no look-ahead: the value at
 * index i depends exclusively on values at indexes <= i.
 */

/**
 * EMA series. Indexes < period-1 are null; first EMA value is the SMA of the
 * first `period` closes (standard seeding), then recursive smoothing.
 */
export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export type EmaSlope = "RISING" | "FALLING" | "FLAT" | "NA";

/** EMA slope at index i, comparing against `lookback` bars ago with tolerance. */
export function emaSlope(
  series: (number | null)[],
  i: number,
  lookback = 3
): EmaSlope {
  const cur = series[i];
  const refIdx = i - lookback;
  const ref = refIdx >= 0 ? series[refIdx] : null;
  if (cur == null || ref == null) return "NA";
  const tol = Math.abs(cur) * 0.0002; // 0.02% neutral band
  if (cur > ref + tol) return "RISING";
  if (cur < ref - tol) return "FALLING";
  return "FLAT";
}

/** Human bias label for the 20-EMA column (price vs EMA + slope). */
export function emaBiasLabel(price: number, ema: number | null, slope: EmaSlope): string {
  if (ema == null) return "-";
  const above = price >= ema;
  if (above && (slope === "RISING" || slope === "FLAT")) return "BULLISH";
  if (!above && (slope === "FALLING" || slope === "FLAT")) return "BEARISH";
  return above ? "BULLISH" : "BEARISH";
}
