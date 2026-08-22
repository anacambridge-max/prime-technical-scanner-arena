/**
 * Explicit Asia/Kolkata (IST) time handling. All market/scan-window logic
 * goes through these helpers — never raw server-local time.
 */

export const IST_TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60 * 1000; // UTC+05:30

export interface IstParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  weekday: number; // 0=Sun .. 6=Sat
  minutesOfDay: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Break an instant into IST calendar/clock parts (UTC-math based, no Intl needed). */
export function istParts(d: Date = new Date()): IstParts {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour,
    minute,
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
    minutesOfDay: hour * 60 + minute,
  };
}

/** IST date key YYYY-MM-DD for an instant. */
export function istDateKey(d: Date = new Date()): string {
  const p = istParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** IST wall-clock label HH:MM (24h) for an instant. */
export function istTimeLabel(d: Date = new Date(), withSeconds = false): string {
  const p = istParts(d);
  return withSeconds
    ? `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
    : `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Parse "HH:MM" -> minutes of day. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

/** Epoch (Date) for a given IST clock time on a given IST date key. */
export function epochForIst(dateKey: string, hhmm: string): Date {
  return new Date(`${dateKey}T${hhmm}:00+05:30`);
}

export function isWeekdayIST(d: Date = new Date()): boolean {
  const wd = istParts(d).weekday;
  return wd >= 1 && wd <= 5;
}

export type MarketPhase =
  | "PRE_OPEN" // trading day, before scan start
  | "LIVE_SCAN" // inside the live scanning window
  | "SCAN_ENDED" // trading day, window over (results frozen for the day)
  | "CLOSED"; // weekend / holiday / outside market context

export function marketPhase(
  now: Date,
  cfg: { scanStart: string; scanEnd: string }
): MarketPhase {
  if (!isWeekdayIST(now)) return "CLOSED";
  const mins = istParts(now).minutesOfDay;
  const start = hhmmToMinutes(cfg.scanStart);
  const end = hhmmToMinutes(cfg.scanEnd);
  if (mins < start) return "PRE_OPEN";
  if (mins <= end) return "LIVE_SCAN";
  return "SCAN_ENDED";
}

/**
 * Effective "now" for candle selection: during/after the scan window the
 * engine only sees candles COMPLETED inside the window (no fresh confirmations
 * from stale data later in the day).
 */
export function candleCutoff(
  now: Date,
  cfg: { scanStart: string; scanEnd: string },
  dateKey: string
): Date {
  const windowEnd = epochForIst(dateKey, cfg.scanEnd);
  return now.getTime() < windowEnd.getTime() ? now : windowEnd;
}

/** A 5-minute candle starting at `t` is COMPLETED if its close time <= cutoff. */
export function isCandleCompleted(
  startMs: number,
  timeframeMinutes: number,
  cutoff: Date
): boolean {
  return startMs + timeframeMinutes * 60 * 1000 <= cutoff.getTime();
}
