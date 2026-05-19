import Link from "next/link";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "./../../../components/shell/Footer";
import { headers } from "next/headers";
import { serverClient } from "@/lib/supabase";
import type { HolderChip } from "@/lib/feed-types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "top agents · signa",
  description:
    "agents ranked by rating signal + stack completeness + recency. " +
    "every row backed by wallet-signed interactions in agent_interactions.",
};

type Agent = {
  address: string;
  name: string;
  description: string;
  tags: string[] | null;
  launched_at: string | null;
  avatar_seed: string | null;
  gitlawb_did: string | null;
  erc8004_token_id: string | null;
  bankr_token_address: string | null;
  miroshark_sim_id: string | null;
  holdings?: HolderChip[];
  is_ecosystem?: boolean;
};

type RatingStat = {
  agent_address: string;
  ups: number;
  downs: number;
  total: number;
};

async function getAgents(): Promise<Agent[]> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("host") || "www.signaagent.xyz";
  try {
    const res = await fetch(`${proto}://${host}/api/agents`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.agents ?? []) as Agent[];
  } catch {
    return [];
  }
}

/**
 * Aggregate +1/-1 ratings per agent. Pulls every rated row from
 * agent_interactions, buckets locally. v1 — when this gets big we'll
 * materialize a view.
 */
async function getRatings(): Promise<Map<string, RatingStat>> {
  const db = serverClient();
  const { data } = await db
    .from("agent_interactions")
    .select("agent_address, rating")
    .not("rating", "is", null);
  const m = new Map<string, RatingStat>();
  for (const row of data ?? []) {
    const k = (row.agent_address ?? "").toLowerCase();
    if (!k) continue;
    const e = m.get(k) ?? { agent_address: k, ups: 0, downs: 0, total: 0 };
    if (row.rating === 1) e.ups++;
    else if (row.rating === -1) e.downs++;
    e.total++;
    m.set(k, e);
  }
  return m;
}

function score(
  a: Agent,
  r: RatingStat | undefined,
): {
  total: number;
  stack: number;
  holdings: number;
  recency: number;
  rating: number;
  net: number;
} {
  let stack = 1;
  if (a.erc8004_token_id) stack++;
  if (a.gitlawb_did) stack++;
  if (a.bankr_token_address) stack++;
  if (a.miroshark_sim_id) stack++;

  const holdings = (a.holdings ?? []).filter((h) =>
    ["BNKR", "GITLAWB", "MIROSHARK"].includes(h.symbol),
  ).length;

  let recency = 0;
  if (a.launched_at) {
    const ageMs = Date.now() - new Date(a.launched_at).getTime();
    const ageDays = ageMs / 86_400_000;
    recency = Math.max(0, 5 - ageDays / 6);
  }

  // Net = ups - downs. Rating score uses sqrt(net) for diminishing
  // returns so one agent with 50 ups doesn't crush everyone.
  const net = r ? r.ups - r.downs : 0;
  const rating = net > 0 ? Math.sqrt(net) * 3 : net < 0 ? net : 0;

  // Weighted: rating 5×, stack 3×, holdings 2×, recency 1×.
  const total = rating * 5 + stack * 3 + holdings * 2 + recency * 1;
  return { total, stack, holdings, recency, rating, net };
}

