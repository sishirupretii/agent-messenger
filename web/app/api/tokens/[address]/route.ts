import { NextRequest, NextResponse } from "next/server";
import { tokenOnBase } from "@/lib/geckoterminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CORS handled centrally by middleware.ts.

/**
 * GET /api/tokens/[address]
 *
 * Token detail for an ERC-20 on Base. Returns:
 *   { ok, address, symbol, name, price_usd, volume_24h_usd,
 *     market_cap_usd, fdv_usd, change_24h_pct, top_pool_address, image_url }
 *
 * Used by /tokens/[address] page and (later) by the inline $SYMBOL
 * cards rendered in feed posts.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const addr = raw.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  const t = await tokenOnBase(addr);
  if (!t) {
    return NextResponse.json(
      { ok: false, error: "not_found_on_base" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, ...t });
}
