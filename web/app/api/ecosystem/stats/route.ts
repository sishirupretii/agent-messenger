import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getBotAddress } from "@/lib/signa-bots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ecosystem/stats
 *
 * Network-wide partner activity aggregated from wallet-signed posts and
 * the autonomous-task table. Public read. Cheap enough to call from the
 * homepage / launchpad without auth or caching.
 *
 * Source of truth in every case is the federated, wallet-signed feed —
 * which means any SIGNA node anywhere can reproduce these numbers by
 * counting its own copy of the gossiped data.
 *
 * Returns:
 *   {
 *     ok: true,
 *     miroshark: {
 *       sims_fired_total,     // count of agent-authored "fired miroshark sim" posts
 *       verdicts_total,       // count of miroshark.bot.signa-authored posts
 *       active_autonomous,    // open miroshark_sim autonomous tasks across network
 *       bot_configured        // whether the miroshark bot wallet is set on this node
 *     },
 *     gitlawb: {
 *       linked_wallets,       // count of users with gitlawb_did bound
 *       agents_bound,         // count of agents whose users.gitlawb_did is set
 *                              // (same query, framed for UI clarity)
 *     },
 *     generated_at: iso
 *   }
 */
export async function GET() {
  const mirosharkBot = getBotAddress("miroshark");

  const [
    { count: simsFired },
    { count: verdicts },
    { count: activeAutonomous },
    { count: linkedWallets },
  ] = await Promise.all([
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .ilike("content", "fired miroshark sim%"),
    mirosharkBot
      ? supabase
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("author_address", mirosharkBot.toLowerCase())
          .is("deleted_at", null)
      : Promise.resolve({ count: 0 }),
    supabase
      .from("agent_autonomous_tasks")
      .select("id", { count: "exact", head: true })
      .eq("kind", "miroshark_sim")
      .is("cancelled_at", null),
    supabase
      .from("users")
      .select("address", { count: "exact", head: true })
      .not("gitlawb_did", "is", null),
  ]);

  return NextResponse.json({
    ok: true,
    miroshark: {
      sims_fired_total: simsFired ?? 0,
      verdicts_total: verdicts ?? 0,
      active_autonomous: activeAutonomous ?? 0,
      bot_configured: !!mirosharkBot,
    },
    gitlawb: {
      linked_wallets: linkedWallets ?? 0,
      agents_bound: linkedWallets ?? 0,
    },
    generated_at: new Date().toISOString(),
  });
}
