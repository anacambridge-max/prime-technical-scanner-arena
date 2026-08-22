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
import {
  istDateKey,
  istTimeLabel,
  marketPhase,
  candleCutoff,
  epochForIst,
  type MarketPhase,
} from "./time";
import { analyzeSymbol, type EngineConfig } from "./prime";
import { collectMarketData } from "./marketData";
import { upstoxConfigured } from "./upstox";
import { STATUS_RANK } from "./types";
import type {
  ScanPayload,
  ScanRow,
  SignalEventRow,
  SignalStatus,
  Direction,
  SetupType,
  LevelTag,
  AuditDetails,
} from "./types";

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
  id: number;
  symbol: string;
  status: string;
  statusRank: number;
  level: string | null;
  pdh: number | null;
  pdl: number | null;
  firstConfirmedAt: Date | null;
}

const SIGNAL_STATUSES = new Set(["CONFIRMED", "SETUP", "WATCH"]);

function toScanRow(r: typeof snapshots.$inferSelect): ScanRow {
  return {
    symbol: r.symbol,
    ltp: r.ltp,
    changePct: r.changePct,
    dayOpen: r.dayOpen,
    volumeMultiple: r.volumeMultiple,
    volumeLabel: r.volumeLabel,
    ema20: r.ema20,
    emaBias: r.emaBias ?? "-",
    pdh: r.pdh,
    pdl: r.pdl,
    level: (r.level as LevelTag) ?? "-",
    distancePct: r.distancePct,
    setup: (r.setup as SetupType) ?? "NONE",
    status: (r.status as SignalStatus) ?? "NONE",
    direction: (r.direction as Direction) ?? "NONE",
    entry: r.entry,
    stopLoss: r.stopLoss,
    target: r.target,
    reason: r.reason,
    statusRank: r.statusRank,
    active: r.active,
    firstConfirmedAt: r.firstConfirmedAt ? istTimeLabel(r.firstConfirmedAt, true) : null,
    details: (r.details as AuditDetails | null) ?? null,
  };
}

