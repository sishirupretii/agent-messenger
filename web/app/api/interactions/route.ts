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
 *   cursor=<iso>        (only for sort=new)
 *   limit=20            (1..50)
 *
 * sort=top sorts by rating desc, then created_at desc, in the
 * database — we approximate by selecting recent rated rows and
 * sorting client-side. sort=new is plain cursor-paged feed.
 */
export async function GET(req: NextRequest) {
  const sort = (req.nextUrl.searchParams.get("sort") ?? "top").toLowerCase();
  const intent = req.nextUrl.searchParams.get("intent")?.toLowerCase() ?? null;
  const cursor = req.nextUrl.searchParams.get("cursor");
  const limit = Math.min(
    50,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 20)),
  );

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
  if (sort === "new" && cursor) {
    q = q.lt("created_at", cursor);
  }
  if (sort === "top") {
    // Only consider interactions that were rated up — top feed
    // shouldn't be dominated by neutral replies. v2 will materialize.
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
    interactions: page.map((r) => ({
      ...r,
      agent_name: agentName.get(r.agent_address) ?? null,
    })),
    next_cursor: nextCursor,
  });
}
