import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/[slug]
 *
 * Return a single room by slug. Public read.
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
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) {
    return NextResponse.json({ ok: false, error: "invalid_slug" }, { status: 400, headers: CORS });
  }

  const { data, error } = await supabase
    .from("signa_rooms")
    .select(
      "id, name, slug, description, creator_address, is_public, ts, created_at, signature, signed_message",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: CORS });
  if (!data) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: CORS });

  return NextResponse.json({ ok: true, room: data }, { status: 200, headers: CORS });
}
