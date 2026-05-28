import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  computeManifestHash,
  getRoomAnchor,
  roomRegistryAddress,
} from "@/lib/onchain-rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/[slug]/anchor
 *
 * Reads the on-chain anchor for this room (if SignaRoomRegistry is
 * deployed) and cross-checks it against the locally stored signed
 * manifest. If both exist and match, the room is provably the same
 * one the creator wallet committed to on-chain — federation can
 * trust it without trusting our server.
 *
 * Returns:
 *   {
 *     ok: true,
 *     contract: 0x... | null,
 *     anchored: boolean,
 *     match: boolean,        // local manifestHash matches on-chain
 *     local: { creator, manifestHash } | null,
 *     onchain: { creator, manifestHash, anchoredAt, updatedAt, active } | null
 *   }
 *
 * Graceful: if the contract isn't deployed (env unset) the route still
 * returns ok:true with anchored:false. Frontend hides the badge in
 * that case.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();

  const { data: room } = await supabase
    .from("signa_rooms")
    .select("creator_address, signed_message")
    .eq("slug", slug)
    .maybeSingle();

  const localManifestHash = room?.signed_message
    ? computeManifestHash(room.signed_message)
    : null;
  const local = room
    ? {
        creator: room.creator_address,
        manifestHash: localManifestHash,
      }
    : null;

  const contractAddress = roomRegistryAddress();
  const onchain = await getRoomAnchor(slug);

  const match =
    !!onchain &&
    !!localManifestHash &&
    onchain.manifestHash.toLowerCase() === localManifestHash.toLowerCase() &&
    !!room &&
    onchain.creator.toLowerCase() === room.creator_address.toLowerCase();

  return NextResponse.json(
    {
      ok: true,
      contract: contractAddress,
      anchored: !!onchain && onchain.active,
      match,
      local,
      onchain,
    },
    { status: 200, headers: CORS },
  );
}