/** Run one full scan and persist. Returns human message + counts. */
async function runScan(
  dateKey: string,
  phase: MarketPhase,
  forcedCutoff?: Date
): Promise<{ error: string | null; message: string | null }> {
  const startedAt = new Date();
  const source = upstoxConfigured() ? "UPSTOX" : "SIMULATION";
  const cutoff = forcedCutoff ?? candleCutoff(startedAt, SCANNER_CONFIG, dateKey);

  const collected = await collectMarketData(UNIVERSE, dateKey, cutoff, {
    concurrency: SCANNER_CONFIG.upstoxConcurrency,
    requestTimeoutMs: SCANNER_CONFIG.requestTimeoutMs,
    maxRetries: SCANNER_CONFIG.maxRetries,
    timeframeMinutes: SCANNER_CONFIG.timeframeMinutes,
    budgetMs: 50000,
  });

  let processed = 0;
  let errorCount = 0;
  const fresh = new Map<string, ScanRow>();
  for (const feed of collected.feeds) {
    if (!feed.levels || feed.candles.length === 0) {
      if (feed.error) errorCount++;
      continue;
    }
    try {
      const row = analyzeSymbol(
        {
          symbol: feed.symbol,
          candles: feed.candles,
          warmup: feed.warmup,
          levels: feed.levels,
          ltpOverride: feed.ltp,
        },
        ENGINE_CFG
      );
      fresh.set(feed.symbol, row);
      processed++;
    } catch {
      errorCount++;
    }
  }

  // Total failure: never overwrite a previously good scan with emptiness.
  if (processed === 0) {
    const msg =
      source === "UPSTOX"
        ? "Upstox temporarily returned no usable 5-minute candles. Showing last successful scan."
        : "No usable candles produced. Showing last successful scan.";
    try {
      await db.insert(scanRuns).values({
        scanDate: dateKey,
        startedAt,
        finishedAt: new Date(),
        status: "ERROR",
        source: collected.source,
        marketPhase: phase,
        universeSize: UNIVERSE.length,
        processed: 0,
        errorCount,
        message: msg,
      });
    } catch {
      // db note best-effort
    }
    return { error: msg, message: null };
  }

  // ---- merge with today's persisted state ------------------------------
  const now = new Date();
  let existing: StoredSnapshot[] = [];
  try {
    existing = await db
      .select({
        id: snapshots.id,
        symbol: snapshots.symbol,
        status: snapshots.status,
        statusRank: snapshots.statusRank,
        level: snapshots.level,
        pdh: snapshots.pdh,
        pdl: snapshots.pdl,
        firstConfirmedAt: snapshots.firstConfirmedAt,
      })
      .from(snapshots)
      .where(eq(snapshots.scanDate, dateKey));
  } catch {
    existing = [];
  }
  const prevBySymbol = new Map(existing.map((e) => [e.symbol, e]));

  const eventRows: (typeof signalEvents.$inferInsert)[] = [];
  let confirmed = 0;
  let setups = 0;
  let watch = 0;

  const upserts: (typeof snapshots.$inferInsert)[] = [];

  for (const [symbol, row] of fresh) {
    const prev = prevBySymbol.get(symbol);

    // CONFIRMED is a historical fact for the day — never downgrade it.
    if (prev && prev.status === "CONFIRMED" && row.statusRank > STATUS_RANK.SETUP) {
      const lvl = prev.level === "PDH" ? prev.pdh : prev.level === "PDL" ? prev.pdl : null;
      const stillBeyond =
        lvl != null && row.ltp != null
          ? prev.level === "PDH"
            ? row.ltp > lvl
            : row.ltp < lvl
          : true;
      upserts.push({
        scanDate: dateKey,
        symbol,
        ltp: row.ltp,
        changePct: row.changePct,
        active: stillBeyond,
        updatedAt: now,
      } as typeof snapshots.$inferInsert);
      continue;
    }

    if (row.status === "NONE") {
      // Keep prior signal rows for the day (faded), just refresh LTP.
      if (prev && SIGNAL_STATUSES.has(prev.status)) {
        upserts.push({
          scanDate: dateKey,
          symbol,
          ltp: row.ltp,
          changePct: row.changePct,
          active: false,
          updatedAt: now,
        } as typeof snapshots.$inferInsert);
      }
      continue;
    }

    const escalated = !prev || row.statusRank < prev.statusRank;
    upserts.push({
      scanDate: dateKey,
      symbol,
      ltp: row.ltp,
      changePct: row.changePct,
      dayOpen: row.dayOpen,
      volumeMultiple: row.volumeMultiple,
      volumeLabel: row.volumeLabel,
      ema20: row.ema20,
      emaBias: row.emaBias,
      pdh: row.pdh,
      pdl: row.pdl,
      level: row.level,
      distancePct: row.distancePct,
      setup: row.setup,
      status: row.status,
      direction: row.direction,
      entry: row.entry,
      stopLoss: row.stopLoss,
      target: row.target,
      reason: row.reason,
      details: row.details,
      statusRank: row.statusRank,
      active: row.active,
      firstConfirmedAt:
        row.status === "CONFIRMED"
          ? prev?.firstConfirmedAt ?? now
          : prev?.firstConfirmedAt ?? null,
      updatedAt: now,
    });

    if (escalated && (row.status === "SETUP" || row.status === "CONFIRMED")) {
      // Prefer the candle-based signal time (confirmation / trigger) so the
      // log can be cross-checked 1:1 against TradingView charts.
      const signalTime =
        row.details?.confirmationTime ?? row.details?.triggerTime ?? null;
      eventRows.push({
        scanDate: dateKey,
        ts: now,
        timeLabel: signalTime ?? istTimeLabel(now, true),
        symbol,
        direction: row.direction,
        level: row.level,
        setup: row.setup,
        status: row.status,
        price: row.ltp,
        volumeMultiple: row.volumeMultiple,
        reason: row.reason,
      });
    }
  }

  // Count statuses across today's FULL persisted state.
  const finalState = new Map<string, { status: string; rank: number }>();
  for (const e of existing) finalState.set(e.symbol, { status: e.status, rank: e.statusRank });
  for (const u of upserts) {
    if (u.status) finalState.set(u.symbol, { status: u.status as string, rank: u.statusRank ?? 9 });
  }
  for (const v of finalState.values()) {
    if (v.status === "CONFIRMED") confirmed++;
    else if (v.status === "SETUP") setups++;
    else if (v.status === "WATCH") watch++;
  }

  const dbWrites = async () => {
    for (const u of upserts) {
      const { scanDate: sd, symbol: sym, ...rest } = u;
      await db
        .insert(snapshots)
        .values({ ...u, scanDate: sd ?? dateKey, symbol: sym } as typeof snapshots.$inferInsert)
        .onConflictDoUpdate({
          target: [snapshots.scanDate, snapshots.symbol],
          set: rest as Record<string, unknown>,
        });
    }
    if (eventRows.length) await db.insert(signalEvents).values(eventRows);
    await db.insert(scanRuns).values({
      scanDate: dateKey,
      startedAt,
      finishedAt: new Date(),
      status: errorCount > 0 ? "PARTIAL" : "OK",
      source: collected.source,
      marketPhase: phase,
      universeSize: UNIVERSE.length,
      processed,
      errorCount,
      confirmed,
      setups,
      watch,
      message:
        errorCount > 0
          ? `${errorCount} symbol(s) failed to load and were skipped.`
          : null,
    });
    // "Results persist for a day": purge older trading days.
    await db.delete(snapshots).where(lt(snapshots.scanDate, dateKey));
    await db.delete(signalEvents).where(lt(signalEvents.scanDate, dateKey));
    await db.delete(scanRuns).where(lt(scanRuns.scanDate, dateKey));
  };
  try {
    await dbWrites();
  } catch (err) {
    return { error: `Database write failed: ${(err as Error).message}`, message: null };
  }

  return {
    error: null,
    message:
      errorCount > 0
        ? `Scan complete with ${processed} symbols (${errorCount} skipped).`
        : null,
  };
}

