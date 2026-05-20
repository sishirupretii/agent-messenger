import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/metrics
 *
 * Public real-time inference-throughput dashboard. Aggregates token
 * counts written by /api/agents/[address]/respond on every interaction.
 *
 * Returns:
 *   {
 *     ok: true,
 *     total_tokens: 12345,
 *     interactions_total: 42,
 *     window_1h:  { tokens, interactions, tokens_per_hour },
 *     window_24h: { tokens, interactions, tokens_per_hour },
 *     top_models: [{ model, tokens, interactions }],
 *     top_agents: [{ agent_address, agent_name, tokens, interactions }],
 *     generated_at: "2026-05-20T..."
 *   }
 *
 * The dashboard and CLI poll this every 5-30 seconds. No auth, no
 * rate-limit — pure read of public state.
 *
 * NOTE: only counts interactions ROWS — agent-side LLM calls. We don't
 * yet measure gateway/respond's classifier/synth calls separately, so
 * the number reflects "what agents on this node generated", not "every
 * model call our infra made". v0.15 will widen the surface.
 */
export async function GET() {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // All-time totals — single aggregate query via Supabase rpc would be
  // optimal but for the row counts we have today (10k-ish), a single
  // SELECT with SUM is plenty fast.
  const [
    { data: allRows, error: allErr },
    { data: hourRows, error: hourErr },
    { data: dayRows, error: dayErr },
  ] = await Promise.all([
    supabase
      .from("agent_interactions")
      .select("tokens_in, tokens_out, tokens_total, model, agent_address")
      .limit(10000),
    supabase
      .from("agent_interactions")
      .select("tokens_total")
      .gte("created_at", hourAgo)
      .limit(10000),
    supabase
      .from("agent_interactions")
      .select("tokens_total")
      .gte("created_at", dayAgo)
      .limit(10000),
  ]);

  if (allErr || hourErr || dayErr) {
    return NextResponse.json(
      {
        ok: false,
        error: "metrics_query_failed",
        message: allErr?.message ?? hourErr?.message ?? dayErr?.message,
      },
      { status: 500 },
    );
  }

  // Reduce
  let totalTokens = 0;
  let totalIn = 0;
  let totalOut = 0;
  const byModel = new Map<
    string,
    { tokens: number; interactions: number }
  >();
  const byAgent = new Map<
    string,
    { tokens: number; interactions: number }
  >();
  for (const r of allRows ?? []) {
    const t = r.tokens_total ?? 0;
    totalTokens += t;
    totalIn += r.tokens_in ?? 0;
    totalOut += r.tokens_out ?? 0;
    if (r.model) {
      const cur = byModel.get(r.model) ?? { tokens: 0, interactions: 0 };
      cur.tokens += t;
      cur.interactions += 1;
      byModel.set(r.model, cur);
    }
    if (r.agent_address) {
      const cur = byAgent.get(r.agent_address) ?? {
        tokens: 0,
        interactions: 0,
      };
      cur.tokens += t;
      cur.interactions += 1;
      byAgent.set(r.agent_address, cur);
    }
  }
  const interactionsTotal = (allRows ?? []).length;

  const sumTokens = (rows: { tokens_total?: number | null }[] | null) =>
    (rows ?? []).reduce((a, r) => a + (r.tokens_total ?? 0), 0);

  const tokens1h = sumTokens(hourRows);
  const tokens24h = sumTokens(dayRows);

  // Join agent names for the top-agents list
  const topAgentAddrs = [...byAgent.entries()]
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, 10)
    .map(([addr]) => addr);
  const nameByAddr = new Map<string, string>();
  if (topAgentAddrs.length > 0) {
    const { data: namedAgents } = await supabase
      .from("agents")
      .select("address, name")
      .in("address", topAgentAddrs);
    for (const a of namedAgents ?? []) {
      if (a?.address && a.name) nameByAddr.set(a.address, a.name);
    }
  }

  const topModels = [...byModel.entries()]
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, 6)
    .map(([model, v]) => ({ model, tokens: v.tokens, interactions: v.interactions }));

  const topAgents = topAgentAddrs.map((addr) => ({
    agent_address: addr,
    agent_name: nameByAddr.get(addr) ?? null,
    tokens: byAgent.get(addr)?.tokens ?? 0,
    interactions: byAgent.get(addr)?.interactions ?? 0,
  }));

  return NextResponse.json({
    ok: true,
    total_tokens: totalTokens,
    total_tokens_in: totalIn,
    total_tokens_out: totalOut,
    interactions_total: interactionsTotal,
    window_1h: {
      tokens: tokens1h,
      interactions: (hourRows ?? []).length,
      tokens_per_hour: tokens1h, // already a 1h window
    },
    window_24h: {
      tokens: tokens24h,
      interactions: (dayRows ?? []).length,
      tokens_per_hour: Math.round(tokens24h / 24),
    },
    top_models: topModels,
    top_agents: topAgents,
    generated_at: now.toISOString(),
  });
}
