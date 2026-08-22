import type { SetupType, SignalStatus, Direction } from "./types";

/** Human badge text for a setup+status pair, e.g. "PDH BUY WATCH". */
export function setupBadge(setup: SetupType, status: SignalStatus): string {
  const base =
    setup === "PDH_BUY"
      ? "PDH BUY"
      : setup === "PDL_SELL"
        ? "PDL SELL"
        : setup === "BUY_CONTINUATION"
          ? "BUY CONTINUATION"
          : setup === "SELL_CONTINUATION"
            ? "SELL CONTINUATION"
            : "-";
  if (base === "-") return "-";
  if (status === "CONFIRMED") return base;
  return `${base} ${status}`;
}

export type Tone = "buy" | "sell" | "setup" | "watch" | "muted";

export function toneForStatusDirection(
  status: SignalStatus,
  direction: Direction
): Tone {
  if (status === "CONFIRMED") return direction === "SELL" ? "sell" : "buy";
  if (status === "SETUP") return "setup";
  if (status === "WATCH") return "watch";
  return "muted";
}
