import { NextRequest, NextResponse } from "next/server";
import { getDashboardPayload } from "@/lib/scanner";
import { upstoxConfigured } from "@/lib/upstox";

export const dynamic = "force-dynamic";
// Keep this within the practical Vercel function limit; the scanner itself
// also has a shorter internal budget so requests fail gracefully.
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const force = req.nextUrl.searchParams.get("force") === "1";
  try {
    const payload = await getDashboardPayload(force);
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
  }
}
