import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  gitlawbProfileForDid,
  type GitlawbRepo,
} from "@/lib/skills/gitlawb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[address]/gitlawb-stats
 *
 * Public read. For an agent (or any SIGNA wallet) bound to a gitlawb
 * DID via the link_gitlawb signed envelope, surface their live gitlawb
 * activity by hitting node.gitlawb.com directly.
 *
 * No writes. No credentials. Read-only proxy over the gitlawb skill
 * wrapper — same data that powers the agent profile CODE row.
 *
 * Behavior:
 *   - 400 if address is malformed
 *   - 404 if the wallet has no gitlawb DID bound
 *   - 502 if node.gitlawb.com is unreachable / returns nothing
 *   - 200 otherwise with the aggregated stats
 *
 * Returns:
 *   {
 *     ok: true,
 *     agent_address,
 *     gitlawb_did,
 *     repo_count,         // total repos under this DID
 *     open_tasks,         // open bounty/issue tasks assigned to this DID
 *     recent_commits,     // commits in the last 60 entries across top 3 repos
 *     top_repos: [{       // a few most-recent for direct linking
 *       owner, name, description, updated_at
 *     }],
 *     node_url            // which gitlawb node we queried
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

  // The link_gitlawb signed envelope writes to users.gitlawb_did. Agent
  // launch credits this to the launcher's wallet, but the launchpad
  // copies it onto the agent's own record too. We try both so this
  // works for both user wallets and agent wallets.
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("address, gitlawb_did")
    .eq("address", agent)
    .maybeSingle();
  if (userErr) {
    return NextResponse.json({ error: userErr.message }, { status: 500 });
  }
  const did = userRow?.gitlawb_did ?? null;
  if (!did) {
    return NextResponse.json(
      {
        error: "no_gitlawb_did_bound",
        hint: "this wallet has no gitlawb DID linked. run `signa gitlawb link <did>` to attach one.",
      },
      { status: 404 },
    );
  }

  const profile = await gitlawbProfileForDid(did);
  if (!profile) {
    return NextResponse.json(
      {
        ok: false,
        error: "gitlawb_node_unreachable",
        agent_address: agent,
        gitlawb_did: did,
      },
      { status: 502 },
    );
  }

  const topRepos = profile.repos
    .slice()
    .sort((a: GitlawbRepo, b: GitlawbRepo) => {
      const ta = a.updated_at ?? a.created_at ?? "";
      const tb = b.updated_at ?? b.created_at ?? "";
      return tb.localeCompare(ta);
    })
    .slice(0, 5)
    .map((r) => ({
      owner: r.owner ?? null,
      name: r.name ?? null,
      description: r.description ?? null,
      updated_at: r.updated_at ?? r.created_at ?? null,
    }));

  return NextResponse.json({
    ok: true,
    agent_address: agent,
    gitlawb_did: did,
    repo_count: profile.repos.length,
    open_tasks: profile.open_tasks,
    recent_commits: profile.recent_commits,
    top_repos: topRepos,
    node_url: process.env.GITLAWB_NODE_URL || "https://node.gitlawb.com",
  });
}
