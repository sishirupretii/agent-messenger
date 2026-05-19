import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared gateway helpers — used by /api/gateway/* routes.
 *
 * The gateway abstracts "which signa agent should answer this prompt".
 * Devs hitting the gateway don't need to know the address space; they
 * just send a prompt and we route it to the best specialist on the
 * network based on intent + rating signal.
 *
 * Why this lives outside the route file:
 *   - GET /api/gateway needs the same classifier + specialist registry
 *     as POST /api/gateway/respond (they share the schema preview).
 *   - The picker logic is testable in isolation (no Next.js req/res).
 */

export type GatewayIntent =
  | "facts"
  | "swarm"
  | "code"
  | "action"
  | "chat";

const INTENT_TAGS: Record<GatewayIntent, string[]> = {
  // tags an agent might carry that match each intent. Used as an
  // overlap filter against agents.tags.
  facts: ["facts", "markets", "defi", "trading", "bankr", "tokens", "alpha"],
  swarm: [
    "swarm",
    "simulation",
    "miroshark",
    "monte-carlo",
    "research",
  ],
  code: [
    "code",
    "build",
    "gitlawb",
    "playground",
    "dev",
    "scaffold",
  ],
  action: [
    "trade",
    "trading",
    "defi",
    "execution",
    "bankr",
    "transfer",
  ],
  chat: ["chat", "companion", "general", "assistant"],
};

/**
 * Cheap regex-only intent classifier. Same heuristic the /respond
 * router uses internally — keeps the lexical path identical so the
 * gateway's routing decision aligns with what the chosen agent would
 * have classified the prompt as on its own.
 *
 * Order matters: action > swarm > code > facts > chat. That way
 * "buy 100 $USDC" routes to action even though it mentions $TICKER.
 */
export function classifyIntent(message: string): GatewayIntent {
  const m = message.toLowerCase();

  if (
    /\b(buy|sell|swap|trade|long|short|ape\s+(?:into|in)|send\s+\d|transfer\s+\d|bridge|deposit|withdraw)\b/.test(
      m,
    )
  ) {
    return "action";
  }

  if (
    /\b(swarm|simulate|simulation|monte\s+carlo|populate\s+\d|n\s+wallets|agents\s+(?:buying|selling|trading)|model\s+a\s+population)\b/.test(
      m,
    )
  ) {
    return "swarm";
  }

  if (
    /\b(spin\s+me|spin\s+up|build\s+me|build\s+a|build\s+an|scaffold|generate\s+an?\s+(?:html|app|page|dashboard|ui)|make\s+(?:me\s+)?an?\s+(?:html|app|page|dashboard|ui|widget|tool)|playground|gitlawb|code\s+this|html|single[-\s]page|dashboard|widget|render\s+an?\s+(?:app|page))\b/.test(
      m,
    )
  ) {
    return "code";
  }

  if (
    /\b(price|chart|market\s*cap|mcap|volume|fdv|holders|pool|liquidity|tvl|24h|portfolio|balance)\b/.test(
      m,
    ) ||
    /\$[A-Za-z][A-Za-z0-9]{1,9}\b/.test(message) ||
    /0x[a-fA-F0-9]{40}/.test(message)
  ) {
    return "facts";
  }

  return "chat";
}

export type SpecialistCandidate = {
  address: string;
  name: string;
  tags: string[];
  runtime_enabled: boolean;
  net_rating: number;
  /** true when we couldn't tag-match for the intent and fell back to the
   * highest-rated agent on the network regardless of tags. Reported in
   * the gateway response so callers see the routing decision honestly. */
  fallback?: boolean;
};

/**
 * Pick the best specialist agent for an intent.
 *
 * Strategy:
 *   1. Tag-overlap query — only agents whose tags intersect the
 *      intent's hint set.
 *   2. Compute net_rating = sum(rating) from agent_interactions for
 *      each candidate. We pull this in a single grouped query to
 *      avoid N+1.
 *   3. Sort by (custodial first ? 0 : 1, -net_rating, runtime_enabled_at desc)
 *      so runtime-live agents with positive ratings win ties.
 *   4. Return the top result, or null when no specialist exists.
 *
 * Excludes any address in `exclude` so the gateway can refuse to
 * route to a forwarding loop initiator.
 */
