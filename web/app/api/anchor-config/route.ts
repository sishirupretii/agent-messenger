import { NextResponse } from "next/server";
import { roomRegistryAddress } from "@/lib/onchain-rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/anchor-config
 *
 * Tells the client whether SignaRoomRegistry is deployed (env var set)
 * and what address to call. The CreateRoomDialog reads this so it can
 * render the anchor CTA conditionally without baking the address into
 * client code.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  const address = roomRegistryAddress();
  return NextResponse.json(
    {
      ok: true,
      deployed: !!address,
      chain: address ? "base" : null,
      chain_id: address ? 8453 : null,
      address,
    },
    { status: 200, headers: CORS },
  );
}
