import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getBotAddress } from "@/lib/signa-bots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[address]/miroshark-stats
 *
 * Public read. Aggregates the agent's MiroShark activity from two
 * sources, both already wallet-signed and persisted in the SIGNA feed:
 *
 *   1. Agent-authored "fired miroshark sim" posts — the audit trail
 *      written by the cron worker (runMirosharkSimTask) every time an
 *      autonomous task of kind=miroshark_sim ticks.
 *
 *   2. miroshark.bot.signa-authored sim-verdict posts that mention the
 *      agent's address — the verdicts written by the existing
 *      /api/webhooks/miroshark handler when sims complete.
 *
 * No new posts are written here. This is purely a read aggregator over
 * the existing feed — so the data set is the same one cross-node sync
 * already replicates between SIGNA nodes.
 *
 * Returns:
 *   {
 *     ok: true,
 *     agent_address,
 *     sims_fired,           // count of audit posts (sims requested)
 *     sims_completed,       // count of verdict posts from miroshark bot
 *     pending_sims,         // sims_fired - sims_completed (>= 0)
 *     active_tasks,         // count of non-cancelled miroshark_sim tasks
 *     latest_verdict,       // most recent miroshark bot post mentioning agent
 *     latest_fired_at,      // ts of the agent's most recent audit post
 *     miroshark_bot,        // bot wallet address (or null if env not set)
 *   }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: addrRaw } = await params;
  const agent = (addrRaw ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(agent)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  const mirosharkBot = getBotAddress("miroshark");

  // We run these in parallel — they're independent reads.
  const [
    { count: simsFiredCount },
    { data: latestFiredRow },
    verdictRes,
    { count: activeTasksCount },
  ] = await Promise.all([
    // Agent-authored audit posts: content begins with "fired miroshark sim"
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("author_address", agent)
      .is("deleted_at", null)
      .ilike("content", "fired miroshark sim%"),
    supabase
      .from("posts")
      .select("created_at, content")
      .eq("author_address", agent)
      .is("deleted_at", null)
      .ilike("content", "fired miroshark sim%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Verdict posts: authored by the miroshark bot AND mentioning the agent.
    // If the bot wallet isn't configured we just return 0 / null.
    mirosharkBot
      ? supabase
          .from("posts")
          .select("id, content, created_at", { count: "exact" })
          .eq("author_address", mirosharkBot.toLowerCase())
          .is("deleted_at", null)
          .ilike("content", `%${agent}%`)
          .order("created_at", { ascending: false })
          .limit(1)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            content: string;
            created_at: string;
          }>,
          count: 0,
        }),
    // Active (non-cancelled, non-expired) miroshark_sim tasks
    supabase
      .from("agent_autonomous_tasks")
      .select("id", { count: "exact", head: true })
      .eq("agent_address", agent)
      .eq("kind", "miroshark_sim")
      .is("cancelled_at", null),
  ]);

  const simsFired = simsFiredCount ?? 0;
  const simsCompleted =
    "count" in verdictRes && typeof verdictRes.count === "number"
      ? verdictRes.count
      : 0;
  const verdictRows =
    "data" in verdictRes && Array.isArray(verdictRes.data)
      ? verdictRes.data
      : [];
  const latestVerdict = verdictRows[0] ?? null;

  return NextResponse.json({
    ok: true,
    agent_address: agent,
    sims_fired: simsFired,
    sims_completed: simsCompleted,
    pending_sims: Math.max(0, simsFired - simsCompleted),
    active_tasks: activeTasksCount ?? 0,
    latest_verdict: latestVerdict
      ? {
          post_id: latestVerdict.id,
          content: latestVerdict.content,
          created_at: latestVerdict.created_at,
        }
      : null,
    latest_fired_at: latestFiredRow?.created_at ?? null,
    miroshark_bot: mirosharkBot ?? null,
  });
}
