import { db } from "@/db";
import { scanRuns, snapshots, signalEvents } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { UNIVERSE } from "./universe";
import { SCANNER_CONFIG } from "./config";
import { istDateKey, istTimeLabel } from "./time";
import type { ScanPayload, ScanRow, SignalEventRow, Direction, SetupType, LevelTag, SignalStatus, AuditDetails } from "./types";

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

export async function getLockedDashboardPayload(): Promise<ScanPayload> {
  const now = new Date();
  const today = istDateKey(now);
  let effectiveDate = today;
  let rows: ScanRow[] = [];
  let events: SignalEventRow[] = [];
  let lastRun: typeof scanRuns.$inferSelect | null = null;

  try {
    const todayRows = await db.select().from(snapshots).where(eq(snapshots.scanDate, today));
    rows = todayRows
      .map(toScanRow)
      .filter((r) => SIGNAL_STATUSES.has(r.status))
      .sort((a, b) => a.statusRank - b.statusRank);

    if (!rows.length) {
      const latest = await db.select({ scanDate: snapshots.scanDate })
        .from(snapshots)
        .orderBy(desc(snapshots.scanDate))
        .limit(1);
      if (latest[0]?.scanDate && latest[0].scanDate !== today) {
        effectiveDate = latest[0].scanDate;
        const persisted = await db.select().from(snapshots).where(eq(snapshots.scanDate, effectiveDate));
        rows = persisted
          .map(toScanRow)
          .filter((r) => SIGNAL_STATUSES.has(r.status))
          .sort((a, b) => a.statusRank - b.statusRank);
      }
    }

    const runRows = await db.select().from(scanRuns)
      .where(eq(scanRuns.scanDate, effectiveDate))
      .orderBy(desc(scanRuns.id))
      .limit(20);
    lastRun = runRows.find((r) => r.status === "OK" || r.status === "PARTIAL") ?? runRows[0] ?? null;

    const eventRows = await db.select().from(signalEvents)
      .where(eq(signalEvents.scanDate, effectiveDate))
      .orderBy(desc(signalEvents.id))
      .limit(SCANNER_CONFIG.eventLogLimit);
    events = eventRows.map((e) => ({
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
    // A locked dashboard must still render even if persistence is temporarily unavailable.
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
      nowIst: istTimeLabel(now, true),
      marketPhase: "SCAN_ENDED",
      source: "UPSTOX",
      ranScan: false,
      lastScanAt: lastRun ? istTimeLabel(lastRun.finishedAt ?? lastRun.startedAt, true) : null,
      lastScanDate: effectiveDate,
      lastScanStatus: lastRun?.status ?? null,
      universeSize: UNIVERSE.length,
      processed: lastRun?.processed ?? 0,
      errorCount: lastRun?.errorCount ?? 0,
      counts,
      message: rows.length
        ? `Live scan window (${SCANNER_CONFIG.scanStart}–${SCANNER_CONFIG.scanEnd} IST) ended — results are locked for the day.`
        : `Live scan window (${SCANNER_CONFIG.scanStart}–${SCANNER_CONFIG.scanEnd} IST) ended. No persisted signals are available yet.`,
      error: null,
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
