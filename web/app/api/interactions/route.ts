import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/interactions
 *
 * Public, paged feed of agent_interactions across ALL agents. The
 * "best answers on signa" feed. Used by /replies on the marketing
 * side and by partner dashboards / Discord bots that want the
 * cross-agent signal.
 *
 * Query params:
 *   sort=top|new        (default: top)
 *   intent=facts|swarm|code|action|chat   (optional filter)
 *   sender=0x...        (optional — interactions where the caller was the sender)
 *   agent=0x...         (optional — interactions answered by a specific agent)
 *   cursor=<iso>        (only for sort=new)
 *   limit=20            (1..50)
 *
 * sort=top sorts by rating desc, then created_at desc, in the
 * database — we approximate by selecting recent rated rows and
 * sorting client-side. sort=new is plain cursor-paged feed.
 *
 * sender + agent filters are the inbox primitives — used by the
 * `signa inbox` CLI command to list all interactions a wallet has
 * been involved in.
 */
export async function GET(req: NextRequest) {
  const sort = (req.nextUrl.searchParams.get("sort") ?? "top").toLowerCase();
  const intent = req.nextUrl.searchParams.get("intent")?.toLowerCase() ?? null;
  const senderRaw = req.nextUrl.searchParams.get("sender");
  const agentRaw = req.nextUrl.searchParams.get("agent");
  const cursor = req.nextUrl.searchParams.get("cursor");
  const limit = Math.min(
    50,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 20)),
  );

  // Validate addresses up front — bad input -> 400, not a wide query.
  const sender = senderRaw
    ? /^0x[a-fA-F0-9]{40}$/.test(senderRaw)
      ? senderRaw.toLowerCase()
      : null
    : null;
  const agent = agentRaw
    ? /^0x[a-fA-F0-9]{40}$/.test(agentRaw)
      ? agentRaw.toLowerCase()
      : null
    : null;
  if ((senderRaw && !sender) || (agentRaw && !agent)) {
    return NextResponse.json(
      { ok: false, error: "invalid_address" },
      { status: 400 },
    );
  }

  const db = serverClient();
  let q = db
    .from("agent_interactions")
    .select(
      "id, agent_address, sender_address, message, response, intent, sources, signed, rating, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(sort === "top" ? 200 : limit + 1);

  if (intent) {
    q = q.eq("intent", intent);
  }
  if (sender) {
    q = q.eq("sender_address", sender);
  }
  if (agent) {
    q = q.eq("agent_address", agent);
  }
  if (sort === "new" && cursor) {
    q = q.lt("created_at", cursor);
  }
  if (sort === "top" && !sender && !agent) {
    // Only the network-wide "top" feed is rating-filtered. When the
    // caller pins a sender or agent they're asking "show me my own
    // interactions" — rating doesn't apply there.
    q = q.eq("rating", 1);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let page = data ?? [];
  if (sort === "top") {
    page = page.slice(0, limit);
  }
  const hasMore = sort === "new" && (data?.length ?? 0) > limit;
  const nextCursor =
    sort === "new" && hasMore
      ? page[page.length - 1]?.created_at ?? null
      : null;

  // Join agent names — single batch.
  const agentAddrs = Array.from(new Set(page.map((r) => r.agent_address)));
  const { data: agents } = await db
    .from("agents")
    .select("address, name")
    .in("address", agentAddrs);
  const agentName = new Map<string, string>();
  for (const a of agents ?? []) agentName.set(a.address, a.name);

  return NextResponse.json({
    ok: true,
    sort,
    intent,
    sender,
    agent,
    interactions: page.map((r) => ({
      ...r,
      agent_name: agentName.get(r.agent_address) ?? null,
    })),
    next_cursor: nextCursor,
  });
}
