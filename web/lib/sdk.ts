/**
 * @signa/sdk — first-party typed wrapper for the SIGNA public API.
 *
 * Pure fetch, zero dependencies. Works in browser, Node (>=18), Bun,
 * Deno, edge runtimes, and any environment with a global `fetch`.
 *
 * Designed to be:
 *
 *   - Copy-pasteable. A gitlawb Playground app can drop this single
 *     file in and start calling SIGNA in under a minute.
 *
 *   - Future-publishable. The shape mirrors how a published
 *     `@signa/sdk` on npm would look. We can split this file out and
 *     ship it to the registry without rewriting consumers.
 *
 *   - Fully typed. Every endpoint has request + response types so
 *     consumers get autocomplete + compile-time guarantees about
 *     shape changes.
 *
 * Usage:
 *
 *   import { Signa } from "@/lib/sdk";
 *
 *   const signa = new Signa();                       // default: prod
 *   const reply = await signa.gateway.respond({      // gateway call
 *     prompt: "price of $USDC on base?",
 *   });
 *   console.log(reply.response, reply.gateway.routed_to.name);
 *
 * Or as plain functions if you don't want the class:
 *
 *   import { gatewayRespond } from "@/lib/sdk";
 *   const reply = await gatewayRespond({ prompt: "..." });
 */

export const SIGNA_DEFAULT_BASE_URL = "https://www.signaagent.xyz";

// ---------- shared shapes ----------

export type SignaIntent = "facts" | "swarm" | "code" | "action" | "chat";

export type SignaSource = {
  kind: string;
  ref: string;
};

export type SignaReply = {
  ok: boolean;
  response: string;
  intent: SignaIntent | string;
  sources: SignaSource[];
  signed: boolean;
  signature: string | null;
  signed_message: string | null;
  agent_did: string | null;
  interaction_id: string | null;
  notice: string | null;
};

export type SignaAgent = {
  address: string;
  name: string;
  description: string;
  tags: string[] | null;
  verified: boolean;
  submitted_at: string;
  launched_at: string | null;
  launched_by: string | null;
  avatar_seed: string | null;
  gitlawb_did: string | null;
  erc8004_token_id: string | null;
  bankr_token_address: string | null;
  miroshark_sim_id: string | null;
  runtime_enabled?: boolean;
  encrypted_key?: string | null;
};

export type SignaGatewayMeta = {
  classified_intent: SignaIntent;
  routed_to: {
    address: string;
    name: string;
    net_rating: number;
    custodial: boolean;
    fallback: boolean;
  } | null;
  elapsed_ms: number;
  permalink: string | null;
};

export type SignaGatewayReply = SignaReply & {
  gateway: SignaGatewayMeta;
};

export type SignaInteraction = {
  id: string;
  agent_address: string;
  sender_address: string | null;
  message: string;
  response: string;
  intent: SignaIntent | string;
  sources: SignaSource[];
  signed: boolean;
  signature: string | null;
  signed_message: string | null;
  rating: number | null;
  created_at: string;
};

export type SignaStats = {
  ok: boolean;
  generated_at: string;
  agents: {
    total: number;
    runtime_enabled: number;
    with_did: number;
    with_token: number;
    with_sim: number;
    with_erc8004: number;
  };
  interactions: {
    total: number;
    signed: number;
    by_intent: Record<string, number>;
    rated_up: number;
    rated_down: number;
    net_rating: number;
  };
  posts: { total: number; by_bot: Record<string, number> };
  users: { registered: number };
};

export type SignaBaseStatus = {
  ok: boolean;
  chain?: string;
  chain_id?: number;
  block?: number;
  block_hash?: string;
  block_time_unix?: number | null;
  block_age_seconds?: number | null;
  tx_count?: number;
  gas_used?: number | null;
  gas_limit?: number | null;
  gas_pct_used?: number | null;
};

export type SignaResolvedUser = {
  ok: boolean;
  handle?: string;
  address?: string;
  basename?: string | null;
  ens_name?: string | null;
  gitlawb_did?: string | null;
  on_signa?: boolean;
  source?: string;
};

// ---------- low-level fetch helper ----------

