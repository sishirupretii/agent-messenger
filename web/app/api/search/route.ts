import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=<term>&limit=20
 *
 * Public cross-room search. Returns matching rooms (by name / slug /
 * description) AND matching signed messages (by body / sender). Read
 * only, no auth, CORS-open.
 *
 * The term is matched case-insensitive using ILIKE %term%. We cap at
 * 20 hits per category to keep responses tight. If the term looks like
 * an 0x address, sender matches lift to exact lowercased equality.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const ADDR_REGEX = /^0x[a-f0-9]{40}$/i;

export async function GET(req: NextRequest) {
  const qRaw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 20), 1),
    50,
  );

  if (qRaw.length < 2) {
    return NextResponse.json(
      { ok: false, error: "query_too_short", hint: "Min 2 chars." },
      { status: 400, headers: CORS },
    );
  }

  const escaped = qRaw.replace(/[%_]/g, "\\$&");
  const like = `%${escaped}%`;
  const asAddr = ADDR_REGEX.test(qRaw) ? qRaw.toLowerCase() : null;

  // Rooms: match name / slug / description
  const { data: rooms } = await supabase
    .from("signa_rooms")
    .select(
      "id, name, slug, description, creator_address, gate_token_symbol, gate_token_address, created_at",
    )
    .or(
      `name.ilike.${like},slug.ilike.${like},description.ilike.${like}` +
        (asAddr ? `,creator_address.eq.${asAddr},gate_token_address.eq.${asAddr}` : ""),
    )
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Messages: match body / from_address
  let msgQuery = supabase
    .from("signa_room_messages")
    .select("id, room_id, from_address, body, ts");
  if (asAddr) {
    msgQuery = msgQuery.or(`body.ilike.${like},from_address.eq.${asAddr}`);
  } else {
    msgQuery = msgQuery.ilike("body", like);
  }
  const { data: rawMsgs } = await msgQuery
    .order("ts", { ascending: false })
    .limit(limit);

  // Resolve room slugs for each message hit.
  const msgs = rawMsgs ?? [];
  const roomIdsInMsgs = Array.from(new Set(msgs.map((m) => m.room_id)));
  const slugMap = new Map<string, string>();
  if (roomIdsInMsgs.length > 0) {
    const { data: slugRows } = await supabase
      .from("signa_rooms")
      .select("id, slug")
      .in("id", roomIdsInMsgs);
    for (const r of slugRows ?? []) {
      slugMap.set(r.id, r.slug);
    }
  }

  const messages = msgs
    .map((m) => ({
      id: m.id,
      room_id: m.room_id,
      room_slug: slugMap.get(m.room_id) ?? "",
      from_address: m.from_address,
      body: String(m.body ?? "").slice(0, 240),
      ts: typeof m.ts === "number" ? m.ts : Number(m.ts),
    }))
    .filter((m) => m.room_slug.length > 0);

  return NextResponse.json(
    {
      ok: true,
      query: qRaw,
      rooms: rooms ?? [],
      messages,
    },
    { status: 200, headers: CORS },
  );
}
