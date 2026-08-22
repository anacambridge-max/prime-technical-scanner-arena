"use client";

import { Fragment } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Crosshair,
  Minus,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import type { AuditDetails, ScanRow } from "@/lib/types";
import { setupBadge, toneForStatusDirection, type Tone } from "@/lib/labels";

/* ------------------------------------------------------------------ */
/* format + tone helpers                                               */
/* ------------------------------------------------------------------ */

const fmt = (n: number | null | undefined, d = 2): string =>
  n == null || !Number.isFinite(n) ? "-" : n.toFixed(d);

const fmtPct = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

const fmtVol = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "-" : `${n.toFixed(1)}x`;

const toneClasses: Record<
  Tone,
  { text: string; bg: string; border: string; bar: string }
> = {
  buy: {
    text: "text-emerald-300",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/25",
    bar: "border-l-emerald-400",
  },
  sell: {
    text: "text-rose-300",
    bg: "bg-rose-400/10",
    border: "border-rose-400/25",
    bar: "border-l-rose-400",
  },
  setup: {
    text: "text-amber-300",
    bg: "bg-amber-400/10",
    border: "border-amber-400/25",
    bar: "border-l-amber-400",
  },
  watch: {
    text: "text-sky-300",
    bg: "bg-sky-400/10",
    border: "border-sky-400/25",
    bar: "border-l-sky-400",
  },
  muted: {
    text: "text-slate-400",
    bg: "bg-slate-400/10",
    border: "border-slate-400/20",
    bar: "border-l-slate-600",
  },
};

function volTone(m: number | null): string {
  if (m == null) return "text-slate-500";
  if (m >= 6) return "text-fuchsia-300";
  if (m >= 4) return "text-orange-300";
  if (m >= 2) return "text-emerald-300";
  if (m >= 1.5) return "text-amber-300";
  return "text-slate-400";
}

