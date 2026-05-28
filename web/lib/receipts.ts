/**
 * Partner receipts aggregator (v0.52).
 *
 * Computes wallet-signed activity per partner network from the
 * signa_rooms + signa_room_messages tables. Classification mirrors
 * lib/room-badges.ts (which is the public-facing source of truth for
 * "what partner does this room belong to"):
 *
 *   bankr     — gate_token_address set         (Bankr-launched holder rooms)
 *   gitlawb   — slug starts with "b-"          (bounty threads)
 *   miroshark — slug starts with "sim-"        (sim verdict threads)
 *   aeon      — derived later via on-chain     (no rooms yet, kept for shape)
 *   community — everything else                (user-created rooms)
 *
 * Read-only. Cache for 60s in-memory so the public ledger doesn't
 * hammer Postgres.
 */
import { supabase } from "./supabase";

export type PartnerKey =
  | "bankr"
  | "gitlawb"
  | "miroshark"
  | "aeon"
  | "community";

export const PARTNER_LABEL: Record<PartnerKey, string> = {
  bankr: "Bankr",
  gitlawb: "Gitlawb",
  miroshark: "MiroShark",
  aeon: "Aeon",
  community: "Community",
};

export const PARTNER_DESCRIPTION: Record<PartnerKey, string> = {
  bankr:
    "Holder rooms auto-created for every Bankr-launched token on Base. Hold-to-chat enforced via viem balanceOf at the message layer.",
  gitlawb:
    "Bounty threads keyed to gitlawb open tasks. Maintainers and claimants coordinate signed end-to-end.",
  miroshark:
    "Verdict threads opened by the MiroShark webhook the moment a swarm sim finishes. Reads stay open, replies are wallet-signed.",
  aeon:
    "DM threads to ERC-8004 agents registered on the Aeon Identity Registry. Each entry is on-chain on Ethereum mainnet.",
  community:
    "Rooms created by community wallets — open for any topic, every message signed locally with the poster's wallet.",
};

export type PartnerReceipt = {
  partner: PartnerKey;
  label: string;
  description: string;
  rooms: number;
  rooms_7d: number;
  messages: number;
  messages_7d: number;
  unique_posters: number;
  last_activity: string | null;
};

type CacheEntry = { ts: number; data: PartnerReceipt[] };
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60 * 1000;

export async function getPartnerReceipts(): Promise<PartnerReceipt[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.data;
  }

  // One query pulls minimal metadata. We classify in JS to keep the
  // SQL portable + identical to lib/room-badges.ts classification.
  const { data: rooms } = await supabase
    .from("signa_rooms")
    .select("id, slug, gate_token_address, created_at, ts")
    .order("created_at", { ascending: false })
    .limit(2000);

  const roomMap = new Map<
    string,
    { partner: PartnerKey; created_at: string }
  >();
  for (const r of rooms ?? []) {
    const partner = classify(r);
    roomMap.set(r.id, { partner, created_at: r.created_at });
  }

  // Messages — pull recent up to 5000 and aggregate per room.
  const { data: messages } = await supabase
    .from("signa_room_messages")
    .select("id, room_id, from_address, ts, created_at")
    .order("ts", { ascending: false })
    .limit(5000);

  const now = Date.now();
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;

  const agg: Record<
    PartnerKey,
    {
      rooms: Set<string>;
      rooms_7d: Set<string>;
      messages: number;
      messages_7d: number;
      posters: Set<string>;
      last_activity_ms: number;
    }
  > = {
    bankr: blank(),
    gitlawb: blank(),
    miroshark: blank(),
    aeon: blank(),
    community: blank(),
  };

  for (const r of rooms ?? []) {
    const partner = classify(r);
    agg[partner].rooms.add(r.id);
    if (Date.parse(r.created_at) >= cutoff7d) {
      agg[partner].rooms_7d.add(r.id);
    }
  }

  for (const m of messages ?? []) {
    const info = roomMap.get(m.room_id);
    if (!info) continue;
    const tsMs = typeof m.ts === "number" ? m.ts : Number(m.ts);
    const partner = info.partner;
    agg[partner].messages += 1;
    if (Number.isFinite(tsMs) && tsMs >= cutoff7d) agg[partner].messages_7d += 1;
    agg[partner].posters.add(String(m.from_address).toLowerCase());
    if (Number.isFinite(tsMs) && tsMs > agg[partner].last_activity_ms) {
      agg[partner].last_activity_ms = tsMs;
    }
  }

  const result: PartnerReceipt[] = (Object.keys(agg) as PartnerKey[]).map(
    (key) => {
      const a = agg[key];
      return {
        partner: key,
        label: PARTNER_LABEL[key],
        description: PARTNER_DESCRIPTION[key],
        rooms: a.rooms.size,
        rooms_7d: a.rooms_7d.size,
        messages: a.messages,
        messages_7d: a.messages_7d,
        unique_posters: a.posters.size,
        last_activity:
          a.last_activity_ms > 0
            ? new Date(a.last_activity_ms).toISOString()
            : null,
      };
    },
  );

  cache = { ts: Date.now(), data: result };
  return result;
}