/** Latest scan run for a date (for "last update" display). */
async function latestRunInfo(dateKey: string): Promise<{
  at: string | null;
  status: string | null;
  source: string | null;
  processed: number;
  errorCount: number;
  message: string | null;
}> {
  try {
    const rows = await db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.scanDate, dateKey))
      .orderBy(desc(scanRuns.id))
      .limit(8);
    const good = rows.find((r) => r.status === "OK" || r.status === "PARTIAL");
    const any = rows[0];
    const ref = good ?? any;
    if (!ref) {
      return { at: null, status: null, source: null, processed: 0, errorCount: 0, message: null };
    }
    return {
      at: istTimeLabel(ref.finishedAt ?? ref.startedAt, true),
      status: ref.status,
      source: ref.source,
      processed: ref.processed,
      errorCount: ref.errorCount,
      message: ref.message,
    };
  } catch {
    return { at: null, status: null, source: null, processed: 0, errorCount: 0, message: null };
  }
}

async function loadRowsForDate(dateKey: string): Promise<ScanRow[]> {
  try {
    const rows = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.scanDate, dateKey));
    return rows
      .map(toScanRow)
      .filter((r) => SIGNAL_STATUSES.has(r.status))
      .sort((a, b) => a.statusRank - b.statusRank);
  } catch {
    return [];
  }
}

async function loadEventsForDate(dateKey: string): Promise<SignalEventRow[]> {
  try {
    const rows = await db
      .select()
      .from(signalEvents)
      .where(eq(signalEvents.scanDate, dateKey))
      .orderBy(desc(signalEvents.id))
      .limit(SCANNER_CONFIG.eventLogLimit);
    return rows.map((e) => ({
      id: e.id,
      time: e.timeLabel,
      symbol: e.symbol,
      direction: e.direction as Direction,
      level: e.level as LevelTag,
      setup: e.setup as SetupType,
      status: e.status as SignalStatus,
      price: e.price,
      volumeMultiple: e.volumeMultiple,
      reason: e.reason,
    }));
  } catch {
    return [];
  }
}

async function latestPersistedDate(): Promise<string | null> {
  try {
    const rows = await db
      .select({ d: snapshots.scanDate })
      .from(snapshots)
      .orderBy(desc(snapshots.scanDate))
      .limit(1);
    return rows[0]?.d ?? null;
  } catch {
    return null;
  }
}

