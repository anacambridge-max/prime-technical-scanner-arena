import { NextRequest, NextResponse } from "next/server";
import { getDashboardPayload } from "@/lib/scanner";
import { getLockedDashboardPayload } from "@/lib/lockedDashboard";
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
      marketPhase: "LIVE_SCAN",
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
        scanStart: "09:15",
        scanEnd: "10:00",
        rescanSeconds: 45,
        volRefCandles: 20,
        breakoutVolMin: 1.5,
        riskReward: 2,
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

    // IMPORTANT: after 10:00 IST never start a fresh Upstox replay from the
    // browser. The old post-market replay could keep a Hobby function busy
    // until Vercel returned 504/network error. After the scan window we only
    // read the persisted dashboard state.
    const phase = marketPhase(new Date(), SCANNER_CONFIG);
    const work = phase === "SCAN_ENDED" && !force
      ? getLockedDashboardPayload()
      : getDashboardPayload(force);

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
            scanStart: "09:15",
            scanEnd: "10:00",
            rescanSeconds: 45,
            volRefCandles: 20,
            breakoutVolMin: 1.5,
            riskReward: 2,
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
