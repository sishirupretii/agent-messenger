import { NextRequest, NextResponse } from "next/server";
import { getPortfolio } from "@/lib/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CORS handled centrally by middleware.ts (matcher = /api/me/:path*).

/**
 * GET /api/me/portfolio?address=0x…&watchlist=0xa,0xb,0xc
 *
 * Live portfolio snapshot for any wallet. No auth — balances are public
 * on chain, prices are public on GeckoTerminal. Cached 60s per
 * (address, watchlist) pair via getPortfolio.
 */
export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "")
    .trim()
    .toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  const watchlistRaw = req.nextUrl.searchParams.get("watchlist") ?? "";
  const watchlist = watchlistRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[a-f0-9]{40}$/.test(s));

  try {
    const snap = await getPortfolio(address, watchlist);
    return NextResponse.json({ ok: true, ...snap });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "portfolio_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
