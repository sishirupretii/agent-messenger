import { NextRequest, NextResponse } from "next/server";
import { supabase, serverClient } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import {
  buildMessageToSign,
  ciphertextDigest,
  MAX_ROOM_MESSAGE_LENGTH,
} from "@/lib/feed-types";
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
    .select("id, is_public, is_encrypted, encryption_version")
    .eq("slug", slug)
    .maybeSingle();
  if (roomErr) return NextResponse.json({ ok: false, error: roomErr.message }, { status: 500, headers: CORS });
  if (!room) return NextResponse.json({ ok: false, error: "room_not_found" }, { status: 404, headers: CORS });

  let q = supabase
    .from("signa_room_messages")
    .select(
      "id, from_address, body, body_type, ts, signature, signed_message, in_reply_to, created_at, is_encrypted, ciphertext_digest",
    )
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

  // v0.80 — for encrypted rooms, attach the per-recipient ciphertext
  // map to each message. Caller picks their own row out of `ciphertexts`
  // and decrypts client-side.
  let messages = data ?? [];
  if (room.is_encrypted && messages.length > 0) {
    const msgIds = messages.map((m) => m.id);
    const { data: cts } = await supabase
      .from("signa_room_message_ciphertexts")
      .select("message_id, recipient_address, ciphertext")
      .in("message_id", msgIds);
    const ctMap = new Map<string, Record<string, string>>();
    for (const row of cts ?? []) {
      const m = ctMap.get(row.message_id) ?? {};
      m[row.recipient_address] = row.ciphertext;
      ctMap.set(row.message_id, m);
    }
    messages = messages.map((m) => ({
      ...m,
      ciphertexts: ctMap.get(m.id) ?? {},
    }));
  }

  return NextResponse.json(
    {
      ok: true,
      slug,
      is_encrypted: room.is_encrypted,
      encryption_version: room.encryption_version,
      count: messages.length,
      messages,
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

  // v0.80 — encrypted room write: caller supplies a per-recipient
  // ciphertext map and the digest the envelope signs over. Plaintext
  // body is omitted in this path.
  const ciphertextsIn: Record<string, string> | undefined =
    body.ciphertexts && typeof body.ciphertexts === "object"
      ? Object.fromEntries(
          Object.entries(body.ciphertexts).map(([k, v]) => [
            String(k).toLowerCase(),
            String(v ?? ""),
          ]),
        )
      : undefined;
  const ciphertextDigestIn = body.ciphertext_digest
    ? String(body.ciphertext_digest).toLowerCase()
    : undefined;
  const isEncryptedWrite = !!ciphertextsIn && !!ciphertextDigestIn;

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "invalid_address" }, { status: 400, headers: CORS });
  }
  if (!isEncryptedWrite) {
    if (!messageBody || messageBody.length < 1 || messageBody.length > MAX_ROOM_MESSAGE_LENGTH) {
      return NextResponse.json({ ok: false, error: "invalid_body", hint: `1..${MAX_ROOM_MESSAGE_LENGTH} chars` }, { status: 400, headers: CORS });
    }
    if (!["text", "json", "command"].includes(body_type)) {
      return NextResponse.json({ ok: false, error: "invalid_body_type" }, { status: 400, headers: CORS });
    }
  }
  if (!signature || !ts) {
    return NextResponse.json({ ok: false, error: "missing_signature_or_ts" }, { status: 400, headers: CORS });
  }

  const { data: room, error: roomErr } = await supabase
    .from("signa_rooms")
    .select(
      "id, is_public, creator_address, gate_token_address, gate_chain, gate_min_balance_raw, gate_token_symbol, gate_token_decimals, is_encrypted",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (roomErr) return NextResponse.json({ ok: false, error: roomErr.message }, { status: 500, headers: CORS });
  if (!room) return NextResponse.json({ ok: false, error: "room_not_found" }, { status: 404, headers: CORS });

  // Encrypted rooms only accept encrypted writes (no plaintext leaks).
  if (room.is_encrypted && !isEncryptedWrite) {
    return NextResponse.json(
      {
        ok: false,
        error: "encrypted_room_requires_ciphertexts",
        hint: "Pass { ciphertexts: { addr: base64 }, ciphertext_digest } instead of body.",
      },
      { status: 400, headers: CORS },
    );
  }
  if (!room.is_encrypted && isEncryptedWrite) {
    return NextResponse.json(
      {
        ok: false,
        error: "plaintext_room_rejected_encrypted_write",
        hint: "This room is public/plaintext. Pass body, not ciphertexts.",
      },
      { status: 400, headers: CORS },
    );
  }

  if (room.is_encrypted) {
    // Membership check: sender must be a member.
    const { data: memCheck } = await supabase
      .from("signa_room_members")
      .select("member_address")
      .eq("room_id", room.id)
      .eq("member_address", address)
      .maybeSingle();
    if (!memCheck) {
      return NextResponse.json(
        {
          ok: false,
          error: "not_a_member",
          hint: "Encrypted rooms only accept writes from listed members.",
        },
        { status: 403, headers: CORS },
      );
    }
    // Validate the ciphertext map covers every current member exactly.
    const { data: roomMembers } = await supabase
      .from("signa_room_members")
      .select("member_address")
      .eq("room_id", room.id);
    const memberSet = new Set((roomMembers ?? []).map((m) => m.member_address));
    const ctSet = new Set(Object.keys(ciphertextsIn ?? {}));
    if (memberSet.size !== ctSet.size || ![...memberSet].every((m) => ctSet.has(m))) {
      return NextResponse.json(
        {
          ok: false,
          error: "ciphertext_member_mismatch",
          hint: "ciphertexts map must include exactly one entry per current member.",
          expected: [...memberSet],
        },
        { status: 400, headers: CORS },
      );
    }
    // Recompute the digest server-side and check it matches the one the
    // sender signed — pins the exact ciphertext set to the signature.
    const recomputed = await ciphertextDigest(ciphertextsIn ?? {});
    if (recomputed !== ciphertextDigestIn) {
      return NextResponse.json(
        {
          ok: false,
          error: "digest_mismatch",
          hint: "Recomputed digest does not match the signed envelope.",
          expected: recomputed,
          received: ciphertextDigestIn,
        },
        { status: 400, headers: CORS },
      );
    }
  } else if (!room.is_public && room.creator_address.toLowerCase() !== address) {
    return NextResponse.json(
      { ok: false, error: "not_authorized", hint: "Private (non-encrypted) rooms only accept posts from the creator." },
      { status: 403, headers: CORS },
    );
  }

  const canonical = room.is_encrypted
    ? buildMessageToSign({
        kind: "signa_room_encrypted_message",
        address,
        room_slug: slug,
        ciphertext_digest: ciphertextDigestIn!,
        in_reply_to,
        ts,
      })
    : buildMessageToSign({
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

  // Hold-to-chat gate (v0.43). Skipped for encrypted rooms because
  // those gate on membership instead. Room creator (e.g. SIGNA bot)
  // bypasses so launch announcements always land. Everyone else must
  // hold the token.
  if (!room.is_encrypted && room.gate_token_address) {
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
      // Encrypted rooms store an opaque marker in `body` since the
      // column is NOT NULL with a length CHECK. The real ciphertexts
      // live in signa_room_message_ciphertexts.
      body: room.is_encrypted
        ? `[encrypted ${ciphertextDigestIn?.slice(0, 8)}]`
        : messageBody,
      body_type,
      ts,
      signature,
      signed_message: canonical,
      in_reply_to: in_reply_to ?? null,
      is_encrypted: room.is_encrypted,
      ciphertext_digest: room.is_encrypted ? ciphertextDigestIn : null,
    })
    .select(
      "id, from_address, body, body_type, ts, in_reply_to, created_at, is_encrypted, ciphertext_digest",
    )
    .single();

  if (insErr) {
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500, headers: CORS });
  }

  // v0.80 — persist per-recipient ciphertexts for encrypted writes.
  if (room.is_encrypted && ciphertextsIn) {
    const rows = Object.entries(ciphertextsIn).map(([recipient_address, ciphertext]) => ({
      message_id: data.id,
      recipient_address,
      ciphertext,
    }));
    const { error: ctErr } = await db
      .from("signa_room_message_ciphertexts")
      .insert(rows);
    if (ctErr) {
      // Roll the envelope back so we never leave a ciphertext-less
      // encrypted message behind.
      await db.from("signa_room_messages").delete().eq("id", data.id);
      return NextResponse.json(
        { ok: false, error: "ciphertext_insert_failed", detail: ctErr.message },
        { status: 500, headers: CORS },
      );
    }
  }

  // v0.73 — fan-out @0x mentions. Encrypted rooms skip mention fan-out
  // because the server never sees the plaintext and the marker body
  // carries no addresses to match. Best-effort otherwise: if mentions
  // insert fails the message stays — recipients just miss the inbox
  // row. Capped at 10 per envelope by the parser.
  const mentioned = room.is_encrypted
    ? []
    : parseMentions(messageBody).filter((a) => a !== address);
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
    {
      ok: true,
      message: { ...data, ciphertexts: ciphertextsIn ?? undefined },
      mentions: mentioned,
    },
    { status: 200, headers: CORS },
  );
}
