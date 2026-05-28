import { NextRequest, NextResponse } from "next/server";
import { supabase, serverClient } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign, MAX_ROOM_MESSAGE_LENGTH } from "@/lib/feed-types";
import { checkRoomGate, formatBalance } from "@/lib/room-gating";
import { parseMentions } from "@/lib/mention-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/rooms/[slug]/messages       Read the room's timeline.
 * POST /api/rooms/[slug]/messages       Post a wallet-signed message.
 *
 * Body for POST:
 *   { address, body, body_type?, in_reply_to?, ts, signature }
 *
 * Anyone with a wallet can post into any public room. Private rooms
 * (is_public=false) only accept posts from the creator for now; full
 * membership ACL ships in v0.40.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_PER_HOUR = 200;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50), 1), 200);
  const since = sp.get("since");

  const { data: room, error: roomErr } = await supabase
    .from("signa_rooms")
    .select("id, is_public")
    .eq("slug", slug)
    .maybeSingle();
  if (roomErr) return NextResponse.json({ ok: false, error: roomErr.message }, { status: 500, headers: CORS });
  if (!room) return NextResponse.json({ ok: false, error: "room_not_found" }, { status: 404, headers: CORS });

  let q = supabase
    .from("signa_room_messages")
    .select("id, from_address, body, body_type, ts, signature, signed_message, in_reply_to, created_at")
    .eq("room_id", room.id)
    .order("ts", { ascending: true })
    .limit(limit);

  if (since) {
    const sinceMs = Number(since);
    if (Number.isFinite(sinceMs) && sinceMs > 0) {
      q = q.gt("ts", sinceMs);
    }
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: CORS });

  return NextResponse.json(
    {
      ok: true,
      slug,
      count: data?.length ?? 0,
      messages: data ?? [],
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
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400, headers: CORS });
  }

  const address = String(body.address ?? "").toLowerCase();
  const messageBody = String(body.body ?? "");
  const body_type = (body.body_type ?? "text") as "text" | "json" | "command";
  const in_reply_to = body.in_reply_to ? String(body.in_reply_to) : undefined;
  const ts = Number(body.ts ?? 0);
  const signature = String(body.signature ?? "");

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "invalid_address" }, { status: 400, headers: CORS });
  }
  if (!messageBody || messageBody.length < 1 || messageBody.length > MAX_ROOM_MESSAGE_LENGTH) {
    return NextResponse.json({ ok: false, error: "invalid_body", hint: `1..${MAX_ROOM_MESSAGE_LENGTH} chars` }, { status: 400, headers: CORS });
  }
  if (!["text", "json", "command"].includes(body_type)) {
    return NextResponse.json({ ok: false, error: "invalid_body_type" }, { status: 400, headers: CORS });
  }
  if (!signature || !ts) {
    return NextResponse.json({ ok: false, error: "missing_signature_or_ts" }, { status: 400, headers: CORS });
  }

  const { data: room, error: roomErr } = await supabase
    .from("signa_rooms")
    .select("id, is_public, creator_address, gate_token_address, gate_chain, gate_min_balance_raw, gate_token_symbol, gate_token_decimals")
    .eq("slug", slug)
    .maybeSingle();
  if (roomErr) return NextResponse.json({ ok: false, error: roomErr.message }, { status: 500, headers: CORS });
  if (!room) return NextResponse.json({ ok: false, error: "room_not_found" }, { status: 404, headers: CORS });

  if (!room.is_public && room.creator_address.toLowerCase() !== address) {
    return NextResponse.json(
      { ok: false, error: "not_authorized", hint: "Private rooms only accept posts from the creator until membership ACL ships in v0.40." },
      { status: 403, headers: CORS },
    );
  }

  const canonical = buildMessageToSign({
    kind: "signa_room_message",
    address,
    room_slug: slug,
    body: messageBody,
    body_type: body_type === "text" ? undefined : body_type,
    in_reply_to,
    ts,
  });

  const verify = await verifySignedMessage({
    expectedAddress: address,
    message: canonical,
    signature,
    ts,
  });
  if (!verify.ok) {
    return NextResponse.json({ ok: false, error: verify.reason }, { status: 401, headers: CORS });
  }

  // Hold-to-chat gate (v0.43). Room creator (e.g. SIGNA bot) bypasses so
  // launch announcements always land. Everyone else must hold the token.
  if (room.gate_token_address) {
    const bypass = room.creator_address.toLowerCase() === address;
    const gateCheck = await checkRoomGate(
      address,
      {
        gate_token_address: room.gate_token_address,
        gate_chain: room.gate_chain,
        gate_min_balance_raw: room.gate_min_balance_raw,
        gate_token_symbol: room.gate_token_symbol,
        gate_token_decimals: room.gate_token_decimals,
      },
      bypass,
    );
    if (!gateCheck.ok) {
      const minHuman = formatBalance(gateCheck.minBalanceRaw, gateCheck.decimals);
      const heldHuman = "heldRaw" in gateCheck && gateCheck.heldRaw
        ? formatBalance(gateCheck.heldRaw, gateCheck.decimals)
        : "0";
      return NextResponse.json(
        {
          ok: false,
          error: "gate_failed",
          reason: gateCheck.reason,
          hint:
            gateCheck.reason === "insufficient_balance"
              ? `Hold-to-chat: need ${minHuman} ${gateCheck.symbol ?? "TOKEN"} on ${gateCheck.chain}. You hold ${heldHuman}.`
              : gateCheck.reason === "unsupported_chain"
                ? `Chain ${gateCheck.chain} not supported for gating yet.`
                : "Could not read your balance from the chain right now. Try again in a moment.",
          gate: {
            tokenAddress: gateCheck.tokenAddress,
            chain: gateCheck.chain,
            symbol: gateCheck.symbol,
            minBalance: minHuman,
            minBalanceRaw: gateCheck.minBalanceRaw,
          },
        },
        { status: 403, headers: CORS },
      );
    }
  }

  // Light rate limit per sender: 200 posts/hour to a given room.
  const since = Date.now() - RATE_WINDOW_MS;
  const { count } = await supabase
    .from("signa_room_messages")
    .select("id", { count: "exact", head: true })
    .eq("room_id", room.id)
    .eq("from_address", address)
    .gte("ts", since);

  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", hint: `Max ${RATE_LIMIT_PER_HOUR} messages per hour per sender per room.` },
      { status: 429, headers: CORS },
    );
  }

  const db = serverClient();
  const { data, error: insErr } = await db
    .from("signa_room_messages")
    .insert({
      room_id: room.id,
      from_address: address,
      body: messageBody,
      body_type,
      ts,
      signature,
      signed_message: canonical,
      in_reply_to: in_reply_to ?? null,
    })
    .select("id, from_address, body, body_type, ts, in_reply_to, created_at")
    .single();

  if (insErr) {
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500, headers: CORS });
  }

  // v0.73 — fan-out @0x mentions. Best-effort: if the mentions insert
  // fails the message itself stays — recipients just don't get the
  // inbox row. Capped at 10 per envelope by the parser.
  const mentioned = parseMentions(messageBody).filter((a) => a !== address);
  if (mentioned.length > 0) {
    const rows = mentioned.map((mentioned_address) => ({
      message_id: data.id,
      room_id: room.id,
      from_address: address,
      mentioned_address,
      ts,
    }));
    const { error: mErr } = await db
      .from("signa_room_mentions")
      .upsert(rows, { onConflict: "message_id,mentioned_address" });
    if (mErr) {
      console.error("[mentions] insert failed:", mErr.message);
    }
  }

  return NextResponse.json(
    { ok: true, message: data, mentions: mentioned },
    { status: 200, headers: CORS },
  );
}
