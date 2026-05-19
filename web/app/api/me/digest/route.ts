import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign } from "@/lib/feed-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/me/digest — toggle the daily-digest opt-in for a SIGNA user.
 *
 * Body: { address, enabled, ts, signature }
 *   Signature is the wallet's attestation of intent (see
 *   buildMessageToSign({kind:"digest_toggle"})).
 *
 * Idempotent. Toggling on schedules the user for the next /api/cron/digest
 * tick. Toggling off stops future digests; previously-sent digests stay
 * on the feed (they're wallet-signed posts).
 */
export async function POST(req: NextRequest) {
  let body: {
    address?: string;
    enabled?: boolean;
    ts?: number;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const address = (body.address ?? "").toLowerCase();
  const enabled = !!body.enabled;
  const ts = body.ts ?? 0;
  const signature = body.signature ?? "";

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  const message = buildMessageToSign({
    kind: "digest_toggle",
    address,
    enabled,
    ts,
  });
  const verify = await verifySignedMessage({
    expectedAddress: address,
    message,
    signature,
    ts,
  });
  if (!verify.ok) {
    return NextResponse.json({ error: verify.reason }, { status: 401 });
  }

  const db = serverClient();
  // Use upsert so a user who hasn't registered yet still creates a row.
  const { error } = await db.from("users").upsert(
    {
      address,
      daily_digest_enabled: enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "address" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, enabled });
}

/**
 * GET /api/me/digest?address=0x… — read current opt-in state + last_digest_at.
 */
export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "")
    .trim()
    .toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  const db = serverClient();
  const { data } = await db
    .from("users")
    .select("daily_digest_enabled, last_digest_at")
    .eq("address", address)
    .maybeSingle();
  return NextResponse.json({
    ok: true,
    enabled: !!data?.daily_digest_enabled,
    last_digest_at: data?.last_digest_at ?? null,
  });
}
