/**
 * PRIME TECHNICAL — core signal engine (pure functions, zero IO).
 *
 * Rules implemented (strict, confirmation-first):
 *  - PDH / PDL are the PRIMARY levels (previous completed day, never today's).
 *  - Only COMPLETED 5-minute candles confirm anything.
 *  - Break needs candle CLOSE beyond the level (preferably high/low too).
 *  - Breakout/breakdown candle must satisfy the volume-multiple condition.
 *  - 20 EMA is a filter/alignment check, never a standalone trigger.
 *  - Follow-through must hold the level. Failed breaks are never confirmed.
 *  - Three states only: WATCH -> SETUP -> CONFIRMED (+ persisted history).
 */

import type {
  CandlePoint,
  PrevDayLevels,
  SignalStatus,
  Direction,
  SetupType,
  LevelTag,
  AuditDetails,
  AuditCheck,
  FollowThroughPoint,
  ScanRow,
} from "./types";
import { STATUS_RANK } from "./types";
import { emaSeries, emaSlope, emaBiasLabel, type EmaSlope } from "./indicators";
import { volumeMultiple, volumeLabel } from "./volume";

export interface EngineConfig {
  timeframeMinutes: number;
  emaPeriod: number;
  emaSlopeLookback: number;
  volumeRefCandles: number;
  volumeRefMinimum: number;
  volStrong: number;
  volHigh: number;
  volVeryHigh: number;
  volExtreme: number;
  breakoutVolMin: number;
  continuationVolMin: number;
  nearLevelPct: number;
  followThroughCandles: number;
  retestPct: number;
  continuationLookback: number;
  riskReward: number;
  slBufferPct: number;
  minCandlesRequired: number;
}

