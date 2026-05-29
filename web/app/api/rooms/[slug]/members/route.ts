import { NextRequest, NextResponse } from "next/server";
import { supabase, serverClient } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign } from "@/lib/feed-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * v0.80 — Membership for encrypted (private) SIGNA rooms.
 *
 * GET  /api/rooms/[slug]/members
 *   List members of an encrypted room. Each row carries the member's
 *   published X25519 pubkey (if registered) so the caller can encrypt
 *   their next message to every member in one pass.
 *
 *   Public rooms always return an empty members[] (they're open to
 *   any wallet, no membership tracking).
 *
 * POST /api/rooms/[slug]/members
 *   Room creator adds a new member. Body:
 *     { address, member_address, ts, signature }
 *
 *   The signed envelope binds (creator, room_slug, member_address, ts)
 *   so anyone can re-verify the invite. Once added, the member can
 *   read messages encrypted for them and post new encrypted messages.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
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

  const { data: room, error: roomErr } = await supabase
    .from("signa_rooms")
    .select("id, is_encrypted, encryption_version")
    .eq("slug", slug)
    .maybeSingle();
  if (roomErr) {
    return NextResponse.json(
      { ok: false, error: roomErr.message },
      { status: 500, headers: CORS },
    );
  }
  if (!room) {
    return NextResponse.json(
      { ok: false, error: "room_not_found" },
      { status: 404, headers: CORS },
    );
  }

  if (!room.is_encrypted) {
    return NextResponse.json(
      { ok: true, slug, is_encrypted: false, members: [] },
      { status: 200, headers: CORS },
    );
  }

  const { data: members, error: mErr } = await supabase
    .from("signa_room_members")
    .select("member_address, added_by, added_ts, added_signature, added_signed_message")
    .eq("room_id", room.id)
    .order("added_ts", { ascending: true });
  if (mErr) {
    return NextResponse.json(
      { ok: false, error: mErr.message },
      { status: 500, headers: CORS },
    );
  }

  // Join published X25519 pubkeys so callers can encrypt in one pass.
  const addrs = (members ?? []).map((m) => m.member_address);
  let pubkeyMap = new Map<string, { x25519_pubkey: string; signed_message: string; signature: string }>();
  if (addrs.length > 0) {
    const { data: pubs } = await supabase
      .from("signa_user_pubkeys")
      .select("address, x25519_pubkey, signed_message, signature")
      .in("address", addrs);
    for (const p of pubs ?? []) {
      pubkeyMap.set(p.address, {
        x25519_pubkey: p.x25519_pubkey,
        signed_message: p.signed_message,
        signature: p.signature,
      });
    }
  }

  const out = (members ?? []).map((m) => {
    const pk = pubkeyMap.get(m.member_address);
    return {
      address: m.member_address,
      x25519_pubkey: pk?.x25519_pubkey ?? null,
      pubkey_signed_message: pk?.signed_message ?? null,
      pubkey_signature: pk?.signature ?? null,
      added_by: m.added_by,
      added_ts: m.added_ts,
      added_signature: m.added_signature,
      added_signed_message: m.added_signed_message,
    };
  });

  return NextResponse.json(
    {
      ok: true,
      slug,
      is_encrypted: true,
      encryption_version: room.encryption_version,
      count: out.length,
      members: out,
    },
    { status: 200, headers: CORS },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad_json" },
      { status: 400, headers: CORS },
    );
  }

  const address = String(body.address ?? "").toLowerCase();
  const member_address = String(body.member_address ?? "").toLowerCase();
  const ts = Number(body.ts ?? 0);
  const signature = String(body.signature ?? "");

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json(
      { ok: false, error: "invalid_address" },
      { status: 400, headers: CORS },
    );
  }
  if (!/^0x[a-f0-9]{40}$/.test(member_address)) {
    return NextResponse.json(
      { ok: false, error: "invalid_member_address" },
      { status: 400, headers: CORS },
    );
  }
  if (!ts || !signature) {
    return NextResponse.json(
      { ok: false, error: "missing_signature_or_ts" },
      { status: 400, headers: CORS },
    );
  }

  const { data: room, error: roomErr } = await supabase
    .from("signa_rooms")
    .select("id, creator_address, is_encrypted")
    .eq("slug", slug)
    .maybeSingle();
  if (roomErr) {
    return NextResponse.json(
      { ok: false, error: roomErr.message },
      { status: 500, headers: CORS },
    );
  }
  if (!room) {
    return NextResponse.json(
      { ok: false, error: "room_not_found" },
      { status: 404, headers: CORS },
    );
  }
  if (!room.is_encrypted) {
    return NextResponse.json(
      {
        ok: false,
        error: "not_an_encrypted_room",
        hint: "Public rooms don't track membership.",
      },
      { status: 400, headers: CORS },
    );
  }
  if (room.creator_address.toLowerCase() !== address) {
    return NextResponse.json(
      {
        ok: false,
        error: "not_authorized",
        hint: "Only the room creator can add members in v0.80.",
      },
      { status: 403, headers: CORS },
    );
  }

  const message = buildMessageToSign({
    kind: "signa_room_add_member",
    address,
    room_slug: slug,
    member_address,
    ts,
  });
  const verify = await verifySignedMessage({
    expectedAddress: address,
    message,
    signature,
    ts,
  });
  if (!verify.ok) {
    return NextResponse.json(
      { ok: false, error: verify.reason },
      { status: 401, headers: CORS },
    );
  }

  const db = serverClient();
  const { error: insErr } = await db
    .from("signa_room_members")
    .upsert(
      {
        room_id: room.id,
        member_address,
        added_by: address,
        added_ts: ts,
        added_signature: signature,
        added_signed_message: message,
      },
      { onConflict: "room_id,member_address", ignoreDuplicates: true },
    );
  if (insErr) {
    return NextResponse.json(
      { ok: false, error: insErr.message },
      { status: 500, headers: CORS },
    );
  }

  return NextResponse.json(
    { ok: true, member_address },
    { status: 200, headers: CORS },
  );
}
