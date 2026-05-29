import { NextRequest, NextResponse } from "next/server";
import { computeTokenWars } from "@/lib/token-score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 50), 1),
    200,
  );
  const all = await computeTokenWars();
  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      count: all.length,
      leaderboard: all.slice(0, limit),
    },
    { status: 200, headers: CORS },
  );
}
