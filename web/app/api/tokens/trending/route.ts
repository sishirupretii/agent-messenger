import { NextResponse } from "next/server";
import { trendingTokensOnBase, newPoolsOnBase } from "@/lib/geckoterminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CORS handled centrally by middleware.ts.

/**
 * GET /api/tokens/trending?kind=trending|new
 *
 * Hot tokens on Base, served from GeckoTerminal's public API and
 * cached 60 s in-process.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "new" ? "new" : "trending";
  const tokens =
    kind === "new" ? await newPoolsOnBase(30) : await trendingTokensOnBase(30);
  return NextResponse.json({
    ok: true,
    kind,
    tokens,
    source: "geckoterminal · base mainnet",
  });
}
