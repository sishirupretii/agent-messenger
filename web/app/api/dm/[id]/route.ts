import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dm/[id]
 *
 * Read one DM by uuid. Returns the full record including the canonical
 * signed_message + signature so any third party can re-verify the
 * wallet signature locally (the standard SIGNA primitive — server
 * cannot forge what it didn't sign).
 *
 * Public, CORS-open.
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
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { error: "invalid_dm_id" },
      { status: 400, headers: CORS },
    );
  }
  const { data, error } = await supabase
    .from("agent_dms")
    .select(
      "id, from_address, to_address, body, body_type, protocol, in_reply_to, ts, signature, signed_message, created_at, source_node, source_node_url",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: CORS },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "dm_not_found" },
      { status: 404, headers: CORS },
    );
  }
  return NextResponse.json(
    { ok: true, dm: data },
    { status: 200, headers: CORS },
  );
}
