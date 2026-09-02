"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  CloudOff,
  Crosshair,
  Database,
  Download,
  Eye,
  ListFilter,
  Radio,
  RefreshCw,
  Search,
  Zap,
} from "lucide-react";
import type { ScanPayload, ScanRow } from "@/lib/types";
import { setupBadge } from "@/lib/labels";
import { rankScanRow } from "@/lib/ranking";
import { ScannerTable } from "./ScannerTable";
import { SignalLog } from "./SignalLog";

/* ------------------------------------------------------------------ */

interface Filters {
  status: string;
  direction: string;
  level: string;
  vol: number;
  setup: string;
  query: string;
  sort: string;
}

const IST_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function phaseBadge(phase: string) {
  switch (phase) {
    case "LIVE_SCAN":
      return {
        label: "LIVE",
        cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
        dot: "bg-emerald-400 animate-pulse-dot",
      };
    case "SCAN_ENDED":
      return {
        label: "SCAN LOCKED",
        cls: "border-amber-400/40 bg-amber-400/10 text-amber-300",
        dot: "bg-amber-400",
      };
    case "PRE_OPEN":
      return {
        label: "PRE-OPEN",
        cls: "border-sky-400/40 bg-sky-400/10 text-sky-300",
        dot: "bg-sky-400",
      };
    default:
      return {
        label: "MARKET CLOSED",
        cls: "border-slate-500/40 bg-slate-500/10 text-slate-400",
        dot: "bg-slate-500",
      };
  }
}

