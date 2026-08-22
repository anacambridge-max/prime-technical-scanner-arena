import { NextRequest, NextResponse } from "next/server";
import { getDashboardPayload } from "@/lib/scanner";
import { upstoxConfigured } from "@/lib/upstox";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/scan?force=1
 *
 * On-demand scan trigger + full dashboard state. Safe to poll: a new scan
 * only runs when the live window is open and the rescan gap has elapsed.
 * All Upstox calls stay server-side; the token never reaches the browser.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const force = req.nextUrl.searchParams.get("force") === "1";
  try {
    const payload = await getDashboardPayload(force);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    // Even a hard failure returns a well-formed payload so the dashboard
    // keeps rendering the last good data with a visible error banner.
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
  }
}