export async function pickGatewaySpecialist(
  db: SupabaseClient,
  intent: GatewayIntent,
  exclude: string[] = [],
): Promise<SpecialistCandidate | null> {
  const tags = INTENT_TAGS[intent];
  if (!tags || tags.length === 0) return null;

  // Supabase's chained-builder types recurse too deep for tsc when we
  // conditionally re-assign a typed handle, so we widen the local
  // `query` ref. The actual SQL is still type-checked by the .select()
  // shape at await time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = db
    .from("agents")
    .select("address, name, tags, runtime_enabled, encrypted_key")
    .is("deleted_at", null)
    .not("launched_at", "is", null)
    .overlaps("tags", tags)
    .limit(25);

  const lowered = exclude.map((a) => a.toLowerCase()).filter(Boolean);
  if (lowered.length === 1) {
    query = query.neq("address", lowered[0]);
  } else if (lowered.length > 1) {
    // Supabase supports .not(col, 'in', '(a,b)') for compound exclusion.
    query = query.not("address", "in", `(${lowered.join(",")})`);
  }

  const { data } = (await query) as {
    data:
      | Array<{
          address: string;
          name: string;
          tags: string[] | null;
          runtime_enabled: boolean | null;
          encrypted_key: string | null;
        }>
      | null;
  };
  if (!data || data.length === 0) return null;

  // Pull ratings for ALL candidates in one query. We only need the
  // sum per agent, not every row.
  const addresses = data.map((a) => a.address);
  const { data: ratingsRows } = await db
    .from("agent_interactions")
    .select("agent_address, rating")
    .in("agent_address", addresses)
    .not("rating", "is", null);

  const netRatingByAddr = new Map<string, number>();
  for (const row of ratingsRows ?? []) {
    const k = (row.agent_address ?? "").toLowerCase();
    if (!k) continue;
    const r = Number(row.rating) || 0;
    netRatingByAddr.set(k, (netRatingByAddr.get(k) ?? 0) + r);
  }

  const candidates: SpecialistCandidate[] = data.map((a) => ({
    address: a.address,
    name: a.name,
    tags: (a.tags as string[] | null) ?? [],
    runtime_enabled: !!a.runtime_enabled,
    net_rating: netRatingByAddr.get(a.address.toLowerCase()) ?? 0,
  }));

  candidates.sort((x, y) => {
    // 1) higher net rating first
    if (y.net_rating !== x.net_rating) return y.net_rating - x.net_rating;
    // 2) custodial (runtime-live) before non-custodial — replies will be signed
    if (x.runtime_enabled !== y.runtime_enabled)
      return x.runtime_enabled ? -1 : 1;
    // 3) tighter tag overlap wins (more hint tags matched)
    const xOverlap = x.tags.filter((t) => tags.includes(t.toLowerCase())).length;
    const yOverlap = y.tags.filter((t) => tags.includes(t.toLowerCase())).length;
    return yOverlap - xOverlap;
  });

  return candidates[0];
}

/**
 * Graceful fallback when no agent's tags overlap the intent's hint set.
 * Picks the highest-rated launched agent on the network regardless of
 * tags. This keeps the gateway answering for every prompt even on day-1
 * networks where most agents aren't yet richly tagged.
 *
 * Returned candidate is marked { fallback: true } so the caller's
 * `gateway` attribution block reflects the looser routing decision.
 */
export async function pickAnyAgent(
  db: SupabaseClient,
  exclude: string[] = [],
): Promise<SpecialistCandidate | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = db
    .from("agents")
    .select("address, name, tags, runtime_enabled")
    .is("deleted_at", null)
    .not("launched_at", "is", null)
    .limit(25);

  const lowered = exclude.map((a) => a.toLowerCase()).filter(Boolean);
  if (lowered.length === 1) {
    query = query.neq("address", lowered[0]);
  } else if (lowered.length > 1) {
    query = query.not("address", "in", `(${lowered.join(",")})`);
  }

  const { data } = (await query) as {
    data:
      | Array<{
          address: string;
          name: string;
          tags: string[] | null;
          runtime_enabled: boolean | null;
        }>
      | null;
  };
  if (!data || data.length === 0) return null;

  const addresses = data.map((a) => a.address);
  const { data: ratingsRows } = await db
    .from("agent_interactions")
    .select("agent_address, rating")
    .in("agent_address", addresses)
    .not("rating", "is", null);

  const netRatingByAddr = new Map<string, number>();
  for (const row of ratingsRows ?? []) {
    const k = (row.agent_address ?? "").toLowerCase();
    if (!k) continue;
    netRatingByAddr.set(k, (netRatingByAddr.get(k) ?? 0) + (Number(row.rating) || 0));
  }

  const ranked: SpecialistCandidate[] = data
    .map((a) => ({
      address: a.address,
      name: a.name,
      tags: (a.tags as string[] | null) ?? [],
      runtime_enabled: !!a.runtime_enabled,
      net_rating: netRatingByAddr.get(a.address.toLowerCase()) ?? 0,
      fallback: true,
    }))
    .sort((x, y) => {
      if (y.net_rating !== x.net_rating) return y.net_rating - x.net_rating;
      return x.runtime_enabled === y.runtime_enabled
        ? 0
        : x.runtime_enabled
          ? -1
          : 1;
    });

  return ranked[0] ?? null;
}

/**
 * Best-effort specialist count per intent — used by the GET schema
 * preview so consumers can see how many agents are available to
 * route to for each route in the tree.
 */
export async function specialistRegistry(
  db: SupabaseClient,
): Promise<Record<GatewayIntent, number>> {
  const out: Record<GatewayIntent, number> = {
    facts: 0,
    swarm: 0,
    code: 0,
    action: 0,
    chat: 0,
  };
  const { data } = await db
    .from("agents")
    .select("tags")
    .is("deleted_at", null)
    .not("launched_at", "is", null);
  for (const row of data ?? []) {
    const tags = ((row.tags as string[] | null) ?? []).map((t) =>
      t.toLowerCase(),
    );
    for (const intent of Object.keys(INTENT_TAGS) as GatewayIntent[]) {
      const hints = INTENT_TAGS[intent];
      if (tags.some((t) => hints.includes(t))) out[intent]++;
    }
  }
  return out;
}

export const GATEWAY_LIMITS = {
  MAX_PROMPT_LEN: 1500,
  /** Per-call fetch timeout when the gateway forwards into /respond. */
  FORWARD_TIMEOUT_MS: 25_000,
} as const;
