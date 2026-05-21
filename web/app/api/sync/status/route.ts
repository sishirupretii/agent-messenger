import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sync/status
 *
 * Per-peer cross-node sync state for this node. CLI consumes via
 * `signa sync status`. Public read — sync activity is non-sensitive.
 *
 * Returns:
 *   {
 *     ok: true,
 *     peers: [{
 *       operator, node_url, node_name,
 *       last_synced_at, last_success_at, last_post_at,
 *       posts_pulled, errors_total, last_error, last_error_at,
 *       seconds_since_last_sync
 *     }],
 *     imported_total: number,  // count of posts where source_node IS NOT NULL
 *     generated_at: iso
 *   }
 */
export async function GET() {
  const [{ data: peers, error: peersErr }, { count: importedTotal }] =
    await Promise.all([
      supabase
        .from("sync_state")
        .select(
          "operator, node_url, node_name, last_synced_at, last_success_at, last_post_at, posts_pulled, errors_total, last_error, last_error_at",
        )
        .order("last_synced_at", { ascending: false }),
      supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .not("source_node", "is", null),
    ]);

  if (peersErr) {
    return NextResponse.json({ error: peersErr.message }, { status: 500 });
  }

  const now = Date.now();
  const enriched = (peers ?? []).map((p) => ({
    ...p,
    seconds_since_last_sync: p.last_synced_at
      ? Math.floor((now - new Date(p.last_synced_at).getTime()) / 1000)
      : null,
  }));

  return NextResponse.json({
    ok: true,
    peers: enriched,
    imported_total: importedTotal ?? 0,
    generated_at: new Date().toISOString(),
  });
}
