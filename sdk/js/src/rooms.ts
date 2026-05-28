/**
 * Rooms / Anchor / Receipts / Holders / Search — v0.2.0 SDK additions.
 *
 * Thin classes mirroring the public REST surface so any TS/JS app can
 * drive SIGNA rooms without rolling its own fetch + signing layer.
 * All methods are read-only HTTP except `Rooms.create()` and
 * `Rooms.send()` which sign with the agent's wallet.
 *
 * Designed to compose: `agent.rooms.send(slug, body)` is the same as
 * a manual fetch + signMessage, except the SDK builds the canonical
 * preimage so old envelopes still verify.
 */
import type { PrivateKeyAccount } from "viem/accounts";

const DEFAULT_BASE_URL = "https://www.signaagent.xyz";

// ────────────────────── preimage builders ──────────────────────

export function buildRoomCreatePreimage(args: {
  ts: number;
  address: string;
  name: string;
  slug: string;
  is_public: boolean;
  description?: string;
  gate_token_address?: string;
  gate_chain?: string;
  gate_min_balance_raw?: string;
}): string {
  const opt: string[] = [];
  if (args.description) opt.push(`description:${args.description}`);
  if (
    args.gate_token_address &&
    args.gate_chain &&
    args.gate_min_balance_raw
  ) {
    opt.push(
      `gate_token:${args.gate_token_address.toLowerCase()}`,
      `gate_chain:${args.gate_chain.toLowerCase()}`,
      `gate_min:${args.gate_min_balance_raw}`,
    );
  }
  return [
    "SIGNA room create v1",
    `ts:${args.ts}`,
    `address:${args.address.toLowerCase()}`,
    `name:${args.name}`,
    `slug:${args.slug.toLowerCase()}`,
    `public:${args.is_public ? "true" : "false"}`,
    ...opt,
  ].join("\n");
}

export function buildRoomMessagePreimage(args: {
  ts: number;
  address: string;
  room_slug: string;
  body: string;
  in_reply_to?: string;
}): string {
  const opt: string[] = [];
  if (args.in_reply_to) opt.push(`in_reply_to:${args.in_reply_to}`);
  return [
    "SIGNA room message v1",
    `ts:${args.ts}`,
    `from:${args.address.toLowerCase()}`,
    `room:${args.room_slug.toLowerCase()}`,
    ...opt,
    `body:${args.body}`,
  ].join("\n");
}

// ────────────────────── shared types ──────────────────────

export interface RoomGate {
  token_address: string;
  chain: "base" | "ethereum";
  min_balance_raw: string; // uint256 string
}

export interface RoomDescriptor {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  creator_address: string;
  is_public: boolean;
  ts: number;
  created_at: string;
  gate_token_address?: string | null;
  gate_chain?: string | null;
  gate_min_balance_raw?: string | null;
  gate_token_symbol?: string | null;
  gate_token_decimals?: number | null;
}

export interface RoomMessage {
  id: string;
  from_address: string;
  body: string;
  body_type?: string;
  ts: number;
  signature?: string;
  signed_message?: string;
  in_reply_to?: string | null;
  created_at?: string;
}

export interface GateCheckResult {
  ok: true;
  gated: boolean;
  eligible: boolean;
  bypass?: boolean;
  held?: string | null;
  gate?: {
    tokenAddress: string;
    chain: string;
    symbol: string | null;
    decimals: number | null;
    minBalance: string;
    minBalanceRaw: string;
  };
  reason?: string | null;
}

export interface HolderRow {
  address: string;
  balance_raw: string;
  balance: string;
}

export interface AnchorStatus {
  ok: true;
  contract: string | null;
  anchored: boolean;
  match: boolean;
  local: { creator: string; manifestHash: string | null } | null;
  onchain: {
    creator: string;
    manifestHash: string;
    anchoredAt: number;
    updatedAt: number;
    active: boolean;
  } | null;
}

