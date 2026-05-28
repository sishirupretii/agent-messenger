import { NextRequest, NextResponse } from "next/server";
import { aeonDirectory } from "@/lib/skills/aeon-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/partners/aeon/directory?limit=50
 *
 * Public read endpoint that surfaces every Aeon / ERC-8004 agent
 * registered on Ethereum mainnet. Resolves each agent's on-chain
 * agentURI to its registration JSON in parallel.
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
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 50), 1),
    100,
  );
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  try {
    // limit doubles as scan range (1..maxScan) AND result slice cap.
    // The cache stores the full scan, so we slice after read.
    const entries = (await aeonDirectory(Math.max(limit, 50), refresh)).slice(0, limit);
    return NextResponse.json(
      { ok: true, count: entries.length, agents: entries },
      { status: 200, headers: CORS },
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500, headers: CORS },
    );
  }
}