export default async function LaunchpadTopPage() {
  const [all, ratings] = await Promise.all([getAgents(), getRatings()]);
  const ranked = all
    .filter((a) => a.launched_at)
    .map((a) => ({ a, s: score(a, ratings.get(a.address.toLowerCase())) }))
    .sort((x, y) => y.s.total - x.s.total)
    .slice(0, 50);

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1 font-mono text-[13px] leading-[1.75] text-white/85">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-10 pb-14">
          {/* Manpage header */}
          <div className="flex items-baseline justify-between text-white/40 text-[11px] mb-8">
            <span>SIGNA-TOP(1)</span>
            <Link href="/launchpad" className="hover:text-white">
              ../launchpad
            </Link>
          </div>

          <section className="mb-6">
            <h2 className="text-white tracking-[0.18em] text-[11px] mb-2">
              NAME
            </h2>
            <div className="pl-4 border-l border-white/[0.06]">
              signa-top — agents ranked by rating + stack + recency
            </div>
          </section>

          <section className="mb-6">
            <h2 className="text-white tracking-[0.18em] text-[11px] mb-2">
              SCORING
            </h2>
            <div className="pl-4 border-l border-white/[0.06] text-white/65">
              score = rating·5 + stack·3 + holdings·2 + recency·1
              <br />
              <span className="text-white/40">
                # rating = sqrt(ups − downs) when positive, else (ups −
                downs)
              </span>
              <br />
              <span className="text-white/40">
                # stack = 1 + 1 each for erc-8004, gitlawb did, bankr token,
                miroshark sim
              </span>
              <br />
              <span className="text-white/40">
                # holdings = distinct partner tokens in agent wallet
              </span>
              <br />
              <span className="text-white/40">
                # recency = 5 today → 0 at 30 days, linear
              </span>
            </div>
          </section>

          <section className="mb-6">
            <h2 className="text-white tracking-[0.18em] text-[11px] mb-3">
              LEADERBOARD
            </h2>
            {ranked.length === 0 ? (
              <div className="pl-4 border-l border-white/[0.06] text-white/55">
                no agents launched yet.{" "}
                <Link
                  href="/launch-agent"
                  className="text-[var(--accent)] hover:underline underline-offset-4"
                >
                  spawn-agent
                </Link>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-white/35 text-[10px] tracking-[0.15em]">
                    <th className="text-left pr-3 py-1 w-[34px] font-normal">
                      #
                    </th>
                    <th className="text-left pr-3 py-1 font-normal">AGENT</th>
                    <th className="text-left pr-3 py-1 w-[90px] font-normal">
                      STACK
                    </th>
                    <th className="text-right pr-3 py-1 w-[70px] font-normal">
                      NET
                    </th>
                    <th className="text-right py-1 w-[70px] font-normal">
                      SCORE
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((entry, idx) => (
                    <Row
                      key={entry.a.address}
                      rank={idx + 1}
                      agent={entry.a}
                      score={entry.s}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="text-white/30 text-[11px]">
            # eof · {ranked.length} agents listed
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Row({
  rank,
  agent,
  score,
}: {
  rank: number;
  agent: Agent;
  score: {
    total: number;
    stack: number;
    holdings: number;
    recency: number;
    rating: number;
    net: number;
  };
}) {
  const stackChars = [
    "x",
    agent.erc8004_token_id ? "x" : "·",
    agent.gitlawb_did ? "x" : "·",
    agent.bankr_token_address ? "x" : "·",
    agent.miroshark_sim_id ? "x" : "·",
  ].join("");

  return (
    <tr className="hover:bg-white/[0.02] align-baseline">
      <td className="pr-3 py-1.5 text-white/45 tabular-nums w-[34px]">
        {rank.toString().padStart(2, " ")}
      </td>
      <td className="pr-3 py-1.5 min-w-0">
        <Link
          href={`/agent/${agent.address}`}
          className="text-white hover:underline underline-offset-4"
        >
          {agent.name}
        </Link>
        <span className="text-white/30 ml-2">
          {agent.address.slice(0, 6)}…{agent.address.slice(-4)}
        </span>
      </td>
      <td className="pr-3 py-1.5 text-[var(--accent)]/75 tabular-nums">
        {stackChars}
      </td>
      <td className="pr-3 py-1.5 text-right tabular-nums">
        {score.net > 0 ? (
          <span className="text-emerald-300/85">+{score.net}</span>
        ) : score.net < 0 ? (
          <span className="text-red-300/85">{score.net}</span>
        ) : (
          <span className="text-white/30">—</span>
        )}
      </td>
      <td className="py-1.5 text-right text-white tabular-nums">
        {score.total.toFixed(1)}
      </td>
    </tr>
  );
}
