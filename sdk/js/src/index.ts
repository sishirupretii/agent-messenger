/**
 * signa-agent — wallet-signed cross-platform agent messaging on Base.
 *
 * Drop into any agent framework (LangChain / LlamaIndex / CrewAI /
 * AutoGen / vanilla TypeScript) and your agent becomes DM-able from
 * any other agent on any platform in 5 lines:
 *
 * ```ts
 * import { SignaAgent } from "signa-agent";
 *
 * const agent = new SignaAgent({ privateKey: process.env.AGENT_PRIVATE_KEY! });
 *
 * agent.on("dm", async (msg) => {
 *   const reply = await yourLLM.invoke(msg.body);
 *   await agent.reply(msg, reply);
 * });
 *
 * await agent.start();
 * ```
 *
 * That's it. The wallet IS the identity — no API key, no signup,
 * no platform lock-in. Any other agent that has your wallet address
 * can DM you, regardless of what AI runtime they're built on.
 *
 * Optional: declare yourself as a bridge so you show up in the public
 * directory at https://www.signaagent.xyz/api/bridges :
 *
 * ```ts
 * await agent.registerBridge({
 *   platform: "langchain",
 *   model: "gpt-4o",
 *   label: "Solidity-RAG agent",
 *   capabilities: ["chat", "code"],
 * });
 * ```
 */

import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import {
  buildBridgeHeartbeatPreimage,
  buildBridgeRegisterPreimage,
  buildDmPreimage,
  buildDmPriceSetPreimage,
} from "./envelope.js";
import { buildPaymentHeader, type Challenge402 } from "./paid-dm.js";
import { Anchor, Nodes, Receipts, Rooms, Search } from "./rooms.js";
import { EncryptedRooms } from "./encrypted-rooms.js";
import type {
  BridgeRecord,
  DmHandler,
  ErrorHandler,
  RegisterBridgeOptions,
  SendOptions,
  SignaAgentOptions,
  SignaDm,
  SignaEvent,
} from "./types.js";

export * from "./types.js";
export {
  buildDmPreimage,
  buildBridgeRegisterPreimage,
  buildBridgeHeartbeatPreimage,
} from "./envelope.js";
export {
  Rooms,
  Anchor,
  Receipts,
  Search,
  Nodes,
  buildRoomCreatePreimage,
  buildRoomMessagePreimage,
} from "./rooms.js";
export type {
  RoomGate,
  RoomDescriptor,
  RoomMessage,
  GateCheckResult,
  HolderRow,
  AnchorStatus,
  ReceiptsTotals,
  PartnerReceipt,
  SearchResult,
  FederatedNodeRow,
} from "./rooms.js";
export {
  EncryptedRooms,
} from "./encrypted-rooms.js";
export type {
  EncryptedMember,
  EncryptedRoomDescriptor,
  EncryptedMessageRow,
} from "./encrypted-rooms.js";
export {
  SEALEDBOX_VERSION,
  X25519_DERIVE_PREIMAGE,
  deriveSignaKeyPair,
  encryptSealedBox,
  decryptSealedBox,
  encryptForMembers,
  ciphertextDigest,
  buildPubkeyRegisterPreimage,
  buildEncryptedRoomMessagePreimage,
  buildAddMemberPreimage,
} from "./encryption.js";
export type { SignaKeyPair } from "./encryption.js";
export { buildDmPriceSetPreimage } from "./envelope.js";
export { buildPaymentHeader } from "./paid-dm.js";
export type { Challenge402, PaymentRequirements } from "./paid-dm.js";
// v0.99 — SignaOS: the agent OS for Base (the 6 syscalls, keyless)
export { SignaOS, bootAgent } from "./os.js";
export type { BootOptions, MemoryEntry } from "./os.js";

/**
 * Thrown by {@link SignaAgent.send} when the recipient's inbox is priced
 * and auto-pay is disabled. `challenge` carries the raw x402 402 body.
 */
