"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Database, RefreshCw, Search, Zap } from "lucide-react";
import type { ScanPayload, ScanRow, TimeframeScanResult } from "@/lib/types";
import { rankScanRow } from "@/lib/ranking";
import { ScannerTable } from "./ScannerTable";

const tabs = [1, 3, 5] as const;
const label = (tf: number) => `${tf} MIN`;

export default function MultiTimeframeDashboard() {
  const [payload, setPayload] = useState<ScanPayload | null>(null);
  const [active, setActive] = useState<1 | 3 | 5>(5);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [direction, setDirection] = useState("ALL");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/scan${force ? "?force=1" : ""}`, { cache: "no-store" });
      setPayload((await res.json()) as ScanPayload);
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => { load(false); }, [load]);
  const poll = Math.min(60, Math.max(30, payload?.meta.config.rescanSeconds ?? 45));
  useEffect(() => { const id = setInterval(() => load(false), poll * 1000); return () => clearInterval(id); }, [load, poll]);

  const result: TimeframeScanResult | null = payload?.timeframes?.[String(active) as "1" | "3" | "5"] ?? null;
  const expanded = useMemo(() => new Set<string>(), []);

  const rows = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toUpperCase();
    return [...result.rows]
      .filter(r => !q || r.symbol.includes(q))
      .filter(r => status === "ALL" || r.status === status)
      .filter(r => direction === "ALL" || r.direction === direction)
      .sort((a, b) => rankScanRow(b) - rankScanRow(a) || a.statusRank - b.statusRank || (b.volumeMultiple ?? 0) - (a.volumeMultiple ?? 0));
  }, [result, query, status, direction]);

  const exportCsv = () => {
    if (!rows.length) return;
    const header = ["TIMEFRAME", "STOCK", "PRIME_SCORE", "STATUS", "DIRECTION", "LTP", "VOLUME_X", "EMA20", "PDH", "PDL", "LEVEL", "ENTRY", "SL", "TARGET", "REASON"];
    const lines = rows.map(r => [label(active), r.symbol, rankScanRow(r), r.status, r.direction, r.ltp ?? "", r.volumeMultiple?.toFixed(2) ?? "", r.ema20 ?? "", r.pdh ?? "", r.pdl ?? "", r.level, r.entry ?? "", r.stopLoss ?? "", r.target ?? "", `"${r.reason.replaceAll('"', '""')}"`].join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `prime-${active}m-${payload?.meta.scanDate ?? "today"}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#04070d] text-slate-200">
      <header className="sticky top-0 z-40 border-b border-[#16203a] bg-[#04070d]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-4 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-400/30 bg-sky-400/10"><Activity size={17} className="text-sky-300" /></div>
            <div><h1 className="text-[15px] font-bold tracking-[0.14em]">PRIME TECHNICAL <span className="text-emerald-300">MULTI-TIMEFRAME SCANNER</span></h1><p className="mono text-[9px] uppercase tracking-[0.22em] text-slate-500">PDH/PDL · 20 EMA · 1.5x VOLUME · PRIME QUALITY · F&O ONLY</p></div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-md border border-emerald-400/30 bg-emerald-400/5 px-2 py-1 text-[10px] font-bold tracking-widest text-emerald-300"><Database size={11} className="mr-1 inline" />{payload?.meta.source === "UPSTOX" ? "UPSTOX LIVE" : "SIMULATION"}</span>
            <span className="mono hidden text-[10px] text-slate-500 md:inline">{payload?.meta.nowIst ?? "--:--:--"} IST</span>
            <button onClick={() => load(true)} disabled={refreshing} className="flex items-center gap-1.5 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 py-1.5 text-[10px] font-bold tracking-widest text-sky-300 disabled:opacity-50"><RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />{refreshing ? "SCANNING" : "REFRESH"}</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1680px] space-y-4 px-4 py-4 lg:px-6">
        {payload?.meta.message && <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-2.5 text-[11px] text-sky-200">{payload.meta.message}</div>}
        {payload?.meta.error && <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-[11px] text-rose-200">{payload.meta.error}</div>}
        <section className="rounded-xl border border-[#1b2537] bg-[#0a101c]/80 p-2"><div className="grid grid-cols-3 gap-2">
          {tabs.map(tf => { const r = payload?.timeframes?.[String(tf) as "1" | "3" | "5"]; const selected = active === tf; return <button key={tf} onClick={() => setActive(tf)} className={`rounded-lg border px-4 py-3 text-left transition ${selected ? "border-sky-400/50 bg-sky-400/10" : "border-[#202b40] bg-[#0b1220] hover:border-slate-500"}`}><div className="flex items-center justify-between"><span className={`text-[13px] font-bold tracking-widest ${selected ? "text-sky-300" : "text-slate-300"}`}>{label(tf)}</span><span className="mono text-[10px] text-slate-500">{r?.processed ?? 0} stocks</span></div><div className="mt-2 flex gap-3 text-[10px]"><span className="text-emerald-300">CONF {r?.counts.confirmed ?? 0}</span><span className="text-amber-300">SET {r?.counts.setups ?? 0}</span><span className="text-sky-300">WATCH {r?.counts.watch ?? 0}</span></div></button>; })}
        </div></section>
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-[#1b2537] bg-[#0a101c]/70 p-3"><div className="text-[9px] uppercase tracking-widest text-slate-500">Active timeframe</div><div className="mt-1 text-2xl font-bold text-sky-300">{label(active)}</div><div className="text-[10px] text-slate-500">first completed: {active === 1 ? "09:16" : active === 3 ? "09:18" : "09:20"}</div></div>
          <div className="rounded-xl border border-[#1b2537] bg-[#0a101c]/70 p-3"><div className="text-[9px] uppercase tracking-widest text-slate-500">Confirmed</div><div className="mt-1 text-2xl font-bold text-emerald-300">{result?.counts.confirmed ?? 0}</div><div className="text-[10px] text-slate-500">PDH/PDL confirmed</div></div>
          <div className="rounded-xl border border-[#1b2537] bg-[#0a101c]/70 p-3"><div className="text-[9px] uppercase tracking-widest text-slate-500">Top PRIME Score</div><div className="mt-1 text-2xl font-bold text-amber-300">{rows[0] ? rankScanRow(rows[0]) : 0}/100</div><div className="text-[10px] text-slate-500">{rows[0]?.symbol ?? "No signal"}</div></div>
          <div className="rounded-xl border border-[#1b2537] bg-[#0a101c]/70 p-3"><div className="text-[9px] uppercase tracking-widest text-slate-500">Universe</div><div className="mt-1 text-2xl font-bold text-slate-100">{payload?.meta.universeSize ?? 0}</div><div className="text-[10px] text-slate-500">NSE F&O only</div></div>
        </section>
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[#1b2537] bg-[#0a101c]/70 p-2.5">
          <div className="relative min-w-[150px]"><Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" /><input className="term-input pl-7" placeholder="SYMBOL" value={query} onChange={e => setQuery(e.target.value)} /></div>
          <select className="term-select" value={status} onChange={e => setStatus(e.target.value)}><option value="ALL">Status: All</option><option value="CONFIRMED">Confirmed</option><option value="SETUP">Setup</option><option value="WATCH">Watch</option></select>
          <select className="term-select" value={direction} onChange={e => setDirection(e.target.value)}><option value="ALL">Direction: All</option><option value="BUY">Buy</option><option value="SELL">Sell</option></select>
          <button onClick={exportCsv} className="ml-auto rounded-md border border-[#26334b] bg-[#0c1422] px-3 py-1.5 text-[10px] font-semibold tracking-widest text-slate-400">EXPORT {active}M CSV</button>
          <span className="mono text-[10px] text-slate-500">{rows.length}/{result?.rows.length ?? 0} rows · auto {poll}s</span>
        </section>
        <ScannerTable rows={rows} expanded={expanded} onToggle={() => undefined} />
        <div className="pb-8 text-center text-[10px] text-slate-600"><Zap size={11} className="mr-1 inline" />Same PRIME v3 logic on independent 1M / 3M / 5M candles · PDH/PDL + EMA20 + 1.5x volume · sorted by PRIME Score</div>
      </main>
    </div>
  );
}
