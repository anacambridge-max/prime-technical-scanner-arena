import { NextRequest, NextResponse } from "next/server";
import { getDashboardPayload } from "@/lib/scanner";
import { upstoxConfigured } from "@/lib/upstox";
import type { ScanPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
// Keep the request below Vercel's Hobby execution ceiling. The collector has
// its own shorter time budget, so this is only a final safety boundary.
export const maxDuration = 60;

// Database persistence is backed by the arena scanner tables in Supabase.
// The schema is provisioned separately so deployments do not depend on a
// runtime migration step.
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
    // Prevent overlapping /api/scan requests from starting duplicate Upstox
    // scans. This is important because the browser auto-refreshes frequently
    // and Vercel can serve multiple requests from the same warm instance.
    if (runtime.__arenaScanInFlight) {
      return NextResponse.json(busyPayload(), {
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

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
    // Clear only after the promise has settled so concurrent requests during
    // the scan are served the last completed payload instead of starting work.
    runtime.__arenaScanInFlight = undefined;
  }
}