export async function getDashboardPayload(force = false): Promise<ScanPayload> {
  const now = new Date();
  const dateKey = istDateKey(now);
  const phase = marketPhase(now, SCANNER_CONFIG);
  const source = upstoxConfigured() ? "UPSTOX" : "SIMULATION";
  const nowIst = istTimeLabel(now, true);

  let ranScan = false;
  let error: string | null = null;
  let message: string | null = null;

  if (phase === "LIVE_SCAN") {
    // Run when due (or when forced via manual refresh), respecting rescan gap.
    let due = force;
    if (!due) {
      try {
        const rows = await db
          .select({ startedAt: scanRuns.startedAt })
          .from(scanRuns)
          .where(eq(scanRuns.scanDate, dateKey))
          .orderBy(desc(scanRuns.id))
          .limit(1);
        const last = rows[0]?.startedAt;
        due =
          !last || now.getTime() - last.getTime() >= SCANNER_CONFIG.rescanSeconds * 1000;
      } catch {
        due = true;
      }
    }
    if (due) {
      ranScan = true;
      const result = await runScan(dateKey, phase);
      error = result.error;
      message = result.message;
    }
  } else if (phase === "PRE_OPEN") {
    message = `Pre-open — live scanning starts at ${SCANNER_CONFIG.scanStart} IST.`;
  } else if (phase === "SCAN_ENDED") {
    message = `Live scan window (${SCANNER_CONFIG.scanStart}–${SCANNER_CONFIG.scanEnd} IST) ended — results are locked for the day.`;
  } else {
    message = "Market closed — showing the last available scan.";
  }

  // Simulation replay: with no token configured and no data yet, replay the
  // full scan window once so the dashboard demonstrates the complete engine
  // (clearly labeled). LIVE mode stays strict — no window, no fresh scan.
  let effectiveDate = dateKey;
  let rows = await loadRowsForDate(dateKey);
  if (
    phase !== "LIVE_SCAN" &&
    rows.length === 0 &&
    source === "SIMULATION"
  ) {
    ranScan = true;
    const forced = epochForIst(dateKey, SCANNER_CONFIG.scanEnd);
    const result = await runScan(dateKey, phase, forced);
    error = result.error;
    rows = await loadRowsForDate(dateKey);
    message =
      phase === "CLOSED"
        ? `Market closed — simulation replay of the full ${SCANNER_CONFIG.scanStart}–${SCANNER_CONFIG.scanEnd} IST window. Set UPSTOX_ACCESS_TOKEN for live data.`
        : `Simulation replay of the ${SCANNER_CONFIG.scanStart}–${SCANNER_CONFIG.scanEnd} IST window (${phase === "PRE_OPEN" ? "market opens later" : "scan window ended"}). Set UPSTOX_ACCESS_TOKEN for live data.`;
  }
  let lastScanDate = dateKey;
  if (rows.length === 0 && phase !== "LIVE_SCAN") {
    const persisted = await latestPersistedDate();
    if (persisted && persisted !== dateKey) {
      rows = await loadRowsForDate(persisted);
      effectiveDate = persisted;
      lastScanDate = persisted;
    }
  }
  const events = await loadEventsForDate(effectiveDate);
  const runInfo = await latestRunInfo(effectiveDate);

  // If the live run just failed but we still hold previous rows, surface the
  // error banner while keeping data on screen.
  if (error && rows.length > 0) {
    message = `${error}`;
  }

  const counts = { confirmed: 0, setups: 0, watch: 0 };
  for (const r of rows) {
    if (r.status === "CONFIRMED") counts.confirmed++;
    else if (r.status === "SETUP") counts.setups++;
    else if (r.status === "WATCH") counts.watch++;
  }

  return {
    meta: {
      ok: true,
      scanDate: effectiveDate,
      nowIst,
      marketPhase: phase,
      source: (runInfo.source as "UPSTOX" | "SIMULATION") ?? source,
      ranScan,
      lastScanAt: runInfo.at,
      lastScanDate,
      lastScanStatus: runInfo.status,
      universeSize: UNIVERSE.length,
      processed: runInfo.processed,
      errorCount: runInfo.errorCount,
      counts,
      message,
      error,
      config: {
        scanStart: SCANNER_CONFIG.scanStart,
        scanEnd: SCANNER_CONFIG.scanEnd,
        rescanSeconds: SCANNER_CONFIG.rescanSeconds,
        volRefCandles: SCANNER_CONFIG.volumeRefCandles,
        breakoutVolMin: SCANNER_CONFIG.breakoutVolMin,
        riskReward: SCANNER_CONFIG.riskReward,
      },
    },
    rows,
    events,
  };
}
