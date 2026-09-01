import { NextRequest, NextResponse } from "next/server";
import { getDashboardPayload } from "@/lib/scanner";
import { marketPhase } from "@/lib/time";
import { SCANNER_CONFIG } from "@/lib/config";
import { upstoxConfigured } from "@/lib/upstox";
import type { ScanPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ScanRuntimeState = typeof globalThis & {
  __arenaScanInFlight?: Promise<ScanPayload>;
  __arenaLastPayload?: ScanPayload;
};

const runtime = globalThis as ScanRuntimeState;

function busyPayload(): ScanPayload {
  const previous = runtime.__arenaLastPayload;
  if (previous) {
    return {
      ...previous,
      meta: {
        ...previous.meta,
        ranScan: false,
        message: "Scan already in progress — showing the last completed scan.",
        error: null,
      },
    };
  }

  return {
    meta: {
      ok: true,
      scanDate: "",
      nowIst: "",
      marketPhase: marketPhase(new Date(), SCANNER_CONFIG),
      source: upstoxConfigured() ? "UPSTOX" : "SIMULATION",
      ranScan: false,
      lastScanAt: null,
      lastScanDate: null,
      lastScanStatus: null,
      universeSize: 0,
      processed: 0,
      errorCount: 0,
      counts: { confirmed: 0, setups: 0, watch: 0 },
      message: "Initial scan is in progress…",
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
    rows: [],
    events: [],
  } as ScanPayload;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const force = req.nextUrl.searchParams.get("force") === "1";

  try {
    if (runtime.__arenaScanInFlight) {
      return NextResponse.json(busyPayload(), {
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    /*
     * Always use the main scanner orchestration here, including after 10:00.
     * getDashboardPayload() intentionally uses the 09:15–10:00 candle cutoff
     * and, when needed, completes the persisted replay batches after the live
     * window. This prevents the API from falling back to yesterday's snapshot
     * simply because today's live scan was not started while the page was open.
     */
    const work = getDashboardPayload(force);
    runtime.__arenaScanInFlight = work;
    const payload = await work;
    runtime.__arenaLastPayload = payload;

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        meta: {
          ok: false,
          scanDate: "",
          nowIst: "",
          marketPhase: "CLOSED",
          source: upstoxConfigured() ? "UPSTOX" : "SIMULATION",
          ranScan: false,
          lastScanAt: null,
          lastScanDate: null,
          lastScanStatus: null,
          universeSize: 0,
          processed: 0,
          errorCount: 0,
          counts: { confirmed: 0, setups: 0, watch: 0 },
          message: null,
          error: `Scanner backend error: ${(err as Error).message}`,
          config: {
            scanStart: SCANNER_CONFIG.scanStart,
            scanEnd: SCANNER_CONFIG.scanEnd,
            rescanSeconds: SCANNER_CONFIG.rescanSeconds,
            volRefCandles: SCANNER_CONFIG.volumeRefCandles,
            breakoutVolMin: SCANNER_CONFIG.breakoutVolMin,
            riskReward: SCANNER_CONFIG.riskReward,
          },
        },
        rows: [],
        events: [],
      },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } finally {
    runtime.__arenaScanInFlight = undefined;
  }
}
