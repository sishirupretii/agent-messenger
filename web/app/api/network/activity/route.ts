import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/network/activity?limit=N
 *
 * Public read. Aggregates the live SIGNA network signal — recent DMs,
 * alive bridges, recent bridge registrations — into one polling-friendly
 * response that powers the /live dashboard.
 *
 * Returns:
 *   {
 *     ok: true,
 *     timestamp: "<iso>",
 *     totals: { dms, bridges_alive, bridges_total },
 *     recent_dms: [{ id, from, to, body, ts, signature_prefix, ... }],
 *     recent_bridges: [{ bridge_address, platform, label, registered_at, ... }],
 *   }
 *
 * Bodies are truncated to 240 chars to keep the response small. Signatures
 * are shown as 24-char prefixes — anyone can fetch the full signature
 * via /api/dm/[id] for any DM they want to re-verify.
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
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 20), 1), 100);
  const cutoff = new Date(Date.now() - ALIVE_WINDOW_MS).toISOString();

  // Note: we explicitly fetch a wide page of ids and count its length
  // because Supabase's `head: true` count under anon RLS sometimes returns
  // 0 even when data exists. Length-based counting is robust.
  const [dmsRes, allDms, aliveBridges, allBridges, recentBridges] = await Promise.all([
    supabase
      .from("agent_dms")
      .select("id, from_address, to_address, body, body_type, protocol, ts, signature, created_at")
      .order("ts", { ascending: false })
      .limit(limit),
    supabase.from("agent_dms").select("id").limit(10_000),
    supabase
      .from("agent_bridges")
      .select("id")
      .is("deregistered_at", null)
      .gte("last_seen_at", cutoff)
      .limit(1_000),
    supabase
      .from("agent_bridges")
      .select("id")
      .is("deregistered_at", null)
      .limit(1_000),
    supabase
      .from("agent_bridges")
      .select("bridge_address, platform, platform_model, label, registered_at, last_seen_at")
      .is("deregistered_at", null)
      .order("registered_at", { ascending: false })
      .limit(8),
  ]);

  if (dmsRes.error) {
    return NextResponse.json(
      { ok: false, error: dmsRes.error.message },
      { status: 500, headers: CORS },
    );
  }

  const dms = (dmsRes.data ?? []).map((d) => ({
    id: d.id,
    from: d.from_address,
    to: d.to_address,
    body: typeof d.body === "string" && d.body.length > 240 ? d.body.slice(0, 240) + "…" : d.body,
    body_type: d.body_type ?? "text",
    protocol: d.protocol ?? "signa.dm.v1",
    ts: d.ts,
    received_at: d.created_at,
    signature_prefix: typeof d.signature === "string" ? d.signature.slice(0, 26) + "…" : null,
  }));

  return NextResponse.json(
    {
      ok: true,
      timestamp: new Date().toISOString(),
      alive_window_ms: ALIVE_WINDOW_MS,
      totals: {
        dms: allDms.data?.length ?? 0,
        bridges_alive: aliveBridges.data?.length ?? 0,
        bridges_total: allBridges.data?.length ?? 0,
      },
      recent_dms: dms,
      recent_bridges: recentBridges.data ?? [],
    },
    { status: 200, headers: CORS },
  );
}
