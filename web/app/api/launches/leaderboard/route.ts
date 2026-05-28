import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/launches/leaderboard?limit=30
 *
 * Bankr-launched token rooms ranked by recent wallet-signed activity.
 * "Activity" = signed message count in the last 7 days. Ties broken
 * by total messages then room creation recency.
 *
 * Read-only, CORS-open. Cached for 60s in-memory.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

type CacheEntry = { ts: number; payload: unknown };
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60 * 1000;

export async function GET(req: NextRequest) {
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 30), 1),
    100,
  );

  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload, { status: 200, headers: CORS });
  }

  // Pull every Bankr-class room (gate_token_address set).
  const { data: rooms } = await supabase
    .from("signa_rooms")
    .select(
      "id, slug, name, description, creator_address, gate_token_address, gate_chain, gate_token_symbol, created_at",
    )
    .not("gate_token_address", "is", null)
    .order("created_at", { ascending: false })
    .limit(300);

  if (!rooms || rooms.length === 0) {
    const payload = {
      ok: true,
      count: 0,
      leaderboard: [],
    };
    cache = { ts: Date.now(), payload };
    return NextResponse.json(payload, { status: 200, headers: CORS });
  }

  // Pull messages for these rooms and aggregate per room.
  const roomIds = rooms.map((r) => r.id);
  const { data: messages } = await supabase
    .from("signa_room_messages")
    .select("room_id, from_address, ts")
    .in("room_id", roomIds)
    .order("ts", { ascending: false })
    .limit(5000);

  const cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const agg = new Map<
    string,
    {
      messages: number;
      messages_7d: number;
      signers: Set<string>;
      last_ts: number;
    }
  >();

  for (const m of messages ?? []) {
    const tsMs = typeof m.ts === "number" ? m.ts : Number(m.ts);
    const cur =
      agg.get(m.room_id) ?? {
        messages: 0,
        messages_7d: 0,
        signers: new Set<string>(),
        last_ts: 0,
      };
    cur.messages += 1;
    if (Number.isFinite(tsMs) && tsMs >= cutoff7d) cur.messages_7d += 1;
    cur.signers.add(String(m.from_address).toLowerCase());
    if (Number.isFinite(tsMs) && tsMs > cur.last_ts) cur.last_ts = tsMs;
    agg.set(m.room_id, cur);
  }

  const leaderboard = rooms
    .map((r) => {
      const a = agg.get(r.id);
      return {
        slug: r.slug,
        name: r.name,
        description: r.description,
        creator_address: r.creator_address,
        gate_token_address: r.gate_token_address,
        gate_token_symbol: r.gate_token_symbol,
        gate_chain: r.gate_chain,
        created_at: r.created_at,
        messages: a?.messages ?? 0,
        messages_7d: a?.messages_7d ?? 0,
        unique_signers: a?.signers.size ?? 0,
        last_activity_ms: a?.last_ts ?? 0,
      };
    })
    .sort((a, b) => {
      if (b.messages_7d !== a.messages_7d) return b.messages_7d - a.messages_7d;
      if (b.messages !== a.messages) return b.messages - a.messages;
      const ta = a.last_activity_ms || Date.parse(a.created_at);
      const tb = b.last_activity_ms || Date.parse(b.created_at);
      return tb - ta;
    })
    .slice(0, limit);

  const payload = {
    ok: true,
    count: leaderboard.length,
    leaderboard,
  };
  cache = { ts: Date.now(), payload };
  return NextResponse.json(payload, { status: 200, headers: CORS });
}
