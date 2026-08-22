"use client";

import { Activity, ScrollText } from "lucide-react";
import type { SignalEventRow } from "@/lib/types";

const statusColor: Record<string, string> = {
  CONFIRMED: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  SETUP: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  WATCH: "text-sky-300 border-sky-400/30 bg-sky-400/10",
};

export function SignalLog({ events }: { events: SignalEventRow[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#1b2537] bg-[#0a101c]/60">
      <div className="flex items-center justify-between border-b border-[#1b2537] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ScrollText size={14} className="text-sky-300" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
            Signal Event Log
          </h2>
        </div>
        <span className="mono text-[10px] text-slate-500">{events.length} events today</span>
      </div>

      <div className="max-h-[380px] overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Activity size={20} className="text-slate-600" />
            <p className="text-[11px] text-slate-500">
              No signal events yet. Escalations to SETUP / CONFIRMED will stream here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#0f1728]">
            {events.map((e) => (
              <div key={e.id} className="log-line grid grid-cols-[64px_92px_1fr] items-center gap-2 px-4 py-1.5 md:grid-cols-[70px_110px_120px_110px_120px_1fr]">
                <span className="mono text-[10.5px] text-slate-500">{e.time}</span>
                <span className="mono text-[11px] font-semibold text-slate-200">{e.symbol}</span>
                <span
                  className={`mono hidden text-[10px] font-semibold md:block ${
                    e.direction === "BUY" ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {e.direction}
                </span>
                <span className="mono hidden text-[10px] text-slate-400 md:block">{e.level}</span>
                <span
                  className={`hidden w-fit rounded border px-1.5 py-[1px] text-[9.5px] font-semibold md:block ${statusColor[e.status] ?? "text-slate-400"}`}
                >
                  {e.status}
                </span>
                <span className="truncate text-[10.5px] text-slate-400">
                  <span className="mono text-slate-300">{e.price?.toFixed(2) ?? "-"}</span>
                  {e.volumeMultiple != null && (
                    <span className="mono text-amber-300/90"> · {e.volumeMultiple.toFixed(1)}x</span>
                  )}
                  <span className="text-slate-500"> — {e.reason}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
