/**
 * Shared type contracts between the scanner engine and the dashboard.
 */

export interface CandlePoint { t: number; label: string; o: number; h: number; l: number; c: number; v: number; }
export interface PrevDayLevels { pdh: number; pdl: number; prevClose: number; prevOpen: number; dayKey: string; }

export type SignalStatus = "CONFIRMED" | "SETUP" | "WATCH" | "NONE";
export type Direction = "BUY" | "SELL" | "NONE";
export type SetupType = "PDH_BUY" | "PDL_SELL" | "BUY_CONTINUATION" | "SELL_CONTINUATION" | "NONE";
export type LevelTag = "PDH" | "PDL" | "-";

export const STATUS_RANK = {
  CONFIRMED_PDH_BUY: 0,
  CONFIRMED_PDL_SELL: 1,
  CONFIRMED_BUY_CONTINUATION: 2,
  CONFIRMED_SELL_CONTINUATION: 3,
  SETUP: 4,
  WATCH: 5,
  NONE: 9,
} as const;

export interface AuditCheck { label: string; ok: boolean | null; value: string; }
export interface FollowThroughPoint { time: string; close: number; low: number; high: number; held: boolean; }

export interface AuditDetails {
  pdh: number | null; pdl: number | null; prevClose: number | null;
  triggerType: string | null; triggerTime: string | null;
  triggerOpen: number | null; triggerHigh: number | null; triggerLow: number | null; triggerClose: number | null;
  triggerVolume: number | null; referenceVolume: number | null; volumeMultiple: number | null; volumeLabel: string | null;
  emaAtTrigger: number | null; emaNow: number | null; emaSlope: string | null;
  followThrough: FollowThroughPoint[]; confirmationTime: string | null; priceAtConfirmation: number | null;
  entry: number | null; stopLoss: number | null; target: number | null; riskReward: number | null;
  candlesAnalyzed: number; lastCandleTime: string | null; checks: AuditCheck[]; failureNote: string | null;
}

export interface ScanRow {
  symbol: string;
  timeframeMinutes?: number;
  ltp: number | null; changePct: number | null; dayOpen: number | null;
  volumeMultiple: number | null; volumeLabel: string | null; ema20: number | null; emaBias: string;
  pdh: number | null; pdl: number | null; level: LevelTag; distancePct: number | null;
  setup: SetupType; status: SignalStatus; direction: Direction;
  entry: number | null; stopLoss: number | null; target: number | null; reason: string;
  statusRank: number; active: boolean; firstConfirmedAt: string | null; details: AuditDetails | null;
}

export interface SignalEventRow {
  id: number; time: string; symbol: string; timeframeMinutes?: number;
  direction: Direction; level: LevelTag; setup: SetupType; status: SignalStatus;
  price: number | null; volumeMultiple: number | null; reason: string;
}

export type MarketPhaseLabel = "PRE_OPEN" | "LIVE_SCAN" | "SCAN_ENDED" | "CLOSED";

export interface ScanMeta {
  ok: boolean; scanDate: string; nowIst: string; marketPhase: MarketPhaseLabel;
  source: "UPSTOX" | "SIMULATION"; ranScan: boolean; lastScanAt: string | null; lastScanDate: string | null;
  lastScanStatus: string | null; universeSize: number; processed: number; errorCount: number;
  counts: { confirmed: number; setups: number; watch: number };
  message: string | null; error: string | null;
  config: { scanStart: string; scanEnd: string; rescanSeconds: number; volRefCandles: number; breakoutVolMin: number; riskReward: number; };
}

export interface TimeframeScanResult {
  timeframeMinutes: 1 | 3 | 5;
  label: "1 MIN" | "3 MIN" | "5 MIN";
  rows: ScanRow[];
  events: SignalEventRow[];
  counts: { confirmed: number; setups: number; watch: number };
  processed: number;
  errors: number;
  lastCandleTime: string | null;
}

export interface ScanPayload {
  meta: ScanMeta;
  rows: ScanRow[];
  events: SignalEventRow[];
  timeframes?: Record<"1" | "3" | "5", TimeframeScanResult>;
}
