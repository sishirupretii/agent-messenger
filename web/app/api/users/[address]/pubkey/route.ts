import { NextRequest, NextResponse } from "next/server";
import { supabase, serverClient } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign } from "@/lib/feed-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * v0.80 — X25519 public-key registry for encrypted rooms.
 *
 * GET  /api/users/[address]/pubkey   Returns the wallet's published
 *                                     X25519 pubkey along with the signed
 *                                     envelope so callers can re-verify
 *                                     offline before encrypting to it.
 * POST /api/users/[address]/pubkey   Wallet publishes/rotates its X25519
 *                                     pubkey. Body:
 *                                       { address, x25519_pubkey, ts, signature }
 *
 * The pubkey is deterministically derived client-side from an EIP-191
 * signature over the fixed preimage "SIGNA encryption key v1" — same
 * wallet on any device produces the same X25519 keypair. The server
 * never sees the secret key.
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
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const address = (raw ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json(
      { ok: false, error: "invalid_address" },
      { status: 400, headers: CORS },
    );
  }
  const { data, error } = await supabase
    .from("signa_user_pubkeys")
    .select("address, x25519_pubkey, ts, signature, signed_message, updated_at")
    .eq("address", address)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: CORS },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "pubkey_not_registered" },
      { status: 404, headers: CORS },
    );
  }
  return NextResponse.json({ ok: true, pubkey: data }, { status: 200, headers: CORS });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const routeAddress = (raw ?? "").toLowerCase();

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
  const x25519_pubkey = String(body.x25519_pubkey ?? "").trim();
  const ts = Number(body.ts ?? 0);
  const signature = String(body.signature ?? "");

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json(
      { ok: false, error: "invalid_address" },
      { status: 400, headers: CORS },
    );
  }
  if (address !== routeAddress) {
    return NextResponse.json(
      { ok: false, error: "address_mismatch" },
      { status: 400, headers: CORS },
    );
  }
  if (x25519_pubkey.length < 32 || x25519_pubkey.length > 128) {
    return NextResponse.json(
      { ok: false, error: "invalid_pubkey", hint: "base64 of 32-byte X25519 pubkey" },
      { status: 400, headers: CORS },
    );
  }
  if (!ts || !signature) {
    return NextResponse.json(
      { ok: false, error: "missing_signature_or_ts" },
      { status: 400, headers: CORS },
    );
  }

  const message = buildMessageToSign({
    kind: "signa_pubkey_register",
    address,
    x25519_pubkey,
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
  const { data, error: upErr } = await db
    .from("signa_user_pubkeys")
    .upsert(
      {
        address,
        x25519_pubkey,
        ts,
        signature,
        signed_message: message,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "address" },
    )
    .select("address, x25519_pubkey, ts, signature, signed_message, updated_at")
    .single();

  if (upErr) {
    return NextResponse.json(
      { ok: false, error: upErr.message },
      { status: 500, headers: CORS },
    );
  }

  return NextResponse.json({ ok: true, pubkey: data }, { status: 200, headers: CORS });
}
