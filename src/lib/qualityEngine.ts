import type { AuditDetails, CandlePoint, PrevDayLevels, ScanRow } from "./types";
import { STATUS_RANK } from "./types";
import { emaSeries, emaSlope, emaBiasLabel } from "./indicators";
import { volumeMultiple, volumeLabel } from "./volume";

export interface QualityEngineConfig {
  timeframeMinutes: 1 | 3 | 5;
  emaPeriod: number;
  volumeRefCandles: number;
  volumeRefMinimum: number;
  breakoutVolMin: number;
  nearLevelPct: number;
  minCandlesRequired: number;
  riskReward: number;
  slBufferPct: number;
  scanStartMinutes: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function scoreGrade(score: number): string {
  if (score >= 90) return "PRIME A+";
  if (score >= 80) return "PRIME A";
  if (score >= 70) return "STRONG";
  if (score >= 60) return "GOOD";
  if (score >= 50) return "WATCH";
  return "WEAK";
}

function makeDetails(levels: PrevDayLevels, timeframe: number, candles: CandlePoint[], emaNow: number | null): AuditDetails {
  return {
    pdh: levels.pdh, pdl: levels.pdl, prevClose: levels.prevClose,
    triggerType: null, triggerTime: null, triggerOpen: null, triggerHigh: null,
    triggerLow: null, triggerClose: null, triggerVolume: null, referenceVolume: null,
    volumeMultiple: null, volumeLabel: null, emaAtTrigger: null, emaNow,
    emaSlope: null, followThrough: [], confirmationTime: null, priceAtConfirmation: null,
    entry: null, stopLoss: null, target: null, riskReward: null,
    candlesAnalyzed: candles.length, lastCandleTime: candles[candles.length - 1]?.label ?? null,
    checks: [], failureNote: null,
  };
}

export function analyzeQualitySymbol(input: {
  symbol: string;
  timeframeMinutes: 1 | 3 | 5;
  candles: CandlePoint[];
  warmup: CandlePoint[];
  levels: PrevDayLevels;
  ltpOverride?: number | null;
}, cfg: QualityEngineConfig): ScanRow {
  const today = input.candles;
  const all = [...input.warmup, ...today];
  const start = input.warmup.length;
  const tf = input.timeframeMinutes;
  const empty = (reason: string): ScanRow => ({
    symbol: input.symbol, timeframeMinutes: tf,
    ltp: input.ltpOverride ?? today.at(-1)?.c ?? null,
    changePct: null, dayOpen: today[0]?.o ?? null, volumeMultiple: null, volumeLabel: null,
    ema20: null, emaBias: "-", pdh: input.levels.pdh, pdl: input.levels.pdl, level: "-",
    distancePct: null, setup: "NONE", status: "NONE", direction: "NONE", entry: null,
    stopLoss: null, target: null, reason, statusRank: STATUS_RANK.NONE, active: true,
    firstConfirmedAt: null, details: null,
  });

  if (today.length < cfg.minCandlesRequired) {
    return empty(`Waiting for first completed ${tf}-minute candle (${today.length}/${cfg.minCandlesRequired})`);
  }
  if (!Number.isFinite(input.levels.pdh) || !Number.isFinite(input.levels.pdl)) return empty("Missing previous day levels");

  const closes = all.map(c => c.c);
  const highs = all.map(c => c.h);
  const lows = all.map(c => c.l);
  const vols = all.map(c => c.v);
  const ema = emaSeries(closes, cfg.emaPeriod);
  const last = all.length - 1;
  const emaNow = ema[last];
  const slope = emaSlope(ema, last, 3);
  const ltp = input.ltpOverride ?? today.at(-1)!.c;
  const latestVol = volumeMultiple(vols, last, cfg.volumeRefCandles, cfg.volumeRefMinimum);
  const bands = { strong: 1.5, high: 2, veryHigh: 4, extreme: 6.5 };

  let best: { side: "BUY" | "SELL"; idx: number; score: number; details: AuditDetails; reason: string; status: ScanRow["status"]; level: "PDH" | "PDL"; entry: number | null; sl: number | null; target: number | null; active: boolean } | null = null;

  const evaluate = (side: "BUY" | "SELL") => {
    const isBuy = side === "BUY";
    const level = isBuy ? input.levels.pdh : input.levels.pdl;
    const levelTag = isBuy ? "PDH" : "PDL";
    let breakIdx = -1;
    for (let i = start; i < all.length; i++) {
      const prev = i === start ? input.levels.prevClose : closes[i - 1];
      if ((isBuy && closes[i] > level && prev <= level) || (!isBuy && closes[i] < level && prev >= level)) {
        breakIdx = i;
        break;
      }
    }

    const lastClose = closes[last];
    const dist = isBuy ? ((level - lastClose) / level) * 100 : ((lastClose - level) / level) * 100;
    const near = dist >= 0 && dist <= cfg.nearLevelPct;
    const priceAligned = isBuy ? lastClose >= (emaNow ?? Infinity) : lastClose <= (emaNow ?? -Infinity);

    if (breakIdx < 0) {
      if (!near && !priceAligned) return;
      const d = makeDetails(input.levels, tf, all, emaNow);
      d.emaSlope = slope;
      d.checks = [
        { label: `${levelTag} valid`, ok: true, value: level.toFixed(2) },
        { label: `Completed ${tf}-min close beyond ${levelTag}`, ok: false, value: "not yet" },
        { label: "20 EMA alignment", ok: priceAligned, value: emaNow == null ? "warming up" : `${isBuy ? "above" : "below"} EMA20` },
      ];
      const row = { side, idx: -1, score: 25, details: d, reason: near ? `Near ${levelTag} (${Math.abs(dist).toFixed(2)}% away); waiting for ${levelTag} ${isBuy ? "breakout" : "breakdown"}` : `${isBuy ? "Above" : "Below"} EMA20; watching ${levelTag}`, status: "WATCH" as const, level: levelTag, entry: null, sl: null, target: null, active: true };
      if (!best || row.score > best.score) best = row;
      return;
    }

    const c = all[breakIdx];
    const range = Math.max(0, c.h - c.l);
    const body = Math.abs(c.c - c.o);
    const bodyRatio = range > 0 ? body / range : 0;
    const closeLocation = range > 0 ? (isBuy ? (c.c - c.l) / range : (c.h - c.c) / range) : 0;
    const vm = volumeMultiple(vols, breakIdx, cfg.volumeRefCandles, cfg.volumeRefMinimum);
    const emaAt = ema[breakIdx];
    const aligned = emaAt != null && (isBuy ? c.c > emaAt : c.c < emaAt);
    const rangeAvgFrom = Math.max(start, breakIdx - 10);
    let rangeSum = 0, rangeCount = 0;
    for (let j = rangeAvgFrom; j < breakIdx; j++) { rangeSum += Math.max(0, highs[j] - lows[j]); rangeCount++; }
    const avgRange = rangeCount ? rangeSum / rangeCount : 0;
    const rangeExpansion = avgRange > 0 ? range / avgRange : 0;
    const previousRange = breakIdx > start ? Math.max(0, highs[breakIdx - 1] - lows[breakIdx - 1]) : 0;
    const previousAvgFrom = Math.max(start, breakIdx - 4);
    let prevSum = 0, prevCount = 0;
    for (let j = previousAvgFrom; j < breakIdx; j++) { prevSum += Math.max(0, highs[j] - lows[j]); prevCount++; }
    const prevAvg = prevCount ? prevSum / prevCount : 0;
    const compressionExpansion = prevAvg > 0 && previousRange < prevAvg * 0.8 && rangeExpansion >= 1.3;

    const hardFast = (vm.multiple ?? 0) >= cfg.breakoutVolMin && aligned;
    const strongCandle = (isBuy ? c.c > c.o : c.c < c.o) && bodyRatio >= 0.5 && closeLocation >= 0.6;
    const qualityHard = hardFast && strongCandle && rangeExpansion >= 1.3;

    let failIdx = -1;
    for (let j = breakIdx + 1; j < all.length; j++) {
      if (isBuy ? closes[j] < level : closes[j] > level) { failIdx = j; break; }
    }

    const status: ScanRow["status"] = failIdx >= 0 ? "WATCH" : hardFast ? "CONFIRMED" : "SETUP";
    const triggerMinutes = (() => {
      const parts = c.label.split(":");
      return Number(parts[0]) * 60 + Number(parts[1]) - cfg.scanStartMinutes;
    })();

    const volumeScore = (vm.multiple ?? 0) >= 6.5 ? 20 : (vm.multiple ?? 0) >= 4 ? 18 : (vm.multiple ?? 0) >= 2 ? 15 : (vm.multiple ?? 0) >= 1.5 ? 10 : 0;
    const penetrationPct = Math.abs((c.c - level) / level) * 100;
    const penetrationScore = clamp((penetrationPct / 1.0) * 15, 0, 15);
    const candleScore = clamp(bodyRatio * 15, 0, 15);
    const closeScore = clamp(closeLocation * 10, 0, 10);
    const emaDistancePct = emaAt && emaAt > 0 ? Math.abs((c.c - emaAt) / emaAt) * 100 : 0;
    const emaScore = clamp((emaDistancePct / 1.0) * 15, 0, 15);
    const rangeScore = rangeExpansion >= 2 ? 10 : rangeExpansion >= 1.75 ? 9 : rangeExpansion >= 1.5 ? 8 : rangeExpansion >= 1.3 ? 6 : rangeExpansion >= 1.1 ? 3 : 0;
    const timingScore = triggerMinutes <= 5 ? 10 : triggerMinutes <= 10 ? 9 : triggerMinutes <= 15 ? 8 : triggerMinutes <= 20 ? 6 : triggerMinutes <= 30 ? 4 : triggerMinutes <= 45 ? 2 : 0;
    const compressionScore = compressionExpansion ? 5 : rangeExpansion >= 1.3 ? 2 : 0;
    const total = Math.round(clamp(volumeScore + penetrationScore + candleScore + closeScore + emaScore + rangeScore + timingScore + compressionScore, 0, 100));

    const d = makeDetails(input.levels, tf, all, emaNow);
    d.triggerType = `${levelTag} ${isBuy ? "BREAKOUT" : "BREAKDOWN"} ${tf}M`;
    d.triggerTime = c.label; d.triggerOpen = c.o; d.triggerHigh = c.h; d.triggerLow = c.l; d.triggerClose = c.c; d.triggerVolume = c.v;
    d.referenceVolume = vm.reference; d.volumeMultiple = vm.multiple; d.volumeLabel = volumeLabel(vm.multiple, bands);
    d.emaAtTrigger = emaAt; d.emaSlope = emaSlope(ema, breakIdx, 3);
    d.checks = [
      { label: `${levelTag} close break`, ok: true, value: `${c.c.toFixed(2)} ${isBuy ? ">" : "<"} ${level.toFixed(2)}` },
      { label: `Volume >= ${cfg.breakoutVolMin}x`, ok: (vm.multiple ?? 0) >= cfg.breakoutVolMin, value: vm.multiple == null ? "no reference" : `${vm.multiple.toFixed(1)}x` },
      { label: "Price vs EMA20", ok: aligned, value: emaAt == null ? "warming up" : `${c.c >= emaAt ? "above" : "below"}` },
      { label: "Candle quality", ok: strongCandle, value: `${Math.round(bodyRatio * 100)}% body / ${Math.round(closeLocation * 100)}% close` },
      { label: "Range expansion", ok: rangeExpansion >= 1.3, value: `${rangeExpansion.toFixed(2)}x` },
    ];
    if (failIdx >= 0) d.failureNote = `${levelTag} failed at ${all[failIdx].label}`;

    const score = total + (status === "CONFIRMED" ? 20 : status === "SETUP" ? 8 : 0);
    let entry: number | null = null, sl: number | null = null, target: number | null = null;
    if (status === "CONFIRMED") {
      entry = c.c;
      const structural = isBuy ? Math.min(c.l, level) : Math.max(c.h, level);
      const buffer = level * cfg.slBufferPct / 100;
      sl = isBuy ? structural - buffer : structural + buffer;
      const risk = Math.abs(entry - sl);
      target = isBuy ? entry + risk * cfg.riskReward : entry - risk * cfg.riskReward;
      d.confirmationTime = c.label; d.priceAtConfirmation = entry; d.entry = r2(entry); d.stopLoss = r2(sl); d.target = r2(target); d.riskReward = cfg.riskReward;
    }

    const reason = failIdx >= 0
      ? `${levelTag} break failed — closed back ${isBuy ? "below" : "above"} ${levelTag}`
      : status === "CONFIRMED"
        ? `${levelTag} ${isBuy ? "breakout" : "breakdown"} + ${vm.multiple?.toFixed(1) ?? "?"}x volume + price ${isBuy ? "above" : "below"} EMA20 + Prime Score ${total}/100`
        : `${levelTag} break detected; waiting for volume/EMA confirmation`;

    const row = { side, idx: breakIdx, score, details: d, reason, status, level: levelTag, entry, sl, target, active: failIdx < 0 };
    if (!best || row.score > best.score) best = row;
  };

  evaluate("BUY");
  evaluate("SELL");

  const changePct = input.levels.prevClose > 0 ? ((ltp - input.levels.prevClose) / input.levels.prevClose) * 100 : null;
  const latestEma = emaNow == null ? null : r2(emaNow);
  const latestBias = emaNow == null ? "-" : emaBiasLabel(ltp, emaNow, slope);

  if (!best) {
    return {
      ...empty("No Prime Technical structure"),
      ltp: r2(ltp), changePct: changePct == null ? null : r2(changePct),
      volumeMultiple: latestVol.multiple == null ? null : r2(latestVol.multiple),
      volumeLabel: volumeLabel(latestVol.multiple, bands), ema20: latestEma, emaBias: latestBias,
    };
  }

  const levelPrice = best.level === "PDH" ? input.levels.pdh : input.levels.pdl;
  const distancePct = ((ltp - levelPrice) / levelPrice) * 100;
  return {
    symbol: input.symbol, timeframeMinutes: tf, ltp: r2(ltp), changePct: changePct == null ? null : r2(changePct),
    dayOpen: r2(today[0].o), volumeMultiple: best.details.volumeMultiple ?? latestVol.multiple,
    volumeLabel: best.details.volumeLabel ?? volumeLabel(latestVol.multiple, bands), ema20: latestEma, emaBias: latestBias,
    pdh: input.levels.pdh, pdl: input.levels.pdl, level: best.level, distancePct: r2(distancePct),
    setup: best.level === "PDH" ? "PDH_BUY" : "PDL_SELL", status: best.status,
    direction: best.side, entry: best.entry, stopLoss: best.sl, target: best.target, reason: best.reason,
    statusRank: best.status === "CONFIRMED" ? (best.side === "BUY" ? STATUS_RANK.CONFIRMED_PDH_BUY : STATUS_RANK.CONFIRMED_PDL_SELL) : best.status === "SETUP" ? STATUS_RANK.SETUP : STATUS_RANK.WATCH,
    active: best.active, firstConfirmedAt: best.details.confirmationTime, details: best.details,
  };
}