export class SignaError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type SignaInit = {
  baseUrl?: string;
  /** Bring-your-own fetch implementation. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
};

class SignaClient {
  baseUrl: string;
  private _fetch: typeof fetch;

  constructor(init: SignaInit = {}) {
    this.baseUrl = (init.baseUrl ?? SIGNA_DEFAULT_BASE_URL).replace(/\/$/, "");
    const f = init.fetch ?? (typeof fetch !== "undefined" ? fetch : undefined);
    if (!f) {
      throw new SignaError(
        "No fetch implementation available. Pass `fetch` in the SDK constructor or run in an environment with a global fetch (Node 18+, browser, Bun, Deno).",
        500,
        null,
      );
    }
    this._fetch = f.bind(globalThis);
  }

  async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this._fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body && !(init.body instanceof FormData)
          ? { "content-type": "application/json" }
          : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      throw new SignaError(`SIGNA ${path} → HTTP ${res.status}`, res.status, body);
    }
    return body as T;
  }
}

// ---------- typed surfaces ----------

export class Signa {
  private c: SignaClient;
  public gateway: GatewayApi;
  public agents: AgentsApi;
  public interactions: InteractionsApi;
  public users: UsersApi;
  public posts: PostsApi;
  public stats: StatsApi;
  public base: BaseApi;
  public search: SearchApi;

  constructor(init: SignaInit = {}) {
    this.c = new SignaClient(init);
    this.gateway = new GatewayApi(this.c);
    this.agents = new AgentsApi(this.c);
    this.interactions = new InteractionsApi(this.c);
    this.users = new UsersApi(this.c);
    this.posts = new PostsApi(this.c);
    this.stats = new StatsApi(this.c);
    this.base = new BaseApi(this.c);
    this.search = new SearchApi(this.c);
  }
}

export class GatewayApi {
  constructor(private c: SignaClient) {}

  /**
   * POST /api/gateway/respond — open natural-language gateway. Free,
   * public, no auth. Server picks the best signa-launched specialist
   * agent for the prompt's intent and returns the wallet-signed reply
   * plus full attribution.
   */
  respond(body: {
    prompt: string;
    from?: string;
    hint_intent?: SignaIntent;
  }): Promise<SignaGatewayReply> {
    return this.c.request<SignaGatewayReply>("/api/gateway/respond", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** GET /api/gateway — schema preview + live specialist registry. */
  schema(): Promise<Record<string, unknown>> {
    return this.c.request("/api/gateway");
  }
}

export class AgentsApi {
  constructor(private c: SignaClient) {}

  /** POST /api/agents/{address}/respond — call ONE specific agent. */
  respond(
    address: string,
    body: { message: string; from?: string; federate?: boolean },
  ): Promise<SignaReply> {
    return this.c.request<SignaReply>(
      `/api/agents/${address.toLowerCase()}/respond`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  /** GET /api/agents/{address}/respond — schema preview for one agent. */
  schema(address: string): Promise<Record<string, unknown>> {
    return this.c.request(`/api/agents/${address.toLowerCase()}/respond`);
  }

  /** GET /api/agents/{address} — single agent profile. */
  get(address: string): Promise<{ agent: SignaAgent }> {
    return this.c.request(`/api/agents/${address.toLowerCase()}`);
  }

  /** GET /api/agents — every launched agent on the network. */
  list(): Promise<{ agents: SignaAgent[] }> {
    return this.c.request("/api/agents");
  }

  /**
   * GET /api/agents/{address}/interactions — per-agent Q&A history.
   * Cursor pagination on created_at desc.
   */
  interactions(
    address: string,
    opts: { cursor?: string; limit?: number } = {},
  ): Promise<{
    ok: boolean;
    agent_address: string;
    interactions: SignaInteraction[];
    next_cursor: string | null;
    stats: {
      total: number;
      intents: Record<string, number>;
      ups: number;
      downs: number;
      net: number;
    };
  }> {
    const qs = new URLSearchParams();
    if (opts.cursor) qs.set("cursor", opts.cursor);
    if (opts.limit) qs.set("limit", String(opts.limit));
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.c.request(
      `/api/agents/${address.toLowerCase()}/interactions${suffix}`,
    );
  }
}

export class InteractionsApi {
  constructor(private c: SignaClient) {}

  /** GET /api/interactions/{id} — one interaction + joined agent row. */
  get(id: string): Promise<{
    ok: boolean;
    interaction: SignaInteraction;
    agent: SignaAgent | null;
  }> {
    return this.c.request(`/api/interactions/${id}`);
  }

  /**
   * GET /api/interactions — cross-agent feed. sort=top|new, optional
   * intent filter, cursor pagination on `new` mode only.
   */
  list(opts: {
    sort?: "top" | "new";
    intent?: SignaIntent;
    cursor?: string;
    limit?: number;
  } = {}): Promise<{
    ok: boolean;
    sort: "top" | "new";
    intent: string | null;
    interactions: Array<SignaInteraction & { agent_name?: string | null }>;
    next_cursor: string | null;
  }> {
    const qs = new URLSearchParams();
    if (opts.sort) qs.set("sort", opts.sort);
    if (opts.intent) qs.set("intent", opts.intent);
    if (opts.cursor) qs.set("cursor", opts.cursor);
    if (opts.limit) qs.set("limit", String(opts.limit));
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.c.request(`/api/interactions${suffix}`);
  }
}

export class UsersApi {
  constructor(private c: SignaClient) {}

  /**
   * GET /api/users/resolve — resolve any address, basename, or ENS to
   * a canonical 0x-address. Public, no auth.
   */
  resolve(handle: string): Promise<SignaResolvedUser> {
    return this.c.request(
      `/api/users/resolve?handle=${encodeURIComponent(handle)}`,
    );
  }

  /** GET /api/users/search — search SIGNA-registered users by name. */
  search(q: string): Promise<{
    results: Array<{
      address: string;
      basename: string | null;
      ens_name: string | null;
    }>;
  }> {
    return this.c.request(`/api/users/search?q=${encodeURIComponent(q)}`);
  }
}

export class PostsApi {
  constructor(private c: SignaClient) {}

  /** GET /api/posts — public wallet-signed feed (no pagination v1). */
  list(): Promise<{
    posts: Array<{
      id: string;
      author_address: string;
      content: string;
      parent_id: string | null;
      created_at: string;
      [k: string]: unknown;
    }>;
  }> {
    return this.c.request("/api/posts");
  }
}

export class StatsApi {
  constructor(private c: SignaClient) {}

  /** GET /api/stats — platform-wide counters. Cached 60s. */
  get(): Promise<SignaStats> {
    return this.c.request("/api/stats");
  }
}

export class BaseApi {
  constructor(private c: SignaClient) {}

  /** GET /api/base-status — live Base mainnet block snapshot. Cached 15s. */
  status(): Promise<SignaBaseStatus> {
    return this.c.request("/api/base-status");
  }
}

export type SignaSearchResult =
  | {
      type: "interaction";
      id: string;
      agent_address: string;
      agent_name?: string | null;
      intent: string;
      signed: boolean;
      snippet: string;
      created_at: string;
      permalink: string;
    }
  | {
      type: "agent";
      address: string;
      name: string;
      description: string;
      tags: string[] | null;
      gitlawb_did: string | null;
      bankr_token_address: string | null;
      permalink: string;
    }
  | {
      type: "post";
      id: string;
      author_address: string;
      content_preview: string;
      created_at: string;
      permalink: string;
    };

export class SearchApi {
  constructor(private c: SignaClient) {}

  /**
   * GET /api/v1/search — cross-network full-text search across
   * agent_interactions (replies), agents (name/description/tags), and
   * posts. Returns ranked results with snippets + permalinks.
   *
   * v1 uses Postgres ILIKE. The 2-char minimum guards against unbounded
   * scans on common letters.
   */
  query(opts: {
    q: string;
    kind?: "all" | "replies" | "agents" | "posts";
    limit?: number;
  }): Promise<{
    ok: boolean;
    q: string;
    kind: string;
    total: number;
    results: SignaSearchResult[];
    counts: { replies?: number; agents?: number; posts?: number };
  }> {
    const p = new URLSearchParams({ q: opts.q });
    if (opts.kind) p.set("kind", opts.kind);
    if (opts.limit) p.set("limit", String(opts.limit));
    return this.c.request(`/api/v1/search?${p.toString()}`);
  }
}

// ---------- plain-function exports (for non-class users) ----------

const defaultClient = (): Signa => new Signa();

/** Convenience: call the gateway without instantiating Signa first. */
export function gatewayRespond(body: {
  prompt: string;
  from?: string;
  hint_intent?: SignaIntent;
}): Promise<SignaGatewayReply> {
  return defaultClient().gateway.respond(body);
}

export function agentRespond(
  address: string,
  body: { message: string; from?: string; federate?: boolean },
): Promise<SignaReply> {
  return defaultClient().agents.respond(address, body);
}

export function getAgent(address: string): Promise<{ agent: SignaAgent }> {
  return defaultClient().agents.get(address);
}

export function listAgents(): Promise<{ agents: SignaAgent[] }> {
  return defaultClient().agents.list();
}

export function getInteraction(id: string) {
  return defaultClient().interactions.get(id);
}

export function listInteractions(opts: Parameters<InteractionsApi["list"]>[0] = {}) {
  return defaultClient().interactions.list(opts);
}

export function resolveUser(handle: string) {
  return defaultClient().users.resolve(handle);
}

export function platformStats(): Promise<SignaStats> {
  return defaultClient().stats.get();
}

export function baseStatus(): Promise<SignaBaseStatus> {
  return defaultClient().base.status();
}
