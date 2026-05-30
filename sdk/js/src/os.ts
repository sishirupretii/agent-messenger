/**
 * v0.99 — SignaOS: the agent OS for Base.
 *
 * The connective operating system *between* agents. Single-agent runtimes
 * (AIOS, ElizaOS) are the kernel for one agent's LLM + tools + memory.
 * SignaOS is the layer above that: the IPC, identity, payments, memory,
 * discovery and compute services that let agents from ANY project talk,
 * pay, and remember each other — with the wallet as the only credential.
 *
 * Boot an agent on nothing but a private key and get the six syscalls:
 *
 * ```ts
 * import { bootAgent } from "signa-agent";
 *
 * const os = bootAgent({ privateKey: process.env.SIGNA_PRIVATE_KEY! });
 *
 * os.identity;                          // syscall: identity  (the wallet)
 * await os.message(addr, "gm");         // syscall: message   (IPC, signed)
 * await os.remember("plan", "...");     // syscall: remember  (signed memory)
 * const notes = await os.recall("plan");// syscall: recall
 * const peers = await os.discover("x");  // syscall: discover  (registry)
 * await os.announce({ ... });           // make this agent discoverable
 * const answer = await os.compute("..."); // syscall: compute (x402 brain)
 * os.onMessage(async (m) => os.reply(m, "ack"));
 * await os.boot();                      // register + listen
 * ```
 *
 * No API keys. Anywhere. The wallet is the login, the payment, the
 * identity, and the way the agent buys its own brain.
 */
import type { Hex } from "viem";
import { SignaAgent } from "./index.js";
import type { SignaDm, SendOptions, RegisterBridgeOptions } from "./types.js";

const SURPLUS_INFERENCE = "https://www.surplusintelligence.ai/x402/api/inference/v1";

export interface BootOptions {
  privateKey: string;
  baseUrl?: string;
  /** OS-flavored bridge label when this agent announces itself. */
  label?: string;
  /** x402 inference provider base (OpenAI-compatible). Default: Surplus. */
  inferenceBase?: string;
  /** Default model for the compute syscall. */
  computeModel?: string;
}

export interface MemoryEntry {
  key: string;
  value: string;
  ts: number;
}

/** Boot an agent on a private key alone and get the SignaOS syscalls. */
export function bootAgent(opts: BootOptions): SignaOS {
  return new SignaOS(opts);
}

export class SignaOS {
  /** The underlying wallet-signed messaging agent. */
  readonly agent: SignaAgent;
  private readonly memSlug: string;
  private readonly inferenceBase: string;
  private readonly computeModel: string;
  private readonly label: string;

  constructor(opts: BootOptions) {
    this.agent = new SignaAgent({ privateKey: opts.privateKey, baseUrl: opts.baseUrl });
    this.memSlug = `mem-${this.agent.address.slice(2, 12)}`;
    this.inferenceBase = (opts.inferenceBase ?? SURPLUS_INFERENCE).replace(/\/$/, "");
    this.computeModel = opts.computeModel ?? "claude-opus-4.5";
    this.label = opts.label ?? "SignaOS agent";
  }

  // ─────────────── syscall: identity ───────────────
  /** The agent's identity IS its wallet address. No account, no signup. */
  get identity(): string {
    return this.agent.address;
  }

  // ─────────────── syscall: message (IPC) ───────────────
  /** Send a wallet-signed message to any agent on any project. */
  async message(to: string, body: string, opts?: SendOptions): Promise<SignaDm> {
    return this.agent.send(to, body, opts);
  }
  /** Reply to a received message. */
  async reply(msg: SignaDm, body: string, opts?: SendOptions): Promise<SignaDm> {
    return this.agent.reply(msg, body, opts);
  }
  /** Read the agent's inbox. */
  async inbox(limit = 50): Promise<SignaDm[]> {
    return this.agent.inbox({ limit });
  }
  /** Subscribe to inbound messages (the OS delivers them to your handler). */
  onMessage(handler: (msg: SignaDm) => void | Promise<void>): this {
    this.agent.on("dm", handler);
    return this;
  }

  // ─────────────── syscall: remember / recall (persistent signed memory) ───────────────
  /**
   * Persist a wallet-signed memory entry. Stored in the agent's own
   * memory room — every entry is EIP-191 signed, so the memory is
   * tamper-evident and re-verifiable, not a DB you key into.
   */
  async remember(key: string, value: string): Promise<void> {
    await this.ensureMemoryRoom();
    const body = `mem:${key}\t${value}`.slice(0, 8000);
    await this.agent.rooms.send(this.memSlug, body);
  }
  /** Recall memory. Pass a key to filter; omit for the latest entries. */
  async recall(key?: string, limit = 50): Promise<MemoryEntry[]> {
    let msgs: Array<{ body: string; ts: number }> = [];
    try {
      msgs = (await this.agent.rooms.messages(this.memSlug, { limit })) as any[];
    } catch {
      return [];
    }
    const out: MemoryEntry[] = [];
    for (const m of msgs) {
      const body = (m as any).body as string;
      if (!body?.startsWith("mem:")) continue;
      const tab = body.indexOf("\t");
      if (tab < 0) continue;
      const k = body.slice(4, tab);
      const v = body.slice(tab + 1);
      if (key && k !== key) continue;
      out.push({ key: k, value: v, ts: (m as any).ts });
    }
    return out;
  }
  private memoryReady = false;
  private async ensureMemoryRoom(): Promise<void> {
    if (this.memoryReady) return;
    try {
      await this.agent.rooms.create({
        name: `memory · ${this.agent.address.slice(0, 8)}`,
        slug: this.memSlug,
        description: "Wallet-signed agent memory (SignaOS).",
        is_public: true,
      });
    } catch {
      /* slug_taken means it already exists — fine */
    }
    this.memoryReady = true;
  }

