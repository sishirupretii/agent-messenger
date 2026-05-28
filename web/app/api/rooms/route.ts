import { NextRequest, NextResponse } from "next/server";
import { supabase, serverClient } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign, ROOM_SLUG_REGEX } from "@/lib/feed-types";
import { fetchTokenMeta } from "@/lib/room-gating";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/rooms                 List public rooms.
 * POST /api/rooms                 Create a wallet-signed room.
 *
 * Body for POST:
 *   { address, name, slug, description?, is_public, ts, signature }
 *
 * Every public read is CORS-open. Writes verify the signature matches
 * the declared address — the SIGNA node persists only what verifies.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50), 1), 200);

  const { data, error } = await supabase
    .from("signa_rooms")
    .select("id, name, slug, description, creator_address, is_public, ts, created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: CORS },
    );
  }
  return NextResponse.json(
    { ok: true, count: data?.length ?? 0, rooms: data ?? [] },
    { status: 200, headers: CORS },
  );
}

export async function POST(req: NextRequest) {
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
  const name = String(body.name ?? "").trim();
  const slug = String(body.slug ?? "").toLowerCase().trim();
  const description = body.description ? String(body.description).trim() : undefined;
  const is_public = body.is_public !== false; // default true
  const ts = Number(body.ts ?? 0);
  const signature = String(body.signature ?? "");

  // v0.50 — optional hold-to-chat gate.
  const gate_token_address_raw = body.gate_token_address
    ? String(body.gate_token_address).toLowerCase().trim()
    : undefined;
  const gate_chain_raw = body.gate_chain
    ? String(body.gate_chain).toLowerCase().trim()
    : undefined;
  const gate_min_balance_raw_in = body.gate_min_balance_raw
    ? String(body.gate_min_balance_raw).trim()
    : undefined;

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "invalid_address" }, { status: 400, headers: CORS });
  }
  if (name.length < 1 || name.length > 80) {
    return NextResponse.json({ ok: false, error: "invalid_name", hint: "1-80 chars" }, { status: 400, headers: CORS });
  }
  if (!ROOM_SLUG_REGEX.test(slug)) {
    return NextResponse.json(
      { ok: false, error: "invalid_slug", hint: "lowercase a-z0-9 + dashes, 3-32 chars, starts/ends alnum" },
      { status: 400, headers: CORS },
    );
  }
  if (description && description.length > 500) {
    return NextResponse.json({ ok: false, error: "description_too_long" }, { status: 400, headers: CORS });
  }
  if (!signature || !ts) {
    return NextResponse.json({ ok: false, error: "missing_signature_or_ts" }, { status: 400, headers: CORS });
  }

  // Gate validation: all three or none.
  const gatePartial =
    !!gate_token_address_raw !== !!gate_chain_raw ||
    !!gate_chain_raw !== !!gate_min_balance_raw_in;
  if (gatePartial) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_gate",
        hint:
          "gate_token_address, gate_chain, and gate_min_balance_raw must all be set together (or all omitted).",
      },
      { status: 400, headers: CORS },
    );
  }
  if (gate_token_address_raw && !/^0x[a-f0-9]{40}$/.test(gate_token_address_raw)) {
    return NextResponse.json(
      { ok: false, error: "invalid_gate_token_address" },
      { status: 400, headers: CORS },
    );
  }
  if (gate_chain_raw && !["base", "ethereum", "mainnet"].includes(gate_chain_raw)) {
    return NextResponse.json(
      {
        ok: false,
        error: "unsupported_gate_chain",
        hint: "base | ethereum supported",
      },
      { status: 400, headers: CORS },
    );
  }
  if (gate_min_balance_raw_in) {
    try {
      const v = BigInt(gate_min_balance_raw_in);
      if (v <= 0n) throw new Error("non-positive");
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_gate_min_balance",
          hint: "uint256 string > 0",
        },
        { status: 400, headers: CORS },
      );
    }
  }

  const message = buildMessageToSign({
    kind: "signa_room_create",
    address,
    name,
    slug,
    description,
    is_public,
    gate_token_address: gate_token_address_raw,
    gate_chain: gate_chain_raw,
    gate_min_balance_raw: gate_min_balance_raw_in,
    ts,
  });

  const verify = await verifySignedMessage({
    expectedAddress: address,
    message,
    signature,
    ts,
  });
  if (!verify.ok) {
    return NextResponse.json({ ok: false, error: verify.reason }, { status: 401, headers: CORS });
  }

  // Uniqueness: slug must not already exist
  const { data: existing } = await supabase
    .from("signa_rooms")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: false, error: "slug_taken", hint: "Pick a different slug." }, { status: 409, headers: CORS });
  }

  // Resolve real token symbol + decimals from chain when gated.
  let gate_token_symbol: string | null = null;
  let gate_token_decimals: number | null = null;
  if (gate_token_address_raw && gate_chain_raw) {
    const meta = await fetchTokenMeta(gate_token_address_raw, gate_chain_raw);
    gate_token_symbol = meta.symbol;
    gate_token_decimals = typeof meta.decimals === "number" ? meta.decimals : null;
  }

  const db = serverClient();
  const { data, error: insErr } = await db
    .from("signa_rooms")
    .insert({
      name,
      slug,
      description: description ?? null,
      creator_address: address,
      is_public,
      ts,
      signature,
      signed_message: message,
      gate_token_address: gate_token_address_raw ?? null,
      gate_chain: gate_chain_raw ?? null,
      gate_min_balance_raw: gate_min_balance_raw_in ?? null,
      gate_token_symbol,
      gate_token_decimals,
    })
    .select(
      "id, name, slug, description, creator_address, is_public, ts, created_at, gate_token_address, gate_chain, gate_min_balance_raw, gate_token_symbol, gate_token_decimals",
    )
    .single();

  if (insErr) {
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500, headers: CORS });
  }

  return NextResponse.json({ ok: true, room: data }, { status: 200, headers: CORS });
}