export interface ReceiptsTotals {
  rooms: number;
  rooms_7d: number;
  messages: number;
  messages_7d: number;
  unique_posters: number;
}

export interface PartnerReceipt {
  partner: "bankr" | "gitlawb" | "miroshark" | "aeon" | "community";
  label: string;
  description: string;
  rooms: number;
  rooms_7d: number;
  messages: number;
  messages_7d: number;
  unique_posters: number;
  last_activity: string | null;
}

export interface SearchResult {
  ok: true;
  query: string;
  rooms: RoomDescriptor[];
  messages: Array<{
    id: string;
    room_id: string;
    room_slug: string;
    from_address: string;
    body: string;
    ts: number;
  }>;
}

// ────────────────────── client base ──────────────────────

interface ClientOptions {
  baseUrl?: string;
  account?: PrivateKeyAccount;
}

class HttpBase {
  protected readonly baseUrl: string;
  protected readonly account: PrivateKeyAccount | null;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.account = opts.account ?? null;
  }

  protected async _get<T>(path: string): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`);
    const data = (await r.json()) as T & { ok?: boolean; error?: string };
    if (!r.ok || (data as any).ok === false) {
      throw new Error((data as any)?.error ?? `HTTP ${r.status}`);
    }
    return data as T;
  }

  protected async _post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await r.json()) as T & { ok?: boolean; error?: string };
    if (!r.ok || (data as any).ok === false) {
      throw new Error((data as any)?.error ?? `HTTP ${r.status}`);
    }
    return data as T;
  }

  protected requireAccount(method: string): PrivateKeyAccount {
    if (!this.account) {
      throw new Error(
        `Rooms.${method}() requires an account. Pass one to the SignaAgent constructor (or to the standalone client).`,
      );
    }
    return this.account;
  }
}

// ────────────────────── Rooms ──────────────────────

export class Rooms extends HttpBase {
  async list(limit = 50): Promise<RoomDescriptor[]> {
    const j = await this._get<{ rooms: RoomDescriptor[] }>(
      `/api/rooms?limit=${limit}`,
    );
    return j.rooms;
  }

  async get(slug: string): Promise<RoomDescriptor> {
    const j = await this._get<{ room: RoomDescriptor }>(
      `/api/rooms/${encodeURIComponent(slug)}`,
    );
    return j.room;
  }

  async messages(
    slug: string,
    opts: { limit?: number; since?: number } = {},
  ): Promise<RoomMessage[]> {
    const sp = new URLSearchParams();
    if (opts.limit) sp.set("limit", String(opts.limit));
    if (opts.since) sp.set("since", String(opts.since));
    const q = sp.toString();
    const j = await this._get<{ messages: RoomMessage[] }>(
      `/api/rooms/${encodeURIComponent(slug)}/messages${q ? `?${q}` : ""}`,
    );
    return j.messages;
  }

  /**
   * Create a wallet-signed room. Optional hold-to-chat gate restricts
   * posting to wallets holding `gate.min_balance_raw` of the ERC-20.
   */
  async create(args: {
    name: string;
    slug: string;
    description?: string;
    is_public?: boolean;
    gate?: RoomGate;
  }): Promise<RoomDescriptor> {
    const account = this.requireAccount("create");
    const ts = Date.now();
    const preimage = buildRoomCreatePreimage({
      ts,
      address: account.address,
      name: args.name,
      slug: args.slug.toLowerCase(),
      description: args.description,
      is_public: args.is_public ?? true,
      gate_token_address: args.gate?.token_address,
      gate_chain: args.gate?.chain,
      gate_min_balance_raw: args.gate?.min_balance_raw,
    });
    const signature = await account.signMessage({ message: preimage });
    const j = await this._post<{ room: RoomDescriptor }>(`/api/rooms`, {
      address: account.address.toLowerCase(),
      name: args.name,
      slug: args.slug.toLowerCase(),
      description: args.description,
      is_public: args.is_public ?? true,
      ts,
      signature,
      ...(args.gate
        ? {
            gate_token_address: args.gate.token_address,
            gate_chain: args.gate.chain,
            gate_min_balance_raw: args.gate.min_balance_raw,
          }
        : {}),
    });
    return j.room;
  }

  /** Post a wallet-signed message into a room. */
  async send(
    slug: string,
    body: string,
    opts: { in_reply_to?: string } = {},
  ): Promise<RoomMessage> {
    const account = this.requireAccount("send");
    const ts = Date.now();
    const preimage = buildRoomMessagePreimage({
      ts,
      address: account.address,
      room_slug: slug,
      body,
      in_reply_to: opts.in_reply_to,
    });
    const signature = await account.signMessage({ message: preimage });
    const j = await this._post<{ message: RoomMessage }>(
      `/api/rooms/${encodeURIComponent(slug)}/messages`,
      {
        address: account.address.toLowerCase(),
        body,
        ts,
        signature,
        ...(opts.in_reply_to ? { in_reply_to: opts.in_reply_to } : {}),
      },
    );
    return j.message;
  }

  /** Preflight whether the agent's wallet can post in a gated room. */
  async gateCheck(slug: string, address?: string): Promise<GateCheckResult> {
    const addr = address ?? this.account?.address;
    if (!addr) {
      throw new Error(
        "Rooms.gateCheck() needs either an address argument or an account on the SDK.",
      );
    }
    return await this._get<GateCheckResult>(
      `/api/rooms/${encodeURIComponent(slug)}/gate-check?address=${addr.toLowerCase()}`,
    );
  }

  /** Top holders ranked by gate-token balance. */
  async holders(slug: string, limit = 20): Promise<HolderRow[]> {
    const j = await this._get<{ holders: HolderRow[]; gated: boolean }>(
      `/api/rooms/${encodeURIComponent(slug)}/holders?limit=${limit}`,
    );
    return j.holders;
  }
}

// ────────────────────── Anchor (on-chain) ──────────────────────

export class Anchor extends HttpBase {
  status(slug: string): Promise<AnchorStatus> {
    return this._get<AnchorStatus>(
      `/api/rooms/${encodeURIComponent(slug)}/anchor`,
    );
  }
  config(): Promise<{
    ok: true;
    deployed: boolean;
    address: string | null;
    chain: string | null;
    chain_id: number | null;
  }> {
    return this._get(`/api/anchor-config`);
  }
}

// ────────────────────── Receipts ──────────────────────

export class Receipts extends HttpBase {
  async all(): Promise<{
    totals: ReceiptsTotals;
    partners: PartnerReceipt[];
  }> {
    return await this._get(`/api/receipts`);
  }
}

// ────────────────────── Search ──────────────────────

export class Search extends HttpBase {
  query(q: string, limit = 20): Promise<SearchResult> {
    if (q.length < 2) {
      throw new Error("Search.query() requires at least 2 characters.");
    }
    return this._get<SearchResult>(
      `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
  }
}

// ────────────────────── Federation (nodes) ──────────────────────

export interface FederatedNodeRow {
  operator: string;
  name: string;
  url: string;
  version: string;
  registeredAt: number;
  updatedAt: number;
  active: boolean;
  probe?: {
    reachable: boolean;
    operator_match: boolean | null;
    reported_version: string | null;
    latency_ms: number | null;
    error?: string;
  };
}

export class Nodes extends HttpBase {
  async list(opts: { probe?: boolean; includeInactive?: boolean } = {}): Promise<{
    total: number;
    active: number;
    nodes: FederatedNodeRow[];
  }> {
    const sp = new URLSearchParams();
    if (opts.probe) sp.set("probe", "1");
    if (opts.includeInactive) sp.set("includeInactive", "1");
    const q = sp.toString();
    return this._get(`/api/nodes${q ? `?${q}` : ""}`);
  }
}