function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="card-sheen relative overflow-hidden rounded-xl border border-[#1b2537] bg-[#0a101c]/70 p-4">
      <div className={`absolute inset-x-0 top-0 h-[2px] ${accent}`} />
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </span>
        <span className="text-slate-600">{icon}</span>
      </div>
      <div className="mono mt-2 text-[30px] font-bold leading-none tracking-tight text-slate-50">
        {value}
      </div>
      <div className="mt-1.5 truncate text-[10px] text-slate-500">{sub}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const [payload, setPayload] = useState<ScanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clock, setClock] = useState("--:--:--");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Filters>({
    status: "ALL",
    direction: "ALL",
    level: "ALL",
    vol: 0,
    setup: "ALL",
    query: "",
    sort: "PRIME",
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (force: boolean) => {
    try {
      const res = await fetch(`/api/scan${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ScanPayload;
      setPayload(json);
    } catch {
      setPayload((prev) =>
        prev
          ? { ...prev, meta: { ...prev.meta, error: "Network error — showing last loaded data." } }
          : prev
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const clockTimer = setInterval(() => setClock(IST_CLOCK.format(new Date())), 1000);
    return () => clearInterval(clockTimer);
  }, [load]);

  const pollSeconds = Math.min(
    60,
    Math.max(25, payload?.meta.config.rescanSeconds ?? 30)
  );

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => load(false), pollSeconds * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [pollSeconds, load]);

  const toggleRow = useCallback((symbol: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    if (!payload) return [];
    const q = filters.query.trim().toUpperCase();
    let rows = payload.rows.filter((r) => {
      if (filters.status !== "ALL" && r.status !== filters.status) return false;
      if (filters.direction !== "ALL" && r.direction !== filters.direction) return false;
      if (filters.level !== "ALL" && r.level !== filters.level) return false;
      if (filters.setup !== "ALL" && r.setup !== filters.setup) return false;
      if (filters.vol > 0 && (r.volumeMultiple == null || r.volumeMultiple < filters.vol))
        return false;
      if (q && !r.symbol.includes(q)) return false;
      return true;
    });
    const byVolume = (a: ScanRow, b: ScanRow) =>
      (b.volumeMultiple ?? 0) - (a.volumeMultiple ?? 0);
    const byDistance = (a: ScanRow, b: ScanRow) =>
      Math.abs(a.distancePct ?? 999) - Math.abs(b.distancePct ?? 999);
    rows = [...rows].sort((a, b) => {
      switch (filters.sort) {
        case "PRIME": {
          const scoreDiff = rankScanRow(b) - rankScanRow(a);
          if (scoreDiff !== 0) return scoreDiff;
          if (a.statusRank !== b.statusRank) return a.statusRank - b.statusRank;
          return byVolume(a, b);
        }
        case "VOLUME":
          return byVolume(a, b) || a.statusRank - b.statusRank;
        case "DISTANCE":
          return byDistance(a, b) || a.statusRank - b.statusRank;
        case "CHANGE":
          return (b.changePct ?? -999) - (a.changePct ?? -999);
        default:
          return rankScanRow(b) - rankScanRow(a) || a.statusRank - b.statusRank;
      }
    });
    return rows;
  }, [payload, filters]);

  const exportCsv = useCallback(() => {
    if (!filtered.length) return;
    const head = [
      "STOCK", "PRIME_SCORE", "LTP", "CHANGE%", "VOLUME_X", "EMA20", "EMA_BIAS", "PDH", "PDL",
      "LEVEL", "DISTANCE%", "SETUP", "STATUS", "ENTRY", "SL", "TARGET", "REASON",
    ];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = filtered.map((r) =>
      [
        r.symbol,
        String(rankScanRow(r)),
        r.ltp?.toFixed(2) ?? "",
        r.changePct?.toFixed(2) ?? "",
        r.volumeMultiple?.toFixed(1) ?? "",
        r.ema20?.toFixed(2) ?? "",
        r.emaBias,
        r.pdh?.toFixed(2) ?? "",
        r.pdl?.toFixed(2) ?? "",
        r.level,
        r.distancePct?.toFixed(2) ?? "",
        setupBadge(r.setup, r.status),
        r.status,
        r.entry?.toFixed(2) ?? "",
        r.stopLoss?.toFixed(2) ?? "",
        r.target?.toFixed(2) ?? "",
        esc(r.reason),
      ].join(",")
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prime-technical-scan-${payload?.meta.scanDate ?? "today"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered, payload]);

  const meta = payload?.meta;
  const phase = phaseBadge(meta?.marketPhase ?? "CLOSED");

  return (
    <div className="relative min-h-screen">
      <div className="grid-overlay pointer-events-none absolute inset-0" />

      <header className="sticky top-0 z-40 border-b border-[#16203a] bg-[#04070d]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-sky-400/30 bg-sky-400/10">
              <Radio size={17} className="text-sky-300" />
              <span className="absolute inset-0 overflow-hidden rounded-lg">
                <span className="absolute inset-y-0 w-1/2 animate-scanline bg-gradient-to-r from-transparent via-sky-400/25 to-transparent" />
              </span>
            </div>
            <div>
              <h1 className="text-[15px] font-bold leading-tight tracking-[0.14em] text-slate-50">
                PRIME TECHNICAL{" "}
                <span className="bg-gradient-to-r from-sky-300 to-emerald-300 bg-clip-text text-transparent">
                  LIVE SCANNER
                </span>
              </h1>
              <p className="mono text-[9px] uppercase tracking-[0.22em] text-slate-500">
                5-min · PDH/PDL · 20 EMA · volume confirmation · PRIME QUALITY RANKING · F&O ONLY
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold tracking-widest ${phase.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${phase.dot}`} />
              {phase.label}
            </span>
            <span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold tracking-widest ${
              meta?.source === "UPSTOX"
                ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-300"
                : "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300"
            }`}>
              <Database size={11} />
              {meta?.source === "UPSTOX" ? "UPSTOX LIVE" : "SIMULATION MODE"}
            </span>
            <span className="mono hidden items-center gap-1.5 rounded-md border border-[#243148] bg-[#0b1220] px-2 py-1 text-[10px] tracking-widest text-slate-400 md:flex">
              WINDOW {meta?.config.scanStart ?? "09:15"}–{meta?.config.scanEnd ?? "10:00"} IST
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <div className="mono flex items-center gap-1.5 text-[13px] font-semibold text-slate-200">
                <Clock3 size={12} className="text-slate-500" />
                {clock} <span className="text-[9px] text-slate-500">IST</span>
              </div>
              <div className="mono text-[9px] uppercase tracking-widest text-slate-500">
                last scan {meta?.lastScanAt ?? "—"}
              </div>
            </div>
            <a href="/guide" className="flex items-center gap-1.5 rounded-md border border-[#243148] bg-[#0b1220] px-2.5 py-1.5 text-[10px] font-semibold tracking-widest text-slate-300 transition-colors hover:border-sky-400/40 hover:text-sky-300">
              <BookOpen size={12} /> SETUP GUIDE
            </a>
            <button onClick={() => { setRefreshing(true); load(true); }} disabled={refreshing} className="flex items-center gap-1.5 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 py-1.5 text-[10px] font-bold tracking-widest text-sky-300 transition-all hover:bg-sky-400/20 disabled:opacity-50">
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "SCANNING" : "REFRESH"}
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-[1680px] space-y-4 px-4 py-4 lg:px-6">
        {meta?.error && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3">
            <CloudOff size={16} className="mt-0.5 shrink-0 text-rose-300" />
            <div><div className="text-[12px] font-semibold text-rose-200">DATA ERROR</div><div className="text-[11px] text-rose-200/80">{meta.error}</div></div>
          </div>
        )}
        {meta?.message && !meta.error && (
          <div className="flex items-start gap-3 rounded-xl border border-sky-400/25 bg-sky-400/5 px-4 py-2.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-sky-300" />
            <div className="text-[11px] text-sky-200/90">{meta.message}</div>
          </div>
        )}
        {meta?.source === "SIMULATION" && (
          <div className="flex items-start gap-3 rounded-xl border border-fuchsia-400/25 bg-fuchsia-400/5 px-4 py-2.5">
            <Zap size={14} className="mt-0.5 shrink-0 text-fuchsia-300" />
            <div className="text-[11px] text-fuchsia-200/90">
              Simulation mode — set <span className="mono font-semibold">UPSTOX_ACCESS_TOKEN</span> on the server to scan the live NSE F&O stock universe. Engine + confirmation rules are identical; only the data feed changes. See the SETUP GUIDE.
            </div>
          </div>
        )}

        <div className="fade-stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Confirmed" value={String(meta?.counts.confirmed ?? 0)} sub="verified PDH/PDL moves with follow-through" icon={<CheckCircle2 size={15} className="text-emerald-300" />} accent="bg-gradient-to-r from-emerald-400 to-teal-300" />
          <StatCard label="Setups" value={String(meta?.counts.setups ?? 0)} sub="level reaction started · confirmation pending" icon={<Crosshair size={15} className="text-amber-300" />} accent="bg-gradient-to-r from-amber-400 to-orange-300" />
          <StatCard label="Watch" value={String(meta?.counts.watch ?? 0)} sub="approaching PDH/PDL · conditions developing" icon={<Eye size={15} className="text-sky-300" />} accent="bg-gradient-to-r from-sky-400 to-cyan-300" />
          <StatCard label="F&O Stock Universe" value={String(meta?.universeSize ?? 0)} sub={`NSE F&O only · processed ${meta?.processed ?? 0} · errors ${meta?.errorCount ?? 0}`} icon={<Database size={15} className="text-slate-400" />} accent="bg-gradient-to-r from-slate-400 to-slate-500" />
          <StatCard label="Last Update" value={meta?.lastScanAt ?? "—"} sub={`auto-refresh ${pollSeconds}s · ${meta?.scanDate ?? ""}`} icon={<Clock3 size={15} className="text-slate-400" />} accent="bg-gradient-to-r from-indigo-400 to-violet-400" />
        </div>

        <section className="rounded-xl border border-[#1b2537] bg-[#0a101c]/70 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500"><ListFilter size={12} className="text-sky-300" /> Filters</span>
            <div className="select-wrap"><select className="term-select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}><option value="ALL">Status: All</option><option value="CONFIRMED">Confirmed</option><option value="SETUP">Setup</option><option value="WATCH">Watch</option></select></div>
            <div className="select-wrap"><select className="term-select" value={filters.direction} onChange={(e) => setFilters((f) => ({ ...f, direction: e.target.value }))}><option value="ALL">Direction: All</option><option value="BUY">Buy</option><option value="SELL">Sell</option></select></div>
            <div className="select-wrap"><select className="term-select" value={filters.level} onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value }))}><option value="ALL">Level: All</option><option value="PDH">PDH</option><option value="PDL">PDL</option></select></div>
            <div className="select-wrap"><select className="term-select" value={String(filters.vol)} onChange={(e) => setFilters((f) => ({ ...f, vol: Number(e.target.value) }))}><option value="0">Volume: All</option><option value="1.5">≥ 1.5x Strong</option><option value="2">≥ 2x High</option><option value="4">≥ 4x Very High</option><option value="6">≥ 6x Extreme</option></select></div>
            <div className="select-wrap"><select className="term-select" value={filters.setup} onChange={(e) => setFilters((f) => ({ ...f, setup: e.target.value }))}><option value="ALL">Setup: All</option><option value="PDH_BUY">PDH Buy</option><option value="PDL_SELL">PDL Sell</option><option value="BUY_CONTINUATION">Buy Continuation</option><option value="SELL_CONTINUATION">Sell Continuation</option></select></div>
            <div className="select-wrap"><select className="term-select" value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}><option value="PRIME">Sort: PRIME Score</option><option value="VOLUME">Sort: Volume Multiple</option><option value="DISTANCE">Sort: Level Distance</option><option value="CHANGE">Sort: % Change</option></select></div>
            <div className="relative min-w-[150px] flex-1 sm:flex-none"><Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" /><input className="term-input pl-7" placeholder="SYMBOL" value={filters.query} onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))} /></div>
            <div className="ml-auto flex items-center gap-2"><span className="mono text-[10px] text-slate-500">{filtered.length}/{payload?.rows.length ?? 0} rows</span><button onClick={exportCsv} className="flex items-center gap-1.5 rounded-md border border-[#26334b] bg-[#0c1422] px-2.5 py-1.5 text-[10px] font-semibold tracking-widest text-slate-400 hover:border-sky-400/30 hover:text-sky-300"><Download size={11} /> CSV</button></div>
          </div>
        </section>

        <ScannerTable rows={filtered} expanded={expanded} onToggle={toggleRow} />
        <SignalLog events={payload?.events ?? []} />
        <footer className="pb-8 pt-1 text-center text-[10px] text-slate-600">Prime Technical Scanner · NSE F&O stock universe · PDH/PDL + 20 EMA + volume confirmation + PRIME quality ranking</footer>
      </main>
    </div>
  );
}
