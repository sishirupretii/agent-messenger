import { NextRequest, NextResponse } from "next/server";
import { bankrResolveRecipient } from "@/lib/skills/bankr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/partners/bankr/resolve?value=<handle>&type=address|ens|twitter|farcaster
 *
 * Public read. Resolves a Bankr recipient handle (ens / twitter / farcaster /
 * raw address) to its on-chain address via api.bankr.bot. No auth.
 *
 * Returns: { ok, value, resolution: { address, type, ... } | null }
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
  const value = sp.get("value")?.trim();
  if (!value) {
    return NextResponse.json(
      { ok: false, error: "value_required", hint: "Pass ?value=<handle or address>" },
      { status: 400, headers: CORS },
    );
  }
  const typeParam = sp.get("type")?.toLowerCase();
  const type = (["address", "ens", "twitter", "farcaster"] as const).find((t) => t === typeParam);

  const resolution = await bankrResolveRecipient(value, type);
  if (!resolution || !resolution.address) {
    return NextResponse.json(
      { ok: false, error: "not_found", hint: `Bankr did not resolve "${value}"` },
      { status: 404, headers: CORS },
    );
  }

  return NextResponse.json(
    { ok: true, value, resolution },
    { status: 200, headers: CORS },
  );
}