function blank() {
  return {
    rooms: new Set<string>(),
    rooms_7d: new Set<string>(),
    messages: 0,
    messages_7d: 0,
    posters: new Set<string>(),
    last_activity_ms: 0,
  };
}

function classify(r: {
  slug: string;
  gate_token_address?: string | null;
}): PartnerKey {
  if (r.gate_token_address) return "bankr";
  const slug = (r.slug ?? "").toLowerCase();
  if (slug.startsWith("b-")) return "gitlawb";
  if (slug.startsWith("sim-")) return "miroshark";
  return "community";
}

export function clearReceiptsCache() {
  cache = null;
}

export type PartnerRoomRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  creator_address: string;
  created_at: string;
  message_count: number;
  last_message_ts: number | null;
};

export type PartnerMessageRow = {
  id: string;
  room_id: string;
  room_slug: string;
  from_address: string;
  body: string;
  ts: number;
  signature: string;
};

export type PartnerDetail = {
  partner: PartnerKey;
  label: string;
  description: string;
  rooms: PartnerRoomRow[];
  recent_messages: PartnerMessageRow[];
  totals: {
    rooms: number;
    messages: number;
    unique_posters: number;
  };
};

const detailCache = new Map<PartnerKey, { ts: number; data: PartnerDetail }>();

/**
 * Per-partner deep view — every room belonging to the partner network
 * plus the most recent signed messages across those rooms. Used by
 * /receipts/[partner] for outreach pages.
 */
export async function getPartnerDetail(
  partner: PartnerKey,
): Promise<PartnerDetail> {
  const cached = detailCache.get(partner);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  // Pull all rooms; classification matches the public badge logic.
  const { data: rawRooms } = await supabase
    .from("signa_rooms")
    .select(
      "id, slug, name, description, creator_address, gate_token_address, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  const myRooms = (rawRooms ?? []).filter((r) => classify(r) === partner);
  const roomIds = myRooms.map((r) => r.id);
  const slugById = new Map(myRooms.map((r) => [r.id, r.slug]));

  if (roomIds.length === 0) {
    const empty: PartnerDetail = {
      partner,
      label: PARTNER_LABEL[partner],
      description: PARTNER_DESCRIPTION[partner],
      rooms: [],
      recent_messages: [],
      totals: { rooms: 0, messages: 0, unique_posters: 0 },
    };
    detailCache.set(partner, { ts: Date.now(), data: empty });
    return empty;
  }

  const { data: rawMessages } = await supabase
    .from("signa_room_messages")
    .select("id, room_id, from_address, body, ts, signature")
    .in("room_id", roomIds)
    .order("ts", { ascending: false })
    .limit(500);

  // Aggregate per room
  const perRoom = new Map<
    string,
    { count: number; lastTs: number | null }
  >();
  const posters = new Set<string>();
  for (const m of rawMessages ?? []) {
    const tsMs = typeof m.ts === "number" ? m.ts : Number(m.ts);
    const cur = perRoom.get(m.room_id) ?? { count: 0, lastTs: null };
    cur.count += 1;
    if (Number.isFinite(tsMs)) {
      cur.lastTs = cur.lastTs === null ? tsMs : Math.max(cur.lastTs, tsMs);
    }
    perRoom.set(m.room_id, cur);
    posters.add(String(m.from_address).toLowerCase());
  }

  const rooms: PartnerRoomRow[] = myRooms.map((r) => {
    const agg = perRoom.get(r.id) ?? { count: 0, lastTs: null };
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      creator_address: r.creator_address,
      created_at: r.created_at,
      message_count: agg.count,
      last_message_ts: agg.lastTs,
    };
  });
  // Sort rooms by latest message activity desc, falling back to created_at.
  rooms.sort((a, b) => {
    const tA = a.last_message_ts ?? Date.parse(a.created_at);
    const tB = b.last_message_ts ?? Date.parse(b.created_at);
    return tB - tA;
  });

  const recent_messages: PartnerMessageRow[] = (rawMessages ?? [])
    .slice(0, 30)
    .map((m) => ({
      id: m.id,
      room_id: m.room_id,
      room_slug: slugById.get(m.room_id) ?? "",
      from_address: m.from_address,
      body: m.body,
      ts: typeof m.ts === "number" ? m.ts : Number(m.ts),
      signature: m.signature,
    }));

  const data: PartnerDetail = {
    partner,
    label: PARTNER_LABEL[partner],
    description: PARTNER_DESCRIPTION[partner],
    rooms,
    recent_messages,
    totals: {
      rooms: rooms.length,
      messages: rawMessages?.length ?? 0,
      unique_posters: posters.size,
    },
  };
  detailCache.set(partner, { ts: Date.now(), data });
  return data;
}

export function isPartnerKey(s: string): s is PartnerKey {
  return ["bankr", "gitlawb", "miroshark", "aeon", "community"].includes(s);
}
