import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dm/thread?a=0x...&b=0x...
 *
 * Return the full DM conversation between two addresses, oldest first,
 * including BOTH directions (a→b and b→a). Convenient for any agent
 * implementation that wants to render a chat-style view between two
 * counterparties without doing two inbox + outbox queries client-side.
 *
 * Query params:
 *   ?a=<0x>             one party
 *   ?b=<0x>             the other party
 *   ?limit=N            max DMs returned (default 200, max 500)
 *   ?since=<iso>        only DMs newer than this
 *
 * Order is independent — pass a + b in any order and you get the same
 * thread back (server sorts low + high before querying the pair index).
 *
 * Public, CORS-open.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const a = (sp.get("a") ?? "").toLowerCase();
  const b = (sp.get("b") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(a) || !/^0x[a-f0-9]{40}$/.test(b)) {
    return NextResponse.json(
      { error: "both_a_and_b_must_be_0x_addresses" },
      { status: 400, headers: CORS },
    );
  }
  if (a === b) {
    return NextResponse.json(
      { error: "a_and_b_must_differ" },
      { status: 400, headers: CORS },
    );
  }
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 200), 1), 500);
  const since = sp.get("since");

  let q = supabase
    .from("agent_dms")
    .select(
      "id, from_address, to_address, body, body_type, protocol, in_reply_to, ts, signature, created_at, source_node, source_node_url",
    )
    .is("deleted_at", null)
    .or(
      `and(from_address.eq.${a},to_address.eq.${b}),and(from_address.eq.${b},to_address.eq.${a})`,
    )
    .order("created_at", { ascending: true })
    .limit(limit);
  if (since) q = q.gt("created_at", since);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: CORS },
    );
  }

  const [low, high] = a < b ? [a, b] : [b, a];
  const thread_id = `${low}_${high}`;

  return NextResponse.json(
    {
      ok: true,
      thread_id,
      participants: [a, b],
      count: data?.length ?? 0,
      dms: data ?? [],
    },
    { status: 200, headers: CORS },
  );
}
