// This file is intentionally unchanged except for the serverless scan budget.
/**
 * Scan orchestration: runs the engine over the universe, persists results for
 * the trading day, maintains the signal event log, and assembles the
 * dashboard payload. A failed scan NEVER wipes the previous good results.
 */

import { db } from "@/db";
import { scanRuns, snapshots, signalEvents } from "@/db/schema";
import { and, desc, eq, lt } from "drizzle-orm";
import { SCANNER_CONFIG } from "./config";
import { UNIVERSE } from "./universe";
import { istDateKey, istTimeLabel, marketPhase, candleCutoff, epochForIst, type MarketPhase } from "./time";
import { analyzeSymbol, type EngineConfig } from "./prime";
import { collectMarketData } from "./marketData";
import { upstoxConfigured } from "./upstox";
import { STATUS_RANK } from "./types";
import type { ScanPayload, ScanRow, SignalEventRow, SignalStatus, Direction, SetupType, LevelTag, AuditDetails } from "./types";

const ENGINE_CFG: EngineConfig = {
  timeframeMinutes: SCANNER_CONFIG.timeframeMinutes,
  emaPeriod: SCANNER_CONFIG.emaPeriod,
  emaSlopeLookback: SCANNER_CONFIG.emaSlopeLookback,
  volumeRefCandles: SCANNER_CONFIG.volumeRefCandles,
  volumeRefMinimum: SCANNER_CONFIG.volumeRefMinimum,
  volStrong: SCANNER_CONFIG.volStrong,
  volHigh: SCANNER_CONFIG.volHigh,
  volVeryHigh: SCANNER_CONFIG.volVeryHigh,
  volExtreme: SCANNER_CONFIG.volExtreme,
  breakoutVolMin: SCANNER_CONFIG.breakoutVolMin,
  continuationVolMin: SCANNER_CONFIG.continuationVolMin,
  nearLevelPct: SCANNER_CONFIG.nearLevelPct,
  followThroughCandles: SCANNER_CONFIG.followThroughCandles,
  retestPct: SCANNER_CONFIG.retestPct,
  continuationLookback: SCANNER_CONFIG.continuationLookback,
  riskReward: SCANNER_CONFIG.riskReward,
  slBufferPct: SCANNER_CONFIG.slBufferPct,
  minCandlesRequired: SCANNER_CONFIG.minCandlesRequired,
};

interface StoredSnapshot {
  id: number; symbol: string; status: string; statusRank: number; level: string | null;
  pdh: number | null; pdl: number | null; firstConfirmedAt: Date | null;
}
const SIGNAL_STATUSES = new Set(["CONFIRMED", "SETUP", "WATCH"]);

function toScanRow(r: typeof snapshots.$inferSelect): ScanRow {
  return {
    symbol: r.symbol, ltp: r.ltp, changePct: r.changePct, dayOpen: r.dayOpen,
    volumeMultiple: r.volumeMultiple, volumeLabel: r.volumeLabel, ema20: r.ema20,
    emaBias: r.emaBias ?? "-", pdh: r.pdh, pdl: r.pdl, level: (r.level as LevelTag) ?? "-",
    distancePct: r.distancePct, setup: (r.setup as SetupType) ?? "NONE",
    status: (r.status as SignalStatus) ?? "NONE", direction: (r.direction as Direction) ?? "NONE",
    entry: r.entry, stopLoss: r.stopLoss, target: r.target, reason: r.reason,
    statusRank: r.statusRank, active: r.active,
    firstConfirmedAt: r.firstConfirmedAt ? istTimeLabel(r.firstConfirmedAt, true) : null,
    details: (r.details as AuditDetails | null) ?? null,
  };
}

