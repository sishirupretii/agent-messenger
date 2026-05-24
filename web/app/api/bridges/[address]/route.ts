import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/bridges/[address]
 *
 * Single bridge record including the canonical signed_message + the
 * registering signature, so any third party can re-verify the wallet
 * declared this bridge themselves (standard SIGNA primitive — server
 * cannot forge what it didn't sign).
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
  const { data, error } = await supabase
    .from("agent_bridges")
    .select(
      "bridge_address, platform, platform_model, label, description, capabilities, registered_at, last_seen_at, deregistered_at, signature, signed_message, ts",
    )
    .eq("bridge_address", addr)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: CORS },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "bridge_not_found" },
      { status: 404, headers: CORS },
    );
  }
  return NextResponse.json(
    { ok: true, bridge: data },
    { status: 200, headers: CORS },
  );
}
