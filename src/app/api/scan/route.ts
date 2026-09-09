import { NextRequest, NextResponse } from "next/server";
import { getMultiDashboardPayload } from "@/lib/multiScanner";
import { marketPhase } from "@/lib/time";
import { SCANNER_CONFIG } from "@/lib/config";
import { upstoxConfigured } from "@/lib/upstox";
import type { ScanPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ScanRuntimeState = typeof globalThis & {
  __primeMultiScanInFlight?: Promise<ScanPayload>;
  __primeMultiLastPayload?: ScanPayload;
};

const runtime = globalThis as ScanRuntimeState;

function emptyPayload(message: string): ScanPayload {
  return {
    meta: {
      ok: true, scanDate: "", nowIst: "", marketPhase: marketPhase(new Date(), SCANNER_CONFIG),
      source: upstoxConfigured() ? "UPSTOX" : "SIMULATION", ranScan: false,
      lastScanAt: null, lastScanDate: null, lastScanStatus: null, universeSize: 0,
      processed: 0, errorCount: 0, counts: { confirmed: 0, setups: 0, watch: 0 }, message, error: null,
      config: { scanStart: SCANNER_CONFIG.scanStart, scanEnd: SCANNER_CONFIG.scanEnd, rescanSeconds: SCANNER_CONFIG.rescanSeconds, volRefCandles: SCANNER_CONFIG.volumeRefCandles, breakoutVolMin: SCANNER_CONFIG.breakoutVolMin, riskReward: SCANNER_CONFIG.riskReward },
    },
    rows: [], events: [],
    timeframes: {
      "1": { timeframeMinutes: 1, label: "1 MIN", rows: [], events: [], counts: { confirmed: 0, setups: 0, watch: 0 }, processed: 0, errors: 0, lastCandleTime: null },
      "3": { timeframeMinutes: 3, label: "3 MIN", rows: [], events: [], counts: { confirmed: 0, setups: 0, watch: 0 }, processed: 0, errors: 0, lastCandleTime: null },
      "5": { timeframeMinutes: 5, label: "5 MIN", rows: [], events: [], counts: { confirmed: 0, setups: 0, watch: 0 }, processed: 0, errors: 0, lastCandleTime: null },
    },
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const force = req.nextUrl.searchParams.get("force") === "1";
  try {
    if (runtime.__primeMultiScanInFlight) {
      const previous = runtime.__primeMultiLastPayload;
      return NextResponse.json(previous ? { ...previous, meta: { ...previous.meta, ranScan: false, message: "Scan already in progress — showing the last completed 1M / 3M / 5M scan." } } : emptyPayload("Initial 1M / 3M / 5M scan is in progress…"), { headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    const work = getMultiDashboardPayload(force);
    runtime.__primeMultiScanInFlight = work;
    const payload = await work;
    runtime.__primeMultiLastPayload = payload;
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    const previous = runtime.__primeMultiLastPayload;
    return NextResponse.json(previous ? { ...previous, meta: { ...previous.meta, ranScan: false, error: `Scanner backend error: ${(err as Error).message}` } } : { ...emptyPayload("Scanner backend error"), meta: { ...emptyPayload("Scanner backend error").meta, ok: false, error: `Scanner backend error: ${(err as Error).message}` } }, { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } });
  } finally {
    runtime.__primeMultiScanInFlight = undefined;
  }
}
