import { NextRequest, NextResponse } from "next/server";
import { bankrRecentLaunches } from "@/lib/skills/bankr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/partners/bankr/launches?limit=N
 *
 * Public read. Recent token launches via Bankr's public /token-launches
 * endpoint. Surfaces the same data used on the SIGNA /launchpad page.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 10), 1), 50);
  const launches = await bankrRecentLaunches(limit);
  return NextResponse.json(
    { ok: true, count: launches.length, launches },
    { status: 200, headers: CORS },
  );
}