function StatusPill({ row }: { row: ScanRow }) {
  const tone = toneForStatusDirection(row.status, row.direction);
  const c = toneClasses[tone];
  const icon =
    row.status === "CONFIRMED" ? (
      row.direction === "SELL" ? (
        <TrendingDown size={11} strokeWidth={2.5} />
      ) : (
        <TrendingUp size={11} strokeWidth={2.5} />
      )
    ) : row.status === "SETUP" ? (
      <Crosshair size={11} strokeWidth={2.5} />
    ) : (
      <Minus size={11} strokeWidth={2.5} />
    );
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${c.bg} ${c.border} ${c.text}`}
    >
      {icon}
      {row.status}
    </span>
  );
}

function SetupTag({ row }: { row: ScanRow }) {
  const tone = toneForStatusDirection(row.status, row.direction);
  const c = toneClasses[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${c.bg} ${c.text}`}
    >
      {row.direction === "BUY" && <ArrowUpRight size={10} />}
      {row.direction === "SELL" && <ArrowDownRight size={10} />}
      {setupBadge(row.setup, row.status)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Audit details panel                                                 */
/* ------------------------------------------------------------------ */

function KV({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-[10px] uppercase tracking-[0.08em] text-slate-500">{k}</span>
      <span className={`mono text-[11px] ${tone ?? "text-slate-200"}`}>{v}</span>
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#1b2537] bg-[#0a101c]/70 p-3">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {title}
      </div>
      <div className="divide-y divide-[#131c2e]">{children}</div>
    </div>
  );
}

function AuditPanel({ row }: { row: ScanRow }) {
  const d: AuditDetails | null = row.details;
  const tone = toneForStatusDirection(row.status, row.direction);
  const c = toneClasses[tone];

  if (!d) {
    return (
      <div className="px-4 py-3 text-[11px] text-slate-500">
        No audit data captured for this row.
      </div>
    );
  }

  const rr = d.riskReward ?? 2;

  return (
    <div className="grid gap-3 px-4 py-4 lg:grid-cols-4">
      <DetailBlock title="Levels — Previous Day">
        <KV k="PDH" v={fmt(d.pdh)} tone="text-emerald-300" />
        <KV k="PDL" v={fmt(d.pdl)} tone="text-rose-300" />
        <KV k="Prev Close" v={fmt(d.prevClose)} />
        <KV k="Candles Analyzed" v={String(d.candlesAnalyzed)} />
        <KV k="Last Candle" v={d.lastCandleTime ?? "-"} />
      </DetailBlock>

      <DetailBlock title={d.triggerType ?? "Trigger Candle (5-min)"}>
        <KV k="Time" v={d.triggerTime ?? "-"} tone="text-sky-300" />
        <KV
          k="O / H / L / C"
          v={`${fmt(d.triggerOpen)} / ${fmt(d.triggerHigh)} / ${fmt(d.triggerLow)} / ${fmt(d.triggerClose)}`}
        />
        <KV
          k="Volume"
          v={
            d.triggerVolume != null
              ? d.triggerVolume.toLocaleString("en-IN")
              : "-"
          }
        />
        <KV
          k="Reference Vol"
          v={
            d.referenceVolume != null
              ? Math.round(d.referenceVolume).toLocaleString("en-IN")
              : "-"
          }
        />
        <KV
          k="Vol Multiple"
          v={d.volumeMultiple != null ? `${d.volumeMultiple.toFixed(1)}x — ${d.volumeLabel}` : "-"}
          tone={volTone(d.volumeMultiple)}
        />
      </DetailBlock>

      <DetailBlock title="Trend + Confirmation">
        <KV k="20 EMA @ Trigger" v={fmt(d.emaAtTrigger)} />
        <KV k="20 EMA Now" v={fmt(d.emaNow)} />
        <KV k="EMA Slope" v={d.emaSlope ?? "-"} />
        <KV k="Follow-through" v={`${d.followThrough.length} candle(s)`} />
        <KV k="Confirmed At" v={d.confirmationTime ?? "waiting"} tone={d.confirmationTime ? c.text : "text-slate-500"} />
        <KV k="Price @ Confirm" v={fmt(d.priceAtConfirmation)} />
      </DetailBlock>

      <DetailBlock title="Trade Plan (1:2 RR, display only)">
        <KV k="Entry" v={fmt(d.entry)} tone="text-sky-300" />
        <KV k="Stop-Loss" v={fmt(d.stopLoss)} tone="text-rose-300" />
        <KV k="Target" v={fmt(d.target)} tone="text-emerald-300" />
        {d.entry != null && d.stopLoss != null && d.target != null && (
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-[9px] uppercase tracking-widest text-slate-500">
              <span>SL</span>
              <span>risk 1 : reward {rr}</span>
              <span>TGT</span>
            </div>
            <div className="flex h-1.5 w-full overflow-hidden rounded-full">
              <div className="bg-rose-400/70" style={{ width: `${(1 / (1 + rr)) * 100}%` }} />
              <div className="bg-emerald-400/70" style={{ width: `${(rr / (1 + rr)) * 100}%` }} />
            </div>
          </div>
        )}
        {d.followThrough.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {d.followThrough.slice(0, 8).map((f) => (
              <span
                key={f.time}
                className={`mono rounded border px-1 py-0.5 text-[9px] ${
                  f.held
                    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                    : "border-rose-400/25 bg-rose-400/10 text-rose-300"
                }`}
              >
                {f.time} {f.close.toFixed(2)}
              </span>
            ))}
          </div>
        )}
      </DetailBlock>

      {/* Mandatory validation checklist — every CONFIRMED must answer these */}
      <div className="rounded-lg border border-[#1b2537] bg-[#0a101c]/70 p-3 lg:col-span-4">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          <ShieldAlert size={12} className="text-sky-300" />
          Signal Validation Checklist — TradingView Cross-Check
        </div>
        <div className="grid gap-x-6 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
          {d.checks.map((chk, i) => (
            <div key={i} className="flex items-center gap-2 py-[3px]">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                  chk.ok === true
                    ? "bg-emerald-400/15 text-emerald-300"
                    : chk.ok === false
                      ? "bg-rose-400/15 text-rose-300"
                      : "bg-slate-400/10 text-slate-500"
                }`}
              >
                {chk.ok === true ? (
                  <Check size={10} strokeWidth={3} />
                ) : chk.ok === false ? (
                  <X size={10} strokeWidth={3} />
                ) : (
                  <Minus size={10} strokeWidth={3} />
                )}
              </span>
              <span className="flex-1 text-[11px] text-slate-300">{chk.label}</span>
              <span className="mono text-[10px] text-slate-500">{chk.value}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 py-[3px]">
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                d.confirmationTime ? "bg-emerald-400/15 text-emerald-300" : "bg-slate-400/10 text-slate-500"
              }`}
            >
              {d.confirmationTime ? <Check size={10} strokeWidth={3} /> : <Minus size={10} strokeWidth={3} />}
            </span>
            <span className="flex-1 text-[11px] text-slate-300">Exact confirmation time</span>
            <span className="mono text-[10px] text-slate-500">{d.confirmationTime ?? "pending"}</span>
          </div>
        </div>
        {d.failureNote && (
          <div className="mt-2 rounded-md border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">
            {d.failureNote}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

const HEADERS = [
  "Stock",
  "LTP",
  "Change",
  "Volume",
  "20 EMA",
  "PDH",
  "PDL",
  "Level",
  "Distance",
  "Setup",
  "Status",
  "Entry",
  "SL",
  "Target",
  "Reason",
];

export function ScannerTable({
  rows,
  expanded,
  onToggle,
}: {
  rows: ScanRow[];
  expanded: Set<string>;
  onToggle: (symbol: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
        <Target size={28} className="text-slate-600" />
        <div className="text-sm text-slate-400">No rows match the current filters.</div>
        <div className="max-w-md text-[11px] leading-relaxed text-slate-600">
          Signals appear only when the PDH/PDL state machine fires. A smaller number of
          genuine setups is preferable to many false confirmations.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1480px] border-collapse text-left">
        <thead className="sticky top-0 z-10">
          <tr className="glass border-b border-[#1b2537]">
            {HEADERS.map((h) => (
              <th
                key={h}
                className="px-3 py-2.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-slate-500"
              >
                {h}
              </th>
            ))}
            <th className="w-8 px-2 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tone = toneForStatusDirection(row.status, row.direction);
            const c = toneClasses[tone];
            const open = expanded.has(row.symbol);
            const changeTone =
              row.changePct == null
                ? "text-slate-400"
                : row.changePct >= 0
                  ? "text-emerald-300"
                  : "text-rose-300";
            return (
              <Fragment key={row.symbol}>
                <tr
                  onClick={() => onToggle(row.symbol)}
                  className={`cursor-pointer border-b border-[#101a2c] border-l-2 ${c.bar} transition-colors hover:bg-[#0d1626]/80 ${
                    open ? "row-expanded" : ""
                  } ${!row.active && row.status === "CONFIRMED" ? "opacity-60" : ""}`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          row.active ? "bg-emerald-400" : "bg-slate-600"
                        }`}
                      />
                      <span className="mono text-[12px] font-semibold tracking-wide text-slate-100">
                        {row.symbol}
                      </span>
                    </div>
                  </td>
                  <td className="mono px-3 py-2 text-[12px] text-slate-200">{fmt(row.ltp)}</td>
                  <td className={`mono px-3 py-2 text-[11px] ${changeTone}`}>
                    {fmtPct(row.changePct)}
                  </td>
                  <td className="px-3 py-2">
                    <div className={`mono text-[12px] font-semibold ${volTone(row.volumeMultiple)}`}>
                      {fmtVol(row.volumeMultiple)}
                    </div>
                    <div className="text-[8.5px] uppercase tracking-wider text-slate-600">
                      {row.volumeLabel ?? ""}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="mono text-[11px] text-slate-300">{fmt(row.ema20)}</div>
                    <div
                      className={`text-[8.5px] font-semibold uppercase tracking-wider ${
                        row.emaBias === "BULLISH"
                          ? "text-emerald-400/80"
                          : row.emaBias === "BEARISH"
                            ? "text-rose-400/80"
                            : "text-slate-600"
                      }`}
                    >
                      {row.emaBias}
                    </div>
                  </td>
                  <td className="mono px-3 py-2 text-[11px] text-emerald-200/90">{fmt(row.pdh)}</td>
                  <td className="mono px-3 py-2 text-[11px] text-rose-200/90">{fmt(row.pdl)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`mono rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                        row.level === "PDH"
                          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                          : row.level === "PDL"
                            ? "border-rose-400/25 bg-rose-400/10 text-rose-300"
                            : "border-slate-500/20 bg-slate-500/10 text-slate-400"
                      }`}
                    >
                      {row.level}
                    </span>
                  </td>
                  <td className="mono px-3 py-2 text-[11px] text-slate-300">
                    {fmtPct(row.distancePct)}
                  </td>
                  <td className="px-3 py-2">
                    <SetupTag row={row} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      <StatusPill row={row} />
                      {row.status === "CONFIRMED" && row.firstConfirmedAt && (
                        <span className="mono text-[8.5px] text-slate-600">
                          @ {row.firstConfirmedAt}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="mono px-3 py-2 text-[11px] text-sky-200">{fmt(row.entry)}</td>
                  <td className="mono px-3 py-2 text-[11px] text-rose-200">{fmt(row.stopLoss)}</td>
                  <td className="mono px-3 py-2 text-[11px] text-emerald-200">{fmt(row.target)}</td>
                  <td className="max-w-[380px] px-3 py-2">
                    <span className="text-[10.5px] leading-snug text-slate-400">{row.reason}</span>
                  </td>
                  <td className="px-2 py-2">
                    <ChevronDown
                      size={14}
                      className={`text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </td>
                </tr>
                {open && (
                  <tr key={`${row.symbol}-detail`} className="border-b border-[#101a2c]">
                    <td colSpan={HEADERS.length + 1} className="bg-[#070d18] p-0">
                      <AuditPanel row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
