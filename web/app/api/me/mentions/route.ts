import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/mentions?address=0x...&limit=50&since=<ts>
 *
 * Public inbox of @-mentions for any wallet across every public room.
 * No auth — read-only. The mentioned address is in the URL so anyone
 * can audit who has been mentioned where. Privacy of room content is
 * a function of the room's gate, not this endpoint.
 *
 * Returns the joined room slug + sender + the original signed message
 * body so the inbox can render a clean preview.
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
  const address = (req.nextUrl.searchParams.get("address") ?? "").toLowerCase();
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 50), 1),
    200,
  );
  const since = req.nextUrl.searchParams.get("since");

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json(
      { ok: false, error: "invalid_address" },
      { status: 400, headers: CORS },
    );
  }

  let q = supabase
    .from("signa_room_mentions")
    .select("id, message_id, room_id, from_address, mentioned_address, ts, created_at")
    .eq("mentioned_address", address)
    .order("ts", { ascending: false })
    .limit(limit);

  if (since) {
    const ms = Number(since);
    if (Number.isFinite(ms) && ms > 0) q = q.gt("ts", ms);
  }

  const { data: rows, error } = await q;
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: CORS },
    );
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json(
      { ok: true, address, count: 0, mentions: [] },
      { status: 200, headers: CORS },
    );
  }

  // Hydrate room slug + message body for each mention.
  const roomIds = Array.from(new Set(rows.map((r) => r.room_id)));
  const messageIds = Array.from(new Set(rows.map((r) => r.message_id)));

  const [{ data: rooms }, { data: messages }] = await Promise.all([
    supabase.from("signa_rooms").select("id, slug, name").in("id", roomIds),
    supabase
      .from("signa_room_messages")
      .select("id, body, signature, signed_message")
      .in("id", messageIds),
  ]);

  const roomMap = new Map(
    (rooms ?? []).map((r) => [r.id, { slug: r.slug, name: r.name }]),
  );
  const msgMap = new Map((messages ?? []).map((m) => [m.id, m]));

  const mentions = rows.map((r) => {
    const room = roomMap.get(r.room_id);
    const msg = msgMap.get(r.message_id);
    return {
      id: r.id,
      message_id: r.message_id,
      room: room ?? null,
      from_address: r.from_address,
      ts: typeof r.ts === "number" ? r.ts : Number(r.ts),
      body: msg?.body ?? "",
      signature: msg?.signature ?? null,
      signed_message: msg?.signed_message ?? null,
    };
  });

  return NextResponse.json(
    { ok: true, address, count: mentions.length, mentions },
    { status: 200, headers: CORS },
  );
}
