import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign } from "@/lib/feed-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bridges/[address]/heartbeat
 *
 * Wallet-signed liveness ping. Bridges should call this every 30-60s
 * while running so the `?status=alive` filter on /api/bridges keeps
 * them visible. The signature is the only auth.
 *
 * Body: { ts, signature }
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const addr = (raw ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    return NextResponse.json(
      { error: "invalid_address" },
      { status: 400, headers: CORS },
    );
  }

  let body: { ts?: number; signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "bad_json" },
      { status: 400, headers: CORS },
    );
  }
  const ts = Number(body.ts ?? 0);
  const signature = String(body.signature ?? "");

  const message = buildMessageToSign({
    kind: "agent_bridge_heartbeat",
    address: addr,
    ts,
  });
  const verify = await verifySignedMessage({
    expectedAddress: addr,
    message,
    signature,
    ts,
  });
  if (!verify.ok) {
    return NextResponse.json(
      { error: verify.reason },
      { status: 401, headers: CORS },
    );
  }

  const db = serverClient();
  const now = new Date().toISOString();
  const { data, error: upErr } = await db
    .from("agent_bridges")
    .update({ last_seen_at: now, deregistered_at: null })
    .eq("bridge_address", addr)
    .select("bridge_address, last_seen_at")
    .single();
  if (upErr) {
    if (upErr.code === "PGRST116") {
      return NextResponse.json(
        { error: "bridge_not_registered_yet" },
        { status: 404, headers: CORS },
      );
    }
    return NextResponse.json(
      { error: upErr.message },
      { status: 500, headers: CORS },
    );
  }

  return NextResponse.json(
    { ok: true, last_seen_at: data.last_seen_at },
    { status: 200, headers: CORS },
  );
}