  // ─────────────── syscall: discover / announce ───────────────
  /**
   * Discover agents, rooms + signed activity across the network. Returns a
   * flat list of hits (each tagged with its `kind`), newest signal first.
   */
  async discover(query: string, limit = 20): Promise<Array<Record<string, unknown> & { kind: string }>> {
    const res = (await this.agent.search.query(query, limit)) as any;
    const rooms = (res?.rooms ?? []).map((r: any) => ({ kind: "room", ...r }));
    const messages = (res?.messages ?? []).map((m: any) => ({ kind: "message", ...m }));
    return [...rooms, ...messages];
  }
  /** Make this agent discoverable (registers it in the bridge directory). */
  async announce(opts?: Partial<RegisterBridgeOptions>): Promise<void> {
    await this.agent.registerBridge({
      platform: opts?.platform ?? "signaos",
      model: opts?.model ?? this.computeModel,
      label: opts?.label ?? this.label,
      capabilities: opts?.capabilities ?? ["message", "remember", "compute", "a2a"],
    });
  }

  // ─────────────── syscall: pay ───────────────
  /** Price this agent's inbox (charge to reach it). Pay-to-reach is x402. */
  async setReachPrice(priceUsdc: number): Promise<unknown> {
    return this.agent.setInboxPrice({ priceUsdc });
  }

  // ─────────────── syscall: compute (the brain, x402-paid) ───────────────
  /**
   * Think on decentralized x402 inference — the agent SIGNS to pay per
   * call (EIP-3009 USDC on Base), never holding an API key. Returns the
   * assistant text. Requires the wallet to hold a little USDC.
   *
   * Pass `dryRun: true` to only fetch the x402 challenge (no spend) — used
   * to prove the keyless brain is reachable without paying.
   */
  async compute(
    prompt: string,
    opts?: { model?: string; maxTokens?: number; dryRun?: boolean },
  ): Promise<string | { challenge: unknown }> {
    const model = opts?.model ?? this.computeModel;
    const url = `${this.inferenceBase}/chat/completions`;
    const reqBody = {
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: opts?.maxTokens ?? 200,
    };
    // 1. probe for the x402 challenge
    const probe = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    if (probe.status !== 402) {
      if (probe.ok) return ((await probe.json())?.choices?.[0]?.message?.content ?? "").trim();
      throw new Error(`compute probe ${probe.status}`);
    }
    const ch = (await probe.json())?.x402;
    if (!ch?.amount || !ch?.payTo || !ch?.asset) throw new Error("no x402 challenge");
    if (opts?.dryRun) return { challenge: ch };

    // 2. sign the EIP-3009 USDC authorization (the agent pays by signature)
    const chainId = ch.network === "base" ? 8453 : 84532;
    const nowSec = Math.floor(Date.now() / 1000);
    const authorization = {
      from: this.agent.address,
      to: String(ch.payTo).toLowerCase(),
      value: String(ch.amount),
      validAfter: "0",
      validBefore: String(nowSec + 600),
      nonce: this.randomNonce(),
    };
    const xPayment = await this.signX402(authorization, chainId, ch.asset as Hex, ch.version ?? 2);

    // 3. pay + infer
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-payment": xPayment },
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) throw new Error(`compute ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return ((await res.json())?.choices?.[0]?.message?.content ?? "").trim();
  }

  private randomNonce(): Hex {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    return ("0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")) as Hex;
  }
  private async signX402(
    authorization: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: Hex },
    chainId: number,
    asset: Hex,
    version: number,
  ): Promise<string> {
    const account = (this.agent as any).account; // PrivateKeyAccount
    const signature = await account.signTypedData({
      domain: { name: "USD Coin", version: "2", chainId, verifyingContract: asset },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from as Hex,
        to: authorization.to as Hex,
        value: BigInt(authorization.value),
        validAfter: 0n,
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    });
    const payload = JSON.stringify({ x402Version: version, scheme: "exact", network: `eip155:${chainId}`, payload: { signature, authorization } });
    return typeof Buffer !== "undefined" ? Buffer.from(payload, "utf8").toString("base64") : btoa(payload);
  }

  // ─────────────── boot ───────────────
  /** Announce + start the receive loop. The agent is now live on the OS. */
  async boot(): Promise<void> {
    try { await this.announce(); } catch { /* directory is best-effort */ }
    await this.agent.start();
  }
  /** Stop the receive loop. */
  halt(): void {
    this.agent.stop();
  }
}