interface SideResult {
  direction: Direction;
  setup: SetupType;
  level: LevelTag;
  levelPrice: number;
  status: SignalStatus;
  statusRank: number;
  reason: string;
  entry: number | null;
  stopLoss: number | null;
  target: number | null;
  triggerIndex: number | null;
  confirmationIndex: number | null;
  active: boolean;
  details: AuditDetails;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function maxOf(arr: number[], from: number, to: number): number {
  let m = -Infinity;
  for (let i = Math.max(0, from); i <= Math.min(arr.length - 1, to); i++) {
    if (arr[i] > m) m = arr[i];
  }
  return m;
}

function minOf(arr: number[], from: number, to: number): number {
  let m = Infinity;
  for (let i = Math.max(0, from); i <= Math.min(arr.length - 1, to); i++) {
    if (arr[i] < m) m = arr[i];
  }
  return m;
}

/**
 * Evaluate one side (BUY around PDH or SELL around PDL) and return the best
 * candidate for that side, or null when nothing actionable exists.
 */
function evaluateSide(
  side: "BUY" | "SELL",
  candles: CandlePoint[],
  levels: PrevDayLevels,
  closes: number[],
  highs: number[],
  lows: number[],
  vols: number[],
  ema: (number | null)[],
  cfg: EngineConfig,
  startIdx: number
): SideResult | null {
  const n = candles.length;
  const last = n - 1;
  const isBuy = side === "BUY";
  const level: LevelTag = isBuy ? "PDH" : "PDL";
  const levelPrice = isBuy ? levels.pdh : levels.pdl;
  if (!Number.isFinite(levelPrice) || levelPrice <= 0) return null;

  const setupBase: SetupType = isBuy ? "PDH_BUY" : "PDL_SELL";
  const contSetup: SetupType = isBuy ? "BUY_CONTINUATION" : "SELL_CONTINUATION";

  const lastClose = closes[last];
  const emaLast = ema[last];
  const slopeLast = emaSlope(ema, last, cfg.emaSlopeLookback);

  /** broke level when CLOSE is beyond and the previous close was not. */
  const broke = (i: number): boolean => {
    const ref = i === startIdx ? levels.prevClose : closes[i - 1];
    return isBuy
      ? closes[i] > levelPrice && ref <= levelPrice
      : closes[i] < levelPrice && ref >= levelPrice;
  };
  const holdsLevel = (i: number): boolean =>
    isBuy ? closes[i] > levelPrice : closes[i] < levelPrice;
  const beyondNow = isBuy
    ? lastClose > levelPrice
    : lastClose < levelPrice;

  const volAt = (i: number) =>
    volumeMultiple(vols, i, cfg.volumeRefCandles, cfg.volumeRefMinimum);
  const volBands = {
    strong: cfg.volStrong,
    high: cfg.volHigh,
    veryHigh: cfg.volVeryHigh,
    extreme: cfg.volExtreme,
  };
  const volText = (m: number | null) =>
    m == null ? "volume data unavailable" : `${m.toFixed(1)}x ${volumeLabel(m, volBands)}`;

  // ------------------------------------------------------------------
  // 1) Locate the first completed TODAY candle that CLOSED beyond the level.
  // ------------------------------------------------------------------
  let bIdx = -1;
  for (let i = startIdx; i < n; i++) {
    if (broke(i)) {
      bIdx = i;
      break;
    }
  }

  const baseDetails = (): AuditDetails => ({
    pdh: levels.pdh,
    pdl: levels.pdl,
    prevClose: levels.prevClose,
    triggerType: null,
    triggerTime: null,
    triggerOpen: null,
    triggerHigh: null,
    triggerLow: null,
    triggerClose: null,
    triggerVolume: null,
    referenceVolume: null,
    volumeMultiple: null,
    volumeLabel: null,
    emaAtTrigger: null,
    emaNow: emaLast,
    emaSlope: slopeLast,
    followThrough: [],
    confirmationTime: null,
    priceAtConfirmation: null,
    entry: null,
    stopLoss: null,
    target: null,
    riskReward: cfg.riskReward,
    candlesAnalyzed: n - startIdx,
    lastCandleTime: candles[last].label,
    checks: [],
    failureNote: null,
  });

  const triggerDetails = (
    idx: number,
    kind: string,
    vm: { multiple: number | null; reference: number | null }
  ): AuditDetails => ({
    ...baseDetails(),
    triggerType: kind,
    triggerTime: candles[idx].label,
    triggerOpen: candles[idx].o,
    triggerHigh: candles[idx].h,
    triggerLow: candles[idx].l,
    triggerClose: candles[idx].c,
    triggerVolume: candles[idx].v,
    referenceVolume: vm.reference,
    volumeMultiple: vm.multiple,
    volumeLabel: volumeLabel(vm.multiple, volBands),
    emaAtTrigger: ema[idx],
  });

  const res = (
    partial: Partial<SideResult> & { status: SignalStatus; reason: string }
  ): SideResult => ({
    direction: side,
    setup: setupBase,
    level,
    levelPrice,
    statusRank: STATUS_RANK.SETUP,
    entry: null,
    stopLoss: null,
    target: null,
    triggerIndex: bIdx >= 0 ? bIdx : null,
    confirmationIndex: null,
    active: true,
    details: baseDetails(),
    ...partial,
  });

  // ------------------------------------------------------------------
  // 2) No break yet -> WATCH logic only (never SETUP/CONFIRMED).
  // ------------------------------------------------------------------
  if (bIdx === -1) {
    const distPct = isBuy
      ? ((levelPrice - lastClose) / levelPrice) * 100
      : ((lastClose - levelPrice) / levelPrice) * 100;
    const near = distPct >= 0 && distPct <= cfg.nearLevelPct;
    const priceAligned = emaLast != null && (isBuy ? lastClose >= emaLast : lastClose <= emaLast);
    const slopeAligned = isBuy
      ? slopeLast === "RISING" || slopeLast === "FLAT"
      : slopeLast === "FALLING" || slopeLast === "FLAT";

    let maxVol: number | null = null;
    for (let i = startIdx; i < n; i++) {
      const m = volAt(i).multiple;
      if (m != null && (maxVol == null || m > maxVol)) maxVol = m;
    }

    const d = baseDetails();
    d.checks = [
      { label: isBuy ? "PDH exists and is valid" : "PDL exists and is valid", ok: true, value: r2(levelPrice).toFixed(2) },
      {
        label: isBuy ? "Completed 5-min candle closed above PDH" : "Completed 5-min candle closed below PDL",
        ok: false,
        value: "not yet",
      },
    ];

    if (priceAligned && slopeAligned && near) {
      const emaTxt = isBuy ? "above/rising" : "below/falling";
      return res({
        status: "WATCH",
        statusRank: STATUS_RANK.WATCH,
        reason: `Near ${level} (${distPct.toFixed(2)}% away); ${emaTxt} 20 EMA; waiting for ${level} ${isBuy ? "breakout" : "breakdown"} confirmation`,
        details: d,
      });
    }
    if (!priceAligned && near) {
      return res({
        status: "WATCH",
        statusRank: STATUS_RANK.WATCH,
        reason: `Near ${level} (${distPct.toFixed(2)}% away) but price is on the wrong side of the 20 EMA filter; waiting for alignment + ${level} break`,
        details: d,
      });
    }
    if (priceAligned && slopeAligned && maxVol != null && maxVol >= cfg.volHigh && distPct > 0) {
      return res({
        status: "WATCH",
        statusRank: STATUS_RANK.WATCH,
        reason: `${isBuy ? "Above" : "Below"} ${slopeLast === "FLAT" ? "flat" : slopeLast.toLowerCase()} 20 EMA with ${maxVol.toFixed(1)}x volume; watching for ${level} approach (${distPct.toFixed(2)}% away)`,
        details: d,
      });
    }
    return null;
  }

  // ------------------------------------------------------------------
  // 3) A break exists. Validate volume, EMA, follow-through, failure.
  // ------------------------------------------------------------------
  const trigger = candles[bIdx];
  const vm = volAt(bIdx);
  const emaAt = ema[bIdx];
  const slopeAt = emaSlope(ema, bIdx, cfg.emaSlopeLookback);
  const bodyBeyond = holdsLevel(bIdx);
  const wickBeyond = isBuy ? trigger.h > levelPrice : trigger.l < levelPrice;
  const priceEmaOk =
    emaAt != null && (isBuy ? trigger.c >= emaAt : trigger.c <= emaAt);
  const slopeOk = isBuy
    ? slopeAt === "RISING" || slopeAt === "FLAT"
    : slopeAt === "FALLING" || slopeAt === "FLAT";
  const emaOk = priceEmaOk && slopeOk;
  const volOk = vm.multiple != null && vm.multiple >= cfg.breakoutVolMin;

  // Failure: any completed candle AFTER the trigger closes back across the level.
  let failIdx = -1;
  for (let j = bIdx + 1; j < n; j++) {
    if (!holdsLevel(j)) {
      failIdx = j;
      break;
    }
  }

  const ft: FollowThroughPoint[] = [];
  if (failIdx === -1) {
    for (let j = bIdx + 1; j < n; j++) {
      ft.push({
        time: candles[j].label,
        close: candles[j].c,
        low: candles[j].l,
        high: candles[j].h,
        held: holdsLevel(j),
      });
    }
  }
  const ftCount = ft.length;

  const kind = `${level} ${isBuy ? "BREAKOUT" : "BREAKDOWN"} 5M`;
  const details = triggerDetails(bIdx, kind, vm);
  details.followThrough = ft;

  const sign = (v: boolean | null) => v;
  details.checks = [
    { label: `${level} exists and is valid`, ok: true, value: r2(levelPrice).toFixed(2) },
    {
      label: `Completed 5-min candle broke ${level} (${trigger.label})`,
      ok: bodyBeyond,
      value: `close ${r2(trigger.c).toFixed(2)} ${isBuy ? ">" : "<"} ${r2(levelPrice).toFixed(2)}${wickBeyond ? "" : " (close-only break)"}`,
    },
    {
      label: `Trigger volume >= ${cfg.breakoutVolMin}x`,
      ok: sign(volOk),
      value: vm.multiple == null ? "reference unavailable" : `${vm.multiple.toFixed(1)}x ${volumeLabel(vm.multiple, volBands)}`,
    },
    {
      label: `20 EMA alignment (${isBuy ? "price above & EMA rising" : "price below & EMA falling"})`,
      ok: sign(emaOk),
      value: emaAt == null ? "EMA warming up" : `EMA ${r2(emaAt).toFixed(2)} / ${slopeAt.toLowerCase()}`,
    },
    {
      label: `Follow-through holding ${isBuy ? "above PDH" : "below PDL"}`,
      ok: failIdx === -1 ? (ftCount >= cfg.followThroughCandles ? true : null) : false,
      value:
        failIdx !== -1
          ? `failed at ${candles[failIdx].label}`
          : ftCount >= cfg.followThroughCandles
            ? `${ftCount} candle(s) holding`
            : "waiting",
    },
    {
      label: `Price still beyond ${level}`,
      ok: beyondNow,
      value: r2(lastClose).toFixed(2),
    },
  ];

  // -- 3a) Failed break: never confirm ----------------------------------
  if (failIdx !== -1) {
    details.failureNote = `${level} ${isBuy ? "breakout" : "breakdown"} at ${trigger.label} FAILED — ${candles[failIdx].label} candle closed back ${isBuy ? "below" : "above"} ${levelPrice.toFixed(2)}. Signal invalidated.`;
    const stillNear =
      Math.abs(((lastClose - levelPrice) / levelPrice) * 100) <= cfg.nearLevelPct;
    return res({
      status: stillNear ? "WATCH" : "NONE",
      statusRank: stillNear ? STATUS_RANK.WATCH : STATUS_RANK.NONE,
      active: false,
      reason: `${level} ${isBuy ? "breakout" : "breakdown"} at ${trigger.label} failed (closed back ${isBuy ? "below" : "above"} ${level} at ${candles[failIdx].label}); not a valid ${isBuy ? "BUY" : "SELL"} — re-watching level`,
      details,
    });
  }

  // -- 3b) Break happened but mandatory conditions incomplete -> SETUP ---
  if (!volOk || !emaOk) {
    const gaps: string[] = [];
    if (!volOk) {
      gaps.push(
        vm.multiple == null
          ? "reference volume unavailable"
          : `volume ${vm.multiple.toFixed(1)}x below required ${cfg.breakoutVolMin}x`
      );
    }
    if (!emaOk) {
      gaps.push(
        emaAt == null
          ? "20 EMA still warming up"
          : isBuy
            ? `price/EMA not aligned (close ${trigger.c.toFixed(2)} vs EMA ${emaAt.toFixed(2)}, slope ${slopeAt.toLowerCase()})`
            : `price/EMA not aligned (close ${trigger.c.toFixed(2)} vs EMA ${emaAt.toFixed(2)}, slope ${slopeAt.toLowerCase()})`
      );
    }
    return res({
      status: "SETUP",
      reason: `${level} ${isBuy ? "breakout" : "breakdown"} candle at ${trigger.label} + ${volText(vm.multiple)}, but ${gaps.join(" and ")}; not confirmed`,
      details,
    });
  }

  // -- 3c) Clean break, waiting for follow-through -> SETUP --------------
  if (ftCount < cfg.followThroughCandles) {
    return res({
      status: "SETUP",
      reason: `${level} ${isBuy ? "breakout" : "breakdown"} candle at ${trigger.label} + ${volText(vm.multiple)} + ${isBuy ? "bullish" : "bearish"} 20 EMA; waiting for follow-through to hold ${isBuy ? "above PDH" : "below PDL"}`,
      details,
    });
  }

  // -- 3d) CONFIRMED ------------------------------------------------------
  const cIdx = bIdx + ftCount; // confirmation candle index
  const confirmCandle = candles[cIdx];
  const entry = confirmCandle.c;
  const structExtreme = isBuy
    ? Math.min(minOf(lows, bIdx, cIdx), levelPrice)
    : Math.max(maxOf(highs, bIdx, cIdx), levelPrice);
  const buffer = (levelPrice * cfg.slBufferPct) / 100;
  let stopLoss = isBuy ? structExtreme - buffer : structExtreme + buffer;
  if (isBuy && stopLoss >= entry) stopLoss = entry * (1 - cfg.slBufferPct / 100);
  if (!isBuy && stopLoss <= entry) stopLoss = entry * (1 + cfg.slBufferPct / 100);
  const risk = Math.abs(entry - stopLoss);
  const target = isBuy ? entry + risk * cfg.riskReward : entry - risk * cfg.riskReward;

  details.confirmationTime = confirmCandle.label;
  details.priceAtConfirmation = entry;
  details.entry = entry;
  details.stopLoss = r2(stopLoss);
  details.target = r2(target);
  details.checks[4] = {
    label: `Follow-through holding ${isBuy ? "above PDH" : "below PDL"}`,
    ok: true,
    value: `${ftCount} candle(s) held; confirmed at ${confirmCandle.label}`,
  };

  const confirmedReason = `${level} ${isBuy ? "breakout" : "breakdown"} at ${trigger.label} + ${isBuy ? "bullish" : "bearish"} follow-through (held ${isBuy ? "above" : "below"} ${level} till ${confirmCandle.label}) + ${volText(vm.multiple)} + price ${isBuy ? "above" : "below"} ${slopeAt === "FLAT" ? "flat" : slopeAt.toLowerCase()} 20 EMA`;

  const confirmedBase: SideResult = res({
    status: "CONFIRMED",
    reason: confirmedReason,
    entry: r2(entry),
    stopLoss: r2(stopLoss),
    target: r2(target),
    confirmationIndex: cIdx,
    active: beyondNow,
    details,
    statusRank: isBuy ? STATUS_RANK.CONFIRMED_PDH_BUY : STATUS_RANK.CONFIRMED_PDL_SELL,
  });

  // -- 3e) Continuation upgrade (pullback/retest after confirmation) ------
  const cont = detectContinuation(
    confirmedBase, candles, closes, highs, lows, ema, vm, cfg,
    cIdx, levelPrice, isBuy, volBands, volAt
  );
  if (cont) return { ...cont, setup: contSetup };

  return confirmedBase;
}

function detectContinuation(
  base: SideResult,
  candles: CandlePoint[],
  closes: number[],
  highs: number[],
  lows: number[],
  ema: (number | null)[],
  vm: { multiple: number | null; reference: number | null },
  cfg: EngineConfig,
  cIdx: number,
  levelPrice: number,
  isBuy: boolean,
  volBands: { strong: number; high: number; veryHigh: number; extreme: number },
  volAt: (i: number) => { multiple: number | null; reference: number | null }
): SideResult | null {
  const n = candles.length;
  const last = n - 1;
  const retestBand = (levelPrice * cfg.retestPct) / 100;

  let pullIdx = -1;
  for (let i = last; i > cIdx && i > last - cfg.continuationLookback; i--) {
    const e = ema[i];
    const touchedLevel = isBuy
      ? lows[i] <= levelPrice + retestBand && lows[i] > levelPrice * 0.997
      : highs[i] >= levelPrice - retestBand && highs[i] < levelPrice * 1.003;
    const touchedEma =
      e != null &&
      (isBuy
        ? lows[i] <= e + (e * cfg.retestPct) / 100 && closes[i] > levelPrice
        : highs[i] >= e - (e * cfg.retestPct) / 100 && closes[i] < levelPrice);
    const held = isBuy ? closes[i] > levelPrice : closes[i] < levelPrice;
    if (held && (touchedLevel || touchedEma)) {
      pullIdx = i;
      break;
    }
  }
  if (pullIdx === -1 || pullIdx >= last) return null;

  // Continuation trigger candle after the pullback.
  for (let k = pullIdx + 1; k < n; k++) {
    const c = candles[k];
    const strongDir = isBuy ? c.c > c.o : c.c < c.o;
    const breaksMicro = isBuy
      ? c.c > maxOf(highs, k - 3, k - 1)
      : c.c < minOf(lows, k - 3, k - 1);
    const vmK = volAt(k);
    const volOk = vmK.multiple != null && vmK.multiple >= cfg.continuationVolMin;
    if (!(strongDir && breaksMicro && volOk)) continue;

    const d = { ...base.details };
    d.triggerType = `${isBuy ? "BUY" : "SELL"} CONTINUATION 5M`;
    d.triggerTime = c.label;
    d.triggerOpen = c.o;
    d.triggerHigh = c.h;
    d.triggerLow = c.l;
    d.triggerClose = c.c;
    d.triggerVolume = c.v;
    d.referenceVolume = vmK.reference;
    d.volumeMultiple = vmK.multiple;
    d.volumeLabel = volumeLabel(vmK.multiple, volBands);
    d.confirmationTime = null;
    d.priceAtConfirmation = null;
    d.checks = [
      { label: `Valid prior ${isBuy ? "PDH breakout" : "PDL breakdown"}`, ok: true, value: base.details.confirmationTime ?? "confirmed" },
      { label: `Pullback/retest held ${isBuy ? "above PDH" : "below PDL"}`, ok: true, value: `${candles[pullIdx].label} held ${levelPrice.toFixed(2)}` },
      { label: `Continuation candle (${c.label})`, ok: true, value: `close ${c.c.toFixed(2)} / ${vmK.multiple?.toFixed(1) ?? "?"}x` },
      { label: "Follow-through after continuation", ok: k < last ? true : null, value: k < last ? "holding" : "waiting" },
    ];

    if (k < last) {
      // Follow-through after continuation candle: price still beyond level.
      const stillOk = isBuy ? closes[last] > levelPrice : closes[last] < levelPrice;
      if (!stillOk) return null;
      const entry = closes[last];
      const structExtreme = isBuy
        ? minOf(lows, pullIdx, last)
        : maxOf(highs, pullIdx, last);
      const buffer = (levelPrice * cfg.slBufferPct) / 100;
      let stopLoss = isBuy ? structExtreme - buffer : structExtreme + buffer;
      if (isBuy && stopLoss >= entry) stopLoss = entry * (1 - cfg.slBufferPct / 100);
      if (!isBuy && stopLoss <= entry) stopLoss = entry * (1 + cfg.slBufferPct / 100);
      const risk = Math.abs(entry - stopLoss);
      const target = isBuy ? entry + risk * cfg.riskReward : entry - risk * cfg.riskReward;
      d.confirmationTime = candles[last].label;
      d.priceAtConfirmation = entry;
      d.entry = r2(entry);
      d.stopLoss = r2(stopLoss);
      d.target = r2(target);
      return {
        ...base,
        status: "CONFIRMED",
        statusRank: isBuy
          ? STATUS_RANK.CONFIRMED_BUY_CONTINUATION
          : STATUS_RANK.CONFIRMED_SELL_CONTINUATION,
        entry: r2(entry),
        stopLoss: r2(stopLoss),
        target: r2(target),
        confirmationIndex: last,
        reason: `${isBuy ? "BUY" : "SELL"} continuation after ${isBuy ? "PDH" : "PDL"} retest held (${candles[pullIdx].label}) + continuation candle ${c.label} + ${vmK.multiple?.toFixed(1) ?? "?"}x ${volumeLabel(vmK.multiple, volBands)} + follow-through holding`,
        details: d,
      };
    }
    return {
      ...base,
      status: "SETUP",
      statusRank: STATUS_RANK.SETUP,
      entry: null,
      stopLoss: null,
      target: null,
      reason: `${isBuy ? "BUY" : "SELL"} continuation trigger at ${c.label} after ${isBuy ? "PDH" : "PDL"} retest + ${vmK.multiple?.toFixed(1) ?? "?"}x volume; waiting for continuation follow-through`,
      details: d,
    };
  }
  return null;
}

export interface AnalyzeInput {
  symbol: string;
  /** Today's COMPLETED 5-min candles, ascending. Signal scan runs here only. */
  candles: CandlePoint[];
  /**
   * Previous sessions' completed 5-min candles (ascending, strictly before
   * today). Used ONLY to warm up the 20 EMA + volume reference so the engine
   * is valid from the opening minutes of the scan window.
   */
  warmup?: CandlePoint[];
  levels: PrevDayLevels;
  ltpOverride?: number | null;
}

/** Analyze one symbol -> scanner row. Pure function (unit-test friendly). */
export function analyzeSymbol(input: AnalyzeInput, cfg: EngineConfig): ScanRow {
  const { symbol, levels, ltpOverride } = input;
  const warmup = input.warmup ?? [];
  const todayCandles = input.candles;
  // Full series = prior sessions (warmup) + today. EMA/volume use the full
  // series; breakout/breakdown detection starts at today's first candle.
  const candles = [...warmup, ...todayCandles];
  const startIdx = warmup.length;

  const empty = (reason: string): ScanRow => ({
    symbol,
    ltp: ltpOverride ?? (todayCandles.length ? todayCandles[todayCandles.length - 1].c : null),
    changePct: null,
    dayOpen: todayCandles.length ? todayCandles[0].o : null,
    volumeMultiple: null,
    volumeLabel: null,
    ema20: null,
    emaBias: "-",
    pdh: levels.pdh,
    pdl: levels.pdl,
    level: "-",
    distancePct: null,
    setup: "NONE",
    status: "NONE",
    direction: "NONE",
    entry: null,
    stopLoss: null,
    target: null,
    reason,
    statusRank: STATUS_RANK.NONE,
    active: true,
    firstConfirmedAt: null,
    details: null,
  });

  if (todayCandles.length < cfg.minCandlesRequired) {
    return empty(
      `Insufficient completed 5-minute candles today (${todayCandles.length}/${cfg.minCandlesRequired})`
    );
  }
  if (!Number.isFinite(levels.pdh) || !Number.isFinite(levels.pdl)) {
    return empty("Missing previous day levels");
  }

  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const vols = candles.map((c) => c.v);
  const ema = emaSeries(closes, cfg.emaPeriod);
  const last = candles.length - 1;
  const ltp = ltpOverride ?? closes[last];
  const emaLast = ema[last];
  const slope: EmaSlope = emaSlope(ema, last, cfg.emaSlopeLookback);
  const latestVol = volumeMultiple(
    vols,
    last,
    cfg.volumeRefCandles,
    cfg.volumeRefMinimum
  ).multiple;
  const bands = {
    strong: cfg.volStrong,
    high: cfg.volHigh,
    veryHigh: cfg.volVeryHigh,
    extreme: cfg.volExtreme,
  };

  const buy = evaluateSide("BUY", candles, levels, closes, highs, lows, vols, ema, cfg, startIdx);
  const sell = evaluateSide("SELL", candles, levels, closes, highs, lows, vols, ema, cfg, startIdx);

  let best: SideResult | null = null;
  if (buy && sell) {
    if (buy.statusRank !== sell.statusRank) {
      best = buy.statusRank < sell.statusRank ? buy : sell;
    } else {
      const bv = buy.details.volumeMultiple ?? 0;
      const sv = sell.details.volumeMultiple ?? 0;
      best = bv >= sv ? buy : sell;
    }
  } else {
    best = buy ?? sell;
  }

  const changePct =
    levels.prevClose > 0 ? ((ltp - levels.prevClose) / levels.prevClose) * 100 : null;

  if (!best || best.status === "NONE") {
    return {
      ...empty(best?.reason ?? "No actionable Prime Technical structure"),
      ltp: r2(ltp),
      changePct: changePct == null ? null : r2(changePct),
      volumeMultiple: latestVol == null ? null : r2(latestVol),
      volumeLabel: volumeLabel(latestVol ?? null, bands),
      ema20: emaLast,
      emaBias: emaLast == null ? "-" : emaBiasLabel(ltp, emaLast, slope),
      distancePct: null,
    };
  }

  const isBuy = best.direction === "BUY";
  const distancePct = ((ltp - best.levelPrice) / best.levelPrice) * 100;

  return {
    symbol,
    ltp: r2(ltp),
    changePct: changePct == null ? null : r2(changePct),
    dayOpen: r2(todayCandles[0].o),
    volumeMultiple:
      best.details.volumeMultiple ??
      latestVol ??
      null,
    volumeLabel: volumeLabel(best.details.volumeMultiple ?? latestVol ?? null, bands),
    ema20: emaLast == null ? null : r2(emaLast),
    emaBias: emaLast == null ? "-" : emaBiasLabel(ltp, emaLast, slope),
    pdh: levels.pdh,
    pdl: levels.pdl,
    level: best.level,
    distancePct: r2(distancePct),
    setup: best.setup,
    status: best.status,
    direction: best.direction,
    entry: best.status === "CONFIRMED" ? best.entry : null,
    stopLoss: best.status === "CONFIRMED" ? best.stopLoss : null,
    target: best.status === "CONFIRMED" ? best.target : null,
    reason: best.reason,
    statusRank: best.statusRank,
    active: best.active,
    firstConfirmedAt: best.details.confirmationTime,
    details: best.details,
  };
}
