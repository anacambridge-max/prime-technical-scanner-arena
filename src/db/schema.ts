import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * One row per scan attempt. Used for "last successful scan" tracking,
 * error banners and the audit trail.
 */
export const scanRuns = pgTable(
  "scan_runs",
  {
    id: serial("id").primaryKey(),
    scanDate: text("scan_date").notNull(), // IST YYYY-MM-DD
    startedAt: timestamp("started_at", { withTimezone: false }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: false }),
    status: text("status").notNull(), // OK | PARTIAL | ERROR | SKIPPED
    source: text("source").notNull(), // UPSTOX | SIMULATION
    marketPhase: text("market_phase").notNull(),
    universeSize: integer("universe_size").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    confirmed: integer("confirmed").notNull().default(0),
    setups: integer("setups").notNull().default(0),
    watch: integer("watch").notNull().default(0),
    message: text("message"),
  },
  (t) => [index("scan_runs_date_idx").on(t.scanDate)]
);

/**
 * Latest per-symbol scanner state for a scan date. Results are persisted for
 * the whole trading day (upserted on every scan, never wiped by a failed scan).
 */
export const snapshots = pgTable(
  "snapshots",
  {
    id: serial("id").primaryKey(),
    scanDate: text("scan_date").notNull(),
    symbol: text("symbol").notNull(),
    ltp: doublePrecision("ltp"),
    changePct: doublePrecision("change_pct"),
    dayOpen: doublePrecision("day_open"),
    volumeMultiple: doublePrecision("volume_multiple"),
    volumeLabel: text("volume_label"),
    ema20: doublePrecision("ema20"),
    emaBias: text("ema_bias"),
    pdh: doublePrecision("pdh"),
    pdl: doublePrecision("pdl"),
    level: text("level"),
    distancePct: doublePrecision("distance_pct"),
    setup: text("setup").notNull().default("NONE"),
    status: text("status").notNull().default("NONE"),
    direction: text("direction").notNull().default("NONE"),
    entry: doublePrecision("entry"),
    stopLoss: doublePrecision("stop_loss"),
    target: doublePrecision("target"),
    reason: text("reason").notNull().default(""),
    details: jsonb("details"),
    statusRank: integer("status_rank").notNull().default(9),
    active: boolean("active").notNull().default(true),
    firstConfirmedAt: timestamp("first_confirmed_at", { withTimezone: false }),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull(),
  },
  (t) => [
    uniqueIndex("snapshots_date_symbol_uq").on(t.scanDate, t.symbol),
    index("snapshots_date_idx").on(t.scanDate),
  ]
);

/** Immutable signal event log (TIME / STOCK / DIRECTION / LEVEL / ... ). */
export const signalEvents = pgTable(
  "signal_events",
  {
    id: serial("id").primaryKey(),
    scanDate: text("scan_date").notNull(),
    ts: timestamp("ts", { withTimezone: false }).notNull(),
    timeLabel: text("time_label").notNull(),
    symbol: text("symbol").notNull(),
    direction: text("direction").notNull(),
    level: text("level").notNull(),
    setup: text("setup").notNull(),
    status: text("status").notNull(),
    price: doublePrecision("price"),
    volumeMultiple: doublePrecision("volume_multiple"),
    reason: text("reason").notNull().default(""),
  },
  (t) => [index("signal_events_date_idx").on(t.scanDate)]
);

/** NSE trading symbol -> Upstox instrument key cache. */
export const instrumentMap = pgTable("instrument_map", {
  symbol: text("symbol").primaryKey(),
  instrumentKey: text("instrument_key").notNull(),
  name: text("name"),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull(),
});

/** Small key/value store (levels cache per day, misc flags). */
export const kvStore = pgTable("kv_store", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull(),
});