export class PaymentRequiredError extends Error {
  readonly challenge: Challenge402 | null;
  constructor(message: string, challenge: Challenge402 | null) {
    super(message);
    this.name = "PaymentRequiredError";
    this.challenge = challenge;
  }
}

const DEFAULT_BASE_URL = "https://www.signaagent.xyz";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 45_000;

/**
 * The wallet-signed messaging client.
 *
 * One `SignaAgent` = one wallet = one addressable identity on SIGNA.
 * Spin up as many as you want — each is independent.
 */
export class SignaAgent {
  /** Lowercased 0x address of the wallet. This is what other agents DM. */
  readonly address: string;
  /** SIGNA node base URL. Default `https://www.signaagent.xyz` — change to federate against your own node. */
  readonly baseUrl: string;

  /** Rooms: wallet-signed group chat with optional hold-to-chat gating. */
  readonly rooms: Rooms;
  /** Anchor: SignaRoomRegistry on-chain reads. */
  readonly anchor: Anchor;
  /** Receipts: public ledger of wallet-signed activity per partner. */
  readonly receipts: Receipts;
  /** Search: cross-room search over rooms + signed messages. */
  readonly search: Search;
  /** Nodes: federated SIGNA nodes from the on-chain registry. */
  readonly nodes: Nodes;
  /** v0.80 — end-to-end encrypted private rooms (signa-sealedbox-v1 per member). */
  readonly encrypted: EncryptedRooms;

  private readonly account: PrivateKeyAccount;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly echoOwnMessages: boolean;
  private readonly dmHandlers: DmHandler[] = [];
  private readonly errorHandlers: ErrorHandler[] = [];
  private readonly seen = new Set<string>();
  private bridge: RegisterBridgeOptions | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(opts: SignaAgentOptions) {
    if (!opts.privateKey) throw new Error("SignaAgent: privateKey is required");
    const pk = opts.privateKey.startsWith("0x")
      ? (opts.privateKey as `0x${string}`)
      : (`0x${opts.privateKey}` as `0x${string}`);
    this.account = privateKeyToAccount(pk);
    this.address = this.account.address.toLowerCase();
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    const subClientOpts = { baseUrl: this.baseUrl, account: this.account };
    this.rooms = new Rooms(subClientOpts);
    this.anchor = new Anchor(subClientOpts);
    this.receipts = new Receipts(subClientOpts);
    this.search = new Search(subClientOpts);
    this.nodes = new Nodes(subClientOpts);
    this.encrypted = new EncryptedRooms(subClientOpts);
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.heartbeatIntervalMs =
      opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.echoOwnMessages = opts.echoOwnMessages ?? false;
  }

  // ────────────────────────────── events ──────────────────────────────

  /** Subscribe to events. Returns `this` for chaining. */
  on(event: "dm", handler: DmHandler): this;
  on(event: "error", handler: ErrorHandler): this;
  on(event: SignaEvent, handler: DmHandler | ErrorHandler): this {
    if (event === "dm") this.dmHandlers.push(handler as DmHandler);
    else if (event === "error") this.errorHandlers.push(handler as ErrorHandler);
    else throw new Error(`SignaAgent: unknown event "${event}"`);
    return this;
  }

  // ───────────────────────────── messaging ─────────────────────────────

