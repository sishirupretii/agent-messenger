/**
 * Signed Holder Velocity (SHV) — the score every Bankr token room
 * is ranked by on Token Wars.
 *
 *   SHV = 100 * unique_signers_7d
 *       +  10 * signed_messages_7d
 *       +   1 * signed_messages_total
 *       + recency_bonus (decays from +50 at 1h to 0 at 7d)
 *
 * Composite is intentionally simple and reproducible — anyone reading
 * the source can recompute it locally from the public message stream.
 * Weights favor unique signers heavily so a single chatty wallet
 * can't shove a token to the top.
 *
 * The "recency_bonus" makes new launches with momentum visible above
 * stale leaders, which is the right product call for a leaderboard
 * everyone wants to climb.
 */
import { supabase } from "./supabase";

export type TokenScore = {
  slug: string;
  name: string;
  description: string | null;
  creator_address: string;
  gate_token_address: string;
  gate_token_symbol: string | null;
  gate_chain: string | null;
  created_at: string;
  // Components
  unique_signers_7d: number;
  signed_messages_7d: number;
  signed_messages_total: number;
  last_message_ms: number | null;
  recency_bonus: number;
  shv: number;
  rank: number;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const RECENCY_MAX = 50;
const RECENCY_HORIZON_MS = SEVEN_DAYS_MS;
const RECENCY_FLOOR_MS = 60 * 60 * 1000; // last hour = full bonus

function recencyBonus(lastMs: number | null): number {
  if (!lastMs) return 0;
  const age = Date.now() - lastMs;
  if (age <= RECENCY_FLOOR_MS) return RECENCY_MAX;
  if (age >= RECENCY_HORIZON_MS) return 0;
  const t = (age - RECENCY_FLOOR_MS) / (RECENCY_HORIZON_MS - RECENCY_FLOOR_MS);
  return Math.round(RECENCY_MAX * (1 - t));
}

type CacheEntry = { ts: number; data: TokenScore[] };
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 30 * 1000;

/**
 * Compute the full Token Wars leaderboard. Sorted by SHV descending.
 * 30-second in-memory cache because the page is the highest-traffic
 * leaderboard surface and the underlying SQL hits the same indexes
 * the chat polling uses.
 */
export async function computeTokenWars(): Promise<TokenScore[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.data;
  }

  const { data: rooms } = await supabase
    .from("signa_rooms")
    .select(
      "id, slug, name, description, creator_address, gate_token_address, gate_chain, gate_token_symbol, created_at",
    )
    .not("gate_token_address", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (!rooms || rooms.length === 0) {
    cache = { ts: Date.now(), data: [] };
    return [];
  }

  const roomIds = rooms.map((r) => r.id);
  const cutoff7d = Date.now() - SEVEN_DAYS_MS;

  const { data: messages } = await supabase
    .from("signa_room_messages")
    .select("room_id, from_address, ts")
    .in("room_id", roomIds)
    .order("ts", { ascending: false })
    .limit(5000);

  type Agg = {
    signers7d: Set<string>;
    messages7d: number;
    messagesTotal: number;
    lastMs: number;
  };
  const agg = new Map<string, Agg>();

  for (const m of messages ?? []) {
    const tsMs = typeof m.ts === "number" ? m.ts : Number(m.ts);
    const cur =
      agg.get(m.room_id) ?? {
        signers7d: new Set<string>(),
        messages7d: 0,
        messagesTotal: 0,
        lastMs: 0,
      };
    cur.messagesTotal += 1;
    if (Number.isFinite(tsMs)) {
      if (tsMs > cur.lastMs) cur.lastMs = tsMs;
      if (tsMs >= cutoff7d) {
        cur.messages7d += 1;
        cur.signers7d.add(String(m.from_address).toLowerCase());
      }
    }
    agg.set(m.room_id, cur);
  }

  const scored: TokenScore[] = rooms.map((r) => {
    const a = agg.get(r.id);
    const signers = a?.signers7d.size ?? 0;
    const msgs7d = a?.messages7d ?? 0;
    const msgsTotal = a?.messagesTotal ?? 0;
    const lastMs = a?.lastMs ?? null;
    const recency = recencyBonus(lastMs);
    const shv = 100 * signers + 10 * msgs7d + msgsTotal + recency;
    return {
      slug: r.slug,
      name: r.name,
      description: r.description,
      creator_address: r.creator_address,
      gate_token_address: r.gate_token_address as string,
      gate_token_symbol: r.gate_token_symbol,
      gate_chain: r.gate_chain,
      created_at: r.created_at,
      unique_signers_7d: signers,
      signed_messages_7d: msgs7d,
      signed_messages_total: msgsTotal,
      last_message_ms: lastMs,
      recency_bonus: recency,
      shv,
      rank: 0,
    };
  });

  scored.sort((a, b) => {
    if (b.shv !== a.shv) return b.shv - a.shv;
    return (b.last_message_ms ?? 0) - (a.last_message_ms ?? 0);
  });
  scored.forEach((s, i) => (s.rank = i + 1));

  cache = { ts: Date.now(), data: scored };
  return scored;
}

export async function findByTokenAddress(
  address: string,
): Promise<TokenScore | null> {
  const all = await computeTokenWars();
  const want = address.toLowerCase();
  return all.find((t) => t.gate_token_address.toLowerCase() === want) ?? null;
}
