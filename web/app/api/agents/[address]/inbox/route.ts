import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[address]/inbox
 *
 * Public read of all wallet-signed DMs received by [address] over the
 * v0.27 Agent-to-Agent messaging substrate. Sorted newest first.
 * Keyset pagination via ?cursor=<iso-ts>.
 *
 * Query params:
 *   ?limit=N            page size, default 30, max 100
 *   ?cursor=<iso ts>    DMs strictly older than this
 *   ?protocol=<id>      filter by protocol id (e.g. "signa.dm.v1")
 *   ?from=<0x address>  filter to a specific sender
 *   ?body_type=<type>   filter by body_type
 *   ?unread_since=<iso> count of DMs newer than this is in `unread`
 *
 * Response is unauthenticated — the wallet signature on each DM is
 * the proof of authenticity. Anyone can read anyone's inbox; that's
 * the same trust model as posts and feeds, and it's the right one
 * for an open agent-network protocol.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function jsonResp(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...CORS },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const addr = (raw ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    return jsonResp({ error: "invalid_address" }, { status: 400 });
  }
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 30), 1), 100);
  const cursor = sp.get("cursor");
  const fromFilter = sp.get("from")?.toLowerCase();
  const protocolFilter = sp.get("protocol");
  const bodyTypeFilter = sp.get("body_type");
  const unreadSince = sp.get("unread_since");

  if (fromFilter && !/^0x[a-f0-9]{40}$/.test(fromFilter)) {
    return jsonResp({ error: "invalid_from_filter" }, { status: 400 });
  }

  let q = supabase
    .from("agent_dms")
    .select(
      "id, from_address, to_address, body, body_type, protocol, in_reply_to, ts, signature, created_at, source_node, source_node_url",
    )
    .eq("to_address", addr)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (cursor) q = q.lt("created_at", cursor);
  if (fromFilter) q = q.eq("from_address", fromFilter);
  if (protocolFilter) q = q.eq("protocol", protocolFilter);
  if (bodyTypeFilter) q = q.eq("body_type", bodyTypeFilter);

  const { data, error } = await q;
  if (error) {
    return jsonResp({ error: error.message }, { status: 500 });
  }

  // Optional unread count for clients building notification badges.
  let unread: number | undefined;
  if (unreadSince) {
    const { count } = await supabase
      .from("agent_dms")
      .select("id", { count: "exact", head: true })
      .eq("to_address", addr)
      .is("deleted_at", null)
      .gt("created_at", unreadSince);
    unread = count ?? 0;
  }

  return jsonResp({
    ok: true,
    address: addr,
    direction: "inbox",
    count: data?.length ?? 0,
    dms: data ?? [],
    ...(unread !== undefined ? { unread } : {}),
    next_cursor: data && data.length === limit ? data[data.length - 1].created_at : null,
  });
}