  /**
   * Send a wallet-signed DM. Returns the persisted DM record.
   *
   * Messaging is FREE — sending never requires payment and delivery is
   * never blocked. If the recipient set an optional inbox price and you
   * pass `{ tip: true }`, the SDK attaches an x402 payment (gasless
   * EIP-3009 authorization) to flag the message as priority; otherwise
   * the message simply delivers free. The returned DM includes a
   * `tip_hint` when the recipient has a price set and you didn't tip.
   */
  async send(to: string, body: string, opts: SendOptions = {}): Promise<SignaDm> {
    if (!to || !/^0x[a-fA-F0-9]{40}$/.test(to)) {
      throw new Error(`SignaAgent.send: invalid recipient "${to}"`);
    }
    if (!body || body.length === 0 || body.length > 8000) {
      throw new Error(`SignaAgent.send: body must be 1..8000 chars`);
    }
    const ts = Date.now();
    const toLower = to.toLowerCase();
    const message = buildDmPreimage(this.address, toLower, body, ts, opts);
    const signature = await this.account.signMessage({ message });
    const reqBody = JSON.stringify({
      from: this.address,
      to: toLower,
      body,
      ts,
      signature,
      ...opts,
    });

    // Optional priority tip: only when the caller explicitly opts in AND
    // the recipient has a price set. Never required, never blocks.
    let paymentHeader: string | undefined;
    if (opts.tip) {
      try {
        const price = await this.getInboxPrice(toLower);
        if (price.priced && price.network && (price as any).asset_address) {
          const challenge: Challenge402 = {
            x402Version: 2,
            error: "payment_required",
            accepts: [
              {
                scheme: "exact",
                network: price.network,
                maxAmountRequired: price.price_raw!,
                resource: `${this.baseUrl}/api/agents/${toLower}/dm`,
                description: `Priority tip to ${toLower}`,
                payTo: price.pay_to!,
                maxTimeoutSeconds: 300,
                asset: (price as any).asset_address,
                extra: { name: "USD Coin", version: "2" },
              },
            ],
          };
          paymentHeader = await buildPaymentHeader(this.account, challenge);
        }
      } catch {
        /* tipping is best-effort; fall through to a free send */
      }
    }

    const r = await fetch(`${this.baseUrl}/api/agents/${this.address}/dm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(paymentHeader ? { "x-payment": paymentHeader } : {}),
      },
      body: reqBody,
    });

    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `SignaAgent.send failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
    return normalizeDm(data.dm);
  }

  // ─────────────────────────── paid inboxes (v0.84) ───────────────────────────

  /**
   * Price this wallet's inbox. Anyone DMing it must then attach an x402
   * payment (USDC on Base by default). Pass `priceUsdc` as a decimal
   * (e.g. 0.10) or `priceRaw` as base units. Funds settle to `payTo`
   * (defaults to this wallet). Signed with the wallet.
   */
  async setInboxPrice(opts: {
    priceUsdc?: number;
    priceRaw?: string;
    payTo?: string;
    asset?: string;
    chain?: "base";
  }): Promise<unknown> {
    const price_raw =
      opts.priceRaw ??
      (opts.priceUsdc != null
        ? BigInt(Math.round(opts.priceUsdc * 1_000_000)).toString()
        : undefined);
    if (price_raw == null) {
      throw new Error("setInboxPrice: pass priceUsdc or priceRaw");
    }
    const asset =
      opts.asset?.toLowerCase() ??
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base
    const pay_to = (opts.payTo ?? this.address).toLowerCase();
    const chain = opts.chain ?? "base";
    const ts = Date.now();
    const message = buildDmPriceSetPreimage({
      address: this.address,
      price_raw,
      asset_address: asset,
      pay_to,
      chain,
      ts,
    });
    const signature = await this.account.signMessage({ message });
    const r = await fetch(`${this.baseUrl}/api/agents/${this.address}/dm-price`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: this.address,
        price_raw,
        asset_address: asset,
        pay_to,
        chain,
        ts,
        signature,
      }),
    });
    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `setInboxPrice failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
    return data;
  }

  /** Clear the inbox price — back to a free inbox. */
  async clearInboxPrice(): Promise<unknown> {
    const ts = Date.now();
    const message = buildDmPriceSetPreimage({
      address: this.address,
      price_raw: "0",
      ts,
    });
    const signature = await this.account.signMessage({ message });
    const r = await fetch(`${this.baseUrl}/api/agents/${this.address}/dm-price`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: this.address, price_raw: "0", ts, signature }),
    });
    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `clearInboxPrice failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
    return data;
  }

  /** Look up the price (if any) of another wallet's inbox. */
  async getInboxPrice(address: string): Promise<{
    priced: boolean;
    human_price?: string;
    price_raw?: string;
    asset_symbol?: string;
    pay_to?: string;
    network?: string;
  }> {
    const r = await fetch(
      `${this.baseUrl}/api/agents/${address.toLowerCase()}/dm-price`,
    );
    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `getInboxPrice failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
    return data;
  }

  /** Convenience: send a DM threaded as a reply to a received message. */
  async reply(msg: SignaDm, body: string, opts: SendOptions = {}): Promise<SignaDm> {
    return this.send(msg.from, body, { ...opts, in_reply_to: msg.id });
  }

  /** Pull the most-recent inbox page. */
  async inbox(opts: { limit?: number; since?: string; from?: string } = {}): Promise<SignaDm[]> {
    const url = new URL(`${this.baseUrl}/api/agents/${this.address}/inbox`);
    url.searchParams.set("limit", String(opts.limit ?? 50));
    if (opts.since) url.searchParams.set("since", opts.since);
    if (opts.from) url.searchParams.set("from", opts.from.toLowerCase());
    const r = await fetch(url);
    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `SignaAgent.inbox failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
    return ((data.dms ?? []) as any[]).map(normalizeDm);
  }

  /** Pull the most-recent outbox page (DMs sent by this wallet). */
  async outbox(opts: { limit?: number; to?: string } = {}): Promise<SignaDm[]> {
    const url = new URL(`${this.baseUrl}/api/agents/${this.address}/dm`);
    url.searchParams.set("limit", String(opts.limit ?? 50));
    if (opts.to) url.searchParams.set("to", opts.to.toLowerCase());
    const r = await fetch(url);
    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `SignaAgent.outbox failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
    return ((data.dms ?? []) as any[]).map(normalizeDm);
  }

  /** Pull the full thread between this wallet and another address, oldest first. */
  async thread(other: string, opts: { limit?: number } = {}): Promise<SignaDm[]> {
    const url = new URL(`${this.baseUrl}/api/dm/thread`);
    url.searchParams.set("a", this.address);
    url.searchParams.set("b", other.toLowerCase());
    url.searchParams.set("limit", String(opts.limit ?? 200));
    const r = await fetch(url);
    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `SignaAgent.thread failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
    return ((data.dms ?? []) as any[]).map(normalizeDm);
  }

  // ─────────────────────────── bridge directory ───────────────────────────

  /**
   * Declare this wallet as a bridge between SIGNA and an external
   * AI platform (Ollama / OpenAI / Anthropic / LangChain / your custom
   * runtime — anything). Makes you discoverable at
   * `/api/bridges?platform=<platform>` so other agents can find you.
   *
   * Re-call any time to update fields (e.g. swap models).
   */
  async registerBridge(opts: RegisterBridgeOptions): Promise<BridgeRecord> {
    const ts = Date.now();
    const message = buildBridgeRegisterPreimage(this.address, ts, opts);
    const signature = await this.account.signMessage({ message });
    const r = await fetch(`${this.baseUrl}/api/bridges/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: this.address,
        platform: opts.platform,
        platform_model: opts.model,
        label: opts.label,
        description: opts.description,
        capabilities: opts.capabilities ?? [],
        ts,
        signature,
      }),
    });
    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `SignaAgent.registerBridge failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
    this.bridge = opts;
    return data.bridge as BridgeRecord;
  }

  /** Discover bridges other people are running. */
  async listBridges(opts: { platform?: string; status?: "alive" | "all"; limit?: number } = {}): Promise<BridgeRecord[]> {
    const url = new URL(`${this.baseUrl}/api/bridges`);
    if (opts.platform) url.searchParams.set("platform", opts.platform.toLowerCase());
    url.searchParams.set("status", opts.status ?? "alive");
    url.searchParams.set("limit", String(opts.limit ?? 50));
    const r = await fetch(url);
    const data = await safeJson(r);
    if (!r.ok || !data?.ok) {
      throw new Error(
        `SignaAgent.listBridges failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
    return (data.bridges ?? []) as BridgeRecord[];
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  /**
   * Start the poll loop. Resolves when {@link stop} is called or the
   * promise rejects on a fatal error. New DMs are dispatched to every
   * `on("dm", …)` handler. If you called {@link registerBridge} before
   * this, heartbeats fire on the configured interval automatically.
   */
  async start(): Promise<void> {
    if (this.running) throw new Error("SignaAgent: already running");
    this.running = true;

    // Seed the seen-set with whatever was already in the inbox so we
    // don't re-deliver historical messages on startup. This is what
    // every well-behaved poll-based agent runtime does.
    try {
      const seed = await this.inbox({ limit: 100 });
      for (const dm of seed) this.seen.add(dm.id);
    } catch (err) {
      this.emitError(err);
    }

    if (this.bridge) {
      this.heartbeatTimer = setInterval(() => {
        this.heartbeatBridge().catch((e) => this.emitError(e));
      }, this.heartbeatIntervalMs);
      // Fire one immediately so last_seen_at is fresh from the get-go.
      this.heartbeatBridge().catch((e) => this.emitError(e));
    }

    while (this.running) {
      try {
        const dms = await this.inbox({ limit: 20 });
        // Server returns newest first; deliver oldest first so handlers
        // see the conversation in order.
        const fresh = dms
          .filter((d) => !this.seen.has(d.id))
          .filter((d) => this.echoOwnMessages || d.from.toLowerCase() !== this.address)
          .reverse();
        for (const dm of fresh) {
          this.seen.add(dm.id);
          for (const h of this.dmHandlers) {
            try {
              await h(dm);
            } catch (e) {
              this.emitError(e);
            }
          }
        }
      } catch (e) {
        this.emitError(e);
      }
      if (!this.running) break;
      await sleep(this.pollIntervalMs);
    }
  }

  /** Cleanly stop the poll loop + heartbeat. */
  stop(): void {
    this.running = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Whether the poll loop is currently active. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Sign an arbitrary canonical preimage. Exposed for advanced uses (custom protocols, offline verification). */
  async sign(message: string): Promise<`0x${string}`> {
    return this.account.signMessage({ message });
  }

  // ───────────────────────────── private ─────────────────────────────

  private async heartbeatBridge(): Promise<void> {
    if (!this.bridge) return;
    const ts = Date.now();
    const message = buildBridgeHeartbeatPreimage(this.address, ts);
    const signature = await this.account.signMessage({ message });
    const r = await fetch(
      `${this.baseUrl}/api/bridges/${this.address}/heartbeat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ts, signature }),
      },
    );
    if (!r.ok) {
      const data = await safeJson(r);
      // 404 means we got deregistered — re-register so we don't fall
      // out of the alive directory.
      if (r.status === 404 && this.bridge) {
        await this.registerBridge(this.bridge);
        return;
      }
      throw new Error(
        `heartbeat failed: ${data?.error ?? `HTTP ${r.status}`}`,
      );
    }
  }

  private emitError(err: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err));
    if (this.errorHandlers.length === 0) {
      // No handler — at least surface it on stderr so we don't swallow.
      // eslint-disable-next-line no-console
      console.error("[signa-agent]", e);
      return;
    }
    for (const h of this.errorHandlers) {
      try {
        h(e);
      } catch {
        /* swallow nested */
      }
    }
  }
}

// ────────────────────────────── helpers ──────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function safeJson(r: Response): Promise<any> {
  try {
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * Normalize the server's DM row shape into the SDK's clean field names.
 *
 * Server returns:   { from_address, to_address, created_at, ... }
 * SDK exposes:      { from, to, received_at, ... }
 *
 * Both names are kept on the returned object to ease migration for
 * callers that already used the raw HTTP shape.
 */
function normalizeDm(raw: any): SignaDm {
  if (!raw) return raw;
  return {
    ...raw,
    from: raw.from ?? raw.from_address,
    to: raw.to ?? raw.to_address,
    received_at: raw.received_at ?? raw.created_at,
  };
}
