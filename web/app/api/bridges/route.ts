import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/bridges
 *
 * Public directory of registered agent platform bridges. Anyone can
 * query this to find out which wallets are forwarding DMs to which
 * AI platforms.
 *
 * Query params:
 *   ?platform=<id>           filter to one platform (ollama, openai, etc.)
 *   ?status=alive|all        default "alive" — only bridges whose
 *                            last_seen_at is within the last 5 min
 *   ?limit=N                 default 50, max 200
 *
 * No auth. CORS-open. The wallet signature on each bridge row is
 * verifiable from /api/bridges/[address].
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

const ALIVE_WINDOW_MS = 5 * 60 * 1000;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const platform = sp.get("platform")?.toLowerCase().trim();
  const status = (sp.get("status") ?? "alive").toLowerCase();
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50), 1), 200);

  let q = supabase
    .from("agent_bridges")
    .select(
      "bridge_address, platform, platform_model, label, description, capabilities, registered_at, last_seen_at",
    )
    .is("deregistered_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (platform) q = q.eq("platform", platform);
  if (status === "alive") {
    const cutoff = new Date(Date.now() - ALIVE_WINDOW_MS).toISOString();
    q = q.gte("last_seen_at", cutoff);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: CORS },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      filter: { platform: platform ?? null, status },
      alive_window_ms: ALIVE_WINDOW_MS,
      count: data?.length ?? 0,
      bridges: data ?? [],
    },
    { status: 200, headers: CORS },
  );
}
