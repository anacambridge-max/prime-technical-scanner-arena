import type { ScanPayload, ScanRow, SignalEventRow, TimeframeScanResult } from "./types";
import { UNIVERSE } from "./universe";
import { SCANNER_CONFIG } from "./config";
import { istDateKey, istTimeLabel, marketPhase, candleCutoff, hhmmToMinutes } from "./time";
import { collectMultiMarketData, buildTimeframeCandles, MULTI_TIMEFRAMES } from "./multiMarketData";
import { analyzeQualitySymbol } from "./qualityEngine";

const labels = { 1: "1 MIN", 3: "3 MIN", 5: "5 MIN" } as const;
const cache = new Map<string, ScanPayload>();

function emptyResult(tf: 1 | 3 | 5): TimeframeScanResult {
  return { timeframeMinutes: tf, label: labels[tf], rows: [], events: [], counts: { confirmed: 0, setups: 0, watch: 0 }, processed: 0, errors: 0, lastCandleTime: null };
}

function makeMeta(dateKey: string, now: Date, phase: ReturnType<typeof marketPhase>, source: "UPSTOX" | "SIMULATION", processed: number, errors: number, message: string | null): ScanPayload["meta"] {
  return {
    ok: true, scanDate: dateKey, nowIst: istTimeLabel(now, true), marketPhase: phase, source,
    ranScan: true, lastScanAt: istTimeLabel(now, true), lastScanDate: dateKey, lastScanStatus: errors ? "PARTIAL" : "OK",
    universeSize: UNIVERSE.length, processed, errorCount: errors,
    counts: { confirmed: 0, setups: 0, watch: 0 }, message, error: null,
    config: { scanStart: SCANNER_CONFIG.scanStart, scanEnd: SCANNER_CONFIG.scanEnd, rescanSeconds: SCANNER_CONFIG.rescanSeconds, volRefCandles: SCANNER_CONFIG.volumeRefCandles, breakoutVolMin: SCANNER_CONFIG.breakoutVolMin, riskReward: SCANNER_CONFIG.riskReward },
  };
}

function eventsFor(rows: ScanRow[], tf: 1 | 3 | 5): SignalEventRow[] {
  return rows.filter(r => r.status === "CONFIRMED" || r.status === "SETUP").map((r, i) => ({
    id: i + 1, time: r.firstConfirmedAt ?? r.details?.triggerTime ?? "--:--", symbol: r.symbol, timeframeMinutes: tf,
    direction: r.direction, level: r.level, setup: r.setup, status: r.status, price: r.ltp,
    volumeMultiple: r.volumeMultiple, reason: `[${tf}M] ${r.reason}`,
  }));
}

function resultFor(tf: 1 | 3 | 5, rows: ScanRow[], errors: number): TimeframeScanResult {
  const confirmed = rows.filter(r => r.status === "CONFIRMED").length;
  const setups = rows.filter(r => r.status === "SETUP").length;
  const watch = rows.filter(r => r.status === "WATCH").length;
  const events = eventsFor(rows, tf);
  return {
    timeframeMinutes: tf, label: labels[tf], rows, events,
    counts: { confirmed, setups, watch }, processed: rows.length, errors,
    lastCandleTime: rows.map(r => r.details?.lastCandleTime).filter(Boolean).at(-1) ?? null,
  };
}

export async function getMultiDashboardPayload(force = false): Promise<ScanPayload> {
  const now = new Date();
  const dateKey = istDateKey(now);
  const phase = marketPhase(now, SCANNER_CONFIG);
  const cached = cache.get(dateKey);

  if (!force && cached && phase === "SCAN_ENDED") return { ...cached, meta: { ...cached.meta, ranScan: false, message: "Scan window ended — showing today's frozen 1M / 3M / 5M results." } };
  if (phase === "PRE_OPEN") {
    const timeframes = { "1": emptyResult(1), "3": emptyResult(3), "5": emptyResult(5) };
    const payload: ScanPayload = { meta: makeMeta(dateKey, now, phase, "UPSTOX", 0, 0, "Scanner starts at 09:15 IST; first completed signals appear at 09:16 / 09:18 / 09:20."), rows: [], events: [], timeframes };
    return payload;
  }

  const cutoff = candleCutoff(now, SCANNER_CONFIG, dateKey);
  const collected = await collectMultiMarketData(UNIVERSE, dateKey, cutoff, SCANNER_CONFIG.upstoxConcurrency);
  if (!collected.feeds.length) {
    if (cached) return { ...cached, meta: { ...cached.meta, ranScan: false, message: "Live 1M feed unavailable — showing last successful multi-timeframe scan." } };
    const timeframes = { "1": emptyResult(1), "3": emptyResult(3), "5": emptyResult(5) };
    return { meta: makeMeta(dateKey, now, phase, collected.source, 0, UNIVERSE.length, collected.notes.join(" | ")), rows: [], events: [], timeframes };
  }

  const timeframes = { "1": emptyResult(1), "3": emptyResult(3), "5": emptyResult(5) };
  let totalProcessed = 0;
  let totalErrors = 0;

  for (const tf of MULTI_TIMEFRAMES) {
    const rows: ScanRow[] = [];
    let errors = 0;
    for (const feed of collected.feeds) {
      if (!feed.levels || !feed.candles1m.length) { errors++; continue; }
      try {
        const { candles, warmup } = buildTimeframeCandles(feed, tf, cutoff);
        const row = analyzeQualitySymbol({ symbol: feed.symbol, timeframeMinutes: tf, candles, warmup, levels: feed.levels, ltpOverride: feed.ltp }, {
          timeframeMinutes: tf, emaPeriod: SCANNER_CONFIG.emaPeriod, volumeRefCandles: SCANNER_CONFIG.volumeRefCandles,
          volumeRefMinimum: SCANNER_CONFIG.volumeRefMinimum, breakoutVolMin: SCANNER_CONFIG.breakoutVolMin,
          nearLevelPct: SCANNER_CONFIG.nearLevelPct, minCandlesRequired: 1, riskReward: SCANNER_CONFIG.riskReward,
          slBufferPct: SCANNER_CONFIG.slBufferPct, scanStartMinutes: hhmmToMinutes(SCANNER_CONFIG.scanStart),
        });
        rows.push(row);
      } catch { errors++; }
    }
    timeframes[String(tf) as "1" | "3" | "5"] = resultFor(tf, rows, errors);
    totalProcessed += rows.length;
    totalErrors += errors;
  }

  const five = timeframes["5"];
  const allEvents = (Object.values(timeframes) as TimeframeScanResult[]).flatMap(x => x.events);
  const meta = makeMeta(dateKey, now, phase, collected.source, totalProcessed, totalErrors, collected.notes.join(" | "));
  meta.counts = {
    confirmed: five.counts.confirmed,
    setups: five.counts.setups,
    watch: five.counts.watch,
  };
  const payload: ScanPayload = { meta, rows: five.rows, events: allEvents, timeframes };
  cache.set(dateKey, payload);
  return payload;
}