/** Run one full scan and persist. Returns human message + counts. */
async function runScan(dateKey: string, phase: MarketPhase, forcedCutoff?: Date): Promise<{ error: string | null; message: string | null }> {
  const startedAt = new Date();
  const source = upstoxConfigured() ? "UPSTOX" : "SIMULATION";
  const cutoff = forcedCutoff ?? candleCutoff(startedAt, SCANNER_CONFIG, dateKey);
  const collected = await collectMarketData(UNIVERSE, dateKey, cutoff, {
    concurrency: SCANNER_CONFIG.upstoxConcurrency,
    requestTimeoutMs: SCANNER_CONFIG.requestTimeoutMs,
    maxRetries: SCANNER_CONFIG.maxRetries,
    timeframeMinutes: SCANNER_CONFIG.timeframeMinutes,
    budgetMs: 45000,
  });

  let processed = 0;
  let errorCount = 0;
  const fresh = new Map<string, ScanRow>();
  for (const feed of collected.feeds) {
    if (!feed.levels || feed.candles.length === 0) { if (feed.error) errorCount++; continue; }
    try {
      const row = analyzeSymbol({ symbol: feed.symbol, candles: feed.candles, warmup: feed.warmup, levels: feed.levels, ltpOverride: feed.ltp }, ENGINE_CFG);
      fresh.set(feed.symbol, row); processed++;
    } catch { errorCount++; }
  }

  if (processed === 0) {
    const msg = source === "UPSTOX" ? "Upstox temporarily returned no usable 5-minute candles. Showing last successful scan." : "No usable candles produced. Showing last successful scan.";
    try { await db.insert(scanRuns).values({ scanDate: dateKey, startedAt, finishedAt: new Date(), status: "ERROR", source: collected.source, marketPhase: phase, universeSize: UNIVERSE.length, processed: 0, errorCount, message: msg }); } catch {}
    return { error: msg, message: null };
  }

  const now = new Date();
  let existing: StoredSnapshot[] = [];
  try {
    existing = await db.select({ id: snapshots.id, symbol: snapshots.symbol, status: snapshots.status, statusRank: snapshots.statusRank, level: snapshots.level, pdh: snapshots.pdh, pdl: snapshots.pdl, firstConfirmedAt: snapshots.firstConfirmedAt }).from(snapshots).where(eq(snapshots.scanDate, dateKey));
  } catch {}

  const oldBySymbol = new Map(existing.map((r) => [r.symbol, r]));
  for (const [symbol, row] of fresh) {
    const old = oldBySymbol.get(symbol);
    const oldActive = old ? SIGNAL_STATUSES.has(old.status) : false;
    const newActive = SIGNAL_STATUSES.has(row.status);
    const keepFirst = old?.firstConfirmedAt ?? (newActive && row.status === "CONFIRMED" ? now : null);
    try {
      if (old) {
        await db.update(snapshots).set({ ...row, active: newActive || oldActive, firstConfirmedAt: keepFirst }).where(eq(snapshots.id, old.id));
      } else {
        await db.insert(snapshots).values({ ...row, scanDate: dateKey, active: newActive, firstConfirmedAt: keepFirst });
      }
    } catch {}
  }

  try {
    await db.insert(scanRuns).values({ scanDate: dateKey, startedAt, finishedAt: new Date(), status: "OK", source: collected.source, marketPhase: phase, universeSize: UNIVERSE.length, processed, errorCount, message: collected.notes.join(" | ") });
  } catch {}
  return { error: null, message: `Scanned ${processed}/${UNIVERSE.length} symbols` };
}

export async function getDashboardPayload(force = false): Promise<ScanPayload> {
  const now = new Date();
  const dateKey = istDateKey(now);
  const phase = marketPhase(now, SCANNER_CONFIG);
  let ranScan = false;
  let runError: string | null = null;
  let runMessage: string | null = null;

  if (phase === "LIVE_SCAN" && (force || await shouldRescan(dateKey))) {
    ranScan = true;
    const result = await runScan(dateKey, phase);
    runError = result.error;
    runMessage = result.message;
  }

  const rows = await loadRows(dateKey);
  const events = await loadEvents(dateKey);
  const last = await loadLastRun(dateKey);
  return {
    meta: {
      ok: !runError,
      scanDate: dateKey,
      nowIst: istTimeLabel(now, true),
      marketPhase: phase,
      source: upstoxConfigured() ? "UPSTOX" : "SIMULATION",
      ranScan,
      lastScanAt: last?.finishedAt?.toISOString() ?? null,
      lastScanDate: last?.scanDate ?? null,
      lastScanStatus: last?.status ?? null,
      universeSize: UNIVERSE.length,
      processed: last?.processed ?? rows.length,
      errorCount: last?.errorCount ?? 0,
      counts: {
        confirmed: rows.filter((r) => r.status === "CONFIRMED").length,
        setups: rows.filter((r) => r.status === "SETUP").length,
        watch: rows.filter((r) => r.status === "WATCH").length,
      },
      message: runMessage,
      error: runError,
      config: { scanStart: SCANNER_CONFIG.scanStart, scanEnd: SCANNER_CONFIG.scanEnd, rescanSeconds: SCANNER_CONFIG.rescanSeconds, volRefCandles: SCANNER_CONFIG.volumeRefCandles, breakoutVolMin: SCANNER_CONFIG.breakoutVolMin, riskReward: SCANNER_CONFIG.riskReward },
    },
    rows, events,
  };
}

async function shouldRescan(dateKey: string): Promise<boolean> {
  const last = await loadLastRun(dateKey);
  if (!last) return true;
  return Date.now() - last.finishedAt.getTime() >= SCANNER_CONFIG.rescanSeconds * 1000;
}

async function loadRows(dateKey: string): Promise<ScanRow[]> {
  try {
    const rows = await db.select().from(snapshots).where(eq(snapshots.scanDate, dateKey)).orderBy(desc(snapshots.statusRank), desc(snapshots.symbol));
    return rows.map(toScanRow);
  } catch { return []; }
}

async function loadEvents(dateKey: string): Promise<SignalEventRow[]> {
  try {
    const rows = await db.select().from(signalEvents).where(eq(signalEvents.scanDate, dateKey)).orderBy(desc(signalEvents.id)).limit(SCANNER_CONFIG.eventLogLimit);
    return rows.map((r) => ({ id: r.id, time: istTimeLabel(r.time, true), symbol: r.symbol, direction: (r.direction as Direction) ?? "NONE", level: (r.level as LevelTag) ?? "-", setup: (r.setup as SetupType) ?? "NONE", status: (r.status as SignalStatus) ?? "NONE", price: r.price, volumeMultiple: r.volumeMultiple, reason: r.reason }));
  } catch { return []; }
}

async function loadLastRun(dateKey: string) {
  try { return (await db.select().from(scanRuns).where(eq(scanRuns.scanDate, dateKey)).orderBy(desc(scanRuns.id)).limit(1))[0] ?? null; }
  catch { return null; }
}
