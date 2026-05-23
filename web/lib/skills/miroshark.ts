/**
 * MiroShark skill — swarm-intelligence simulation.
 *
 * MiroShark doesn't have a published BankrBot/skills SKILL.md, but
 * does expose a documented webhook contract at
 * github.com/aaronjmars/MiroShark/blob/main/docs/WEBHOOKS.md.
 *
 * SIGNA's integration is two-way:
 *
 *   1. SIGNA → MiroShark: programmatic sim creation (this file)
 *      Called from /respond's swarm intent when a user asks an agent
 *      to simulate a multi-agent / population scenario. Env-gated on
 *      MIROSHARK_BASE_URL so the call no-ops gracefully when not
 *      configured.
 *
 *   2. MiroShark → SIGNA: completion webhook
 *      Already wired at /api/webhooks/miroshark — every finished sim
 *      auto-posts a wallet-signed verdict to /feed/miroshark authored
 *      by miroshark.bot.signa. HMAC-SHA256 over the raw body.
 *
 * Reference: https://github.com/aaronjmars/MiroShark
 */

const MIROSHARK_BASE = process.env.MIROSHARK_BASE_URL || "";
const MIROSHARK_KEY = process.env.MIROSHARK_API_KEY || "";

// v0.24 — x402-paid path. When MIROSHARK_X402_URL is set + the SIGNA
// node has X402_BUYER_PRIVATE_KEY funded with USDC on the network the
// MiroShark operator requires (Base Sepolia for now, switching to
// mainnet per Aaron's note), every sim is paid $1 USDC end-to-end
// over the x402 v2 protocol. Falls back to the legacy /api/simulation
// /create flow when X402 isn't configured.
const MIROSHARK_X402_URL =
  process.env.MIROSHARK_X402_URL ||
  "https://miroshark-x402-production.up.railway.app/x402/run";

export type MirosharkSim = {
  sim_id?: string;
  scenario?: string;
  status?: "queued" | "running" | "completed" | "failed";
  preview?: string;
  url?: string;
  final_consensus?: {
    bullish?: number;
    neutral?: number;
    bearish?: number;
  };
  resolution_outcome?: "YES" | "NO" | null;
  [k: string]: unknown;
};

export function mirosharkConfigured(): boolean {
  return !!MIROSHARK_BASE;
}

/**
 * POST /api/simulation/create — kick off a new swarm sim. The webhook
 * fires when it completes; we don't poll here. SIGNA's /respond swarm
 * intent calls this then folds the returned sim_id + preview into the
 * tool context the synthesizer sees.
 */
export async function mirosharkCreateSim(args: {
  prompt: string;
  agentAddress?: string;
  agentDid?: string;
}): Promise<MirosharkSim | null> {
  if (!MIROSHARK_BASE) return null;
  try {
    const res = await fetch(
      `${MIROSHARK_BASE.replace(/\/$/, "")}/api/simulation/create`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(MIROSHARK_KEY ? { authorization: `Bearer ${MIROSHARK_KEY}` } : {}),
        },
        body: JSON.stringify({
          prompt: args.prompt,
          agent_address: args.agentAddress,
          agent_did: args.agentDid,
        }),
      },
    );
    if (!res.ok) {
      console.error("[miroshark] create HTTP", res.status);
      return null;
    }
    return (await res.json()) as MirosharkSim;
  } catch (e) {
    console.error(
      "[miroshark] create failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

// ============================== x402 paid path (v0.24 → v0.25) ==============================
//
// v0.25 swap: dropped the hand-rolled x402 client (the wire format I
// reverse-engineered from Aaron's spec doc didn't match the canonical
// x402 v2 envelope — server kept settling 402). Replaced with the
// official @x402/fetch + @x402/evm SDKs. Verified live: $1 USDC tx
// 0x1da62e7cd840563b34b56d22c18b6de8a46d99ff024c85b3b818bcd0e1845e3b
// on Base Sepolia, sim run_83dc4997eebf queued on Aaron's pipeline.

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

/**
 * MiroShark's x402 endpoint returns 202 with a body shaped like:
 *
 *   { success: true,
 *     data: {
 *       run_id:    "run_86ead0ea7fa7",
 *       status:    "queued",
 *       stages:    [...],
 *       wait_url:  "https://miroshark-x402-production.up.railway.app/x402/wait/<run_id>",
 *       status_url:"https://miroshark-x402-production.up.railway.app/api/run/status/<run_id>",
 *       payer:     "0x..." } }
 *
 * `wait_url` is the buyer-facing HTML page that auto-refreshes until the
 * sim finishes; SIGNA shows it back to the visitor so they can watch
 * their paid run progress.
 */
export type MirosharkX402Run = {
  ok: true;
  run_id: string;
  status: string;
  wait_url: string;
  status_url?: string;
  payer?: string;
  /** On-chain USDC settlement tx from the PAYMENT-RESPONSE header. */
  payment_tx_hash: Hex | null;
  network: string;
  amount_paid: string;
};

export type MirosharkX402Error = {
  ok: false;
  stage: string;
  message: string;
  status?: number;
};

export function mirosharkX402Configured(): boolean {
  return !!MIROSHARK_X402_URL && !!process.env.X402_BUYER_PRIVATE_KEY;
}

/**
 * Pay + fire a MiroShark sim via x402 v2.
 *
 * Uses the env-configured X402_BUYER_PRIVATE_KEY as the signer. The
 * signer wallet must hold sufficient USDC on the network the operator
 * specifies (currently Base Sepolia eip155:84532, $1 per sim).
 *
 * Returns the parsed run_id + wait_url plus the settlement tx hash so
 * the caller can:
 *   - link the buyer to their auto-refreshing wait page
 *   - audit the on-chain spend on basescan
 *   - persist last_sim_run_id on the agent_autonomous_tasks row
 *
 * Soft-fails to a structured error on any of: malformed config, 402
 * dance breakage, signature rejection, settle failure, bad response
 * body. The caller decides whether to retry or auto-cancel.
 */
export async function mirosharkRunSimX402(args: {
  prompt: string;
  /** Optional — surfaced on /feed/miroshark when SIGNA echoes the run. */
  agentAddress?: string;
  agentDid?: string;
}): Promise<MirosharkX402Run | MirosharkX402Error> {
  if (!mirosharkX402Configured()) {
    return {
      ok: false,
      stage: "not_configured",
      message:
        "X402_BUYER_PRIVATE_KEY is not set on this SIGNA node. fund a signer wallet with USDC on Base Sepolia and add the key to env.",
    };
  }
  const rawKey = process.env.X402_BUYER_PRIVATE_KEY!;
  const pk = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
    return {
      ok: false,
      stage: "bad_signer",
      message:
        "X402_BUYER_PRIVATE_KEY is set but malformed — expected 0x-prefixed 64-hex-char EVM private key",
    };
  }

  // Build a fresh client + register the wildcard eip155:* exact scheme
  // each call. Per-call construction is cheap and keeps the signer
  // out of any module-level cache (so a key rotation via Vercel env
  // takes effect on the very next cron tick without a cold-start
  // delay).
  let fetchWithPayment: ReturnType<typeof wrapFetchWithPayment>;
  try {
    const signer = privateKeyToAccount(pk as `0x${string}`);
    const client = new x402Client();
    registerExactEvmScheme(client, { signer });
    fetchWithPayment = wrapFetchWithPayment(fetch, client);
  } catch (e) {
    return {
      ok: false,
      stage: "client_setup",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const body: Record<string, unknown> = { prompt: args.prompt };
  if (args.agentAddress) body.agent_address = args.agentAddress;
  if (args.agentDid) body.agent_did = args.agentDid;

  let res: Response;
  try {
    res = await fetchWithPayment(MIROSHARK_X402_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      stage: "fetch_threw",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      // ignore
    }
    return {
      ok: false,
      stage: "settle_rejected",
      status: res.status,
      message: `server rejected the signed payment (HTTP ${res.status}): ${text.slice(0, 280)}`,
    };
  }

  // Decode PAYMENT-RESPONSE for the on-chain settlement tx hash.
  let txHash: Hex | null = null;
  let network = "eip155:84532";
  const respHeader = res.headers.get("payment-response");
  if (respHeader) {
    try {
      const settle = JSON.parse(
        Buffer.from(respHeader, "base64").toString("utf8"),
      ) as { transaction?: Hex; network?: string };
      if (settle.transaction) txHash = settle.transaction;
      if (settle.network) network = settle.network;
    } catch {
      // soft-fail
    }
  }

  let bodyJson: { success?: boolean; data?: Record<string, unknown> };
  try {
    bodyJson = (await res.json()) as typeof bodyJson;
  } catch {
    return {
      ok: false,
      stage: "bad_response",
      message: "settle returned 2xx but body was not valid JSON",
    };
  }
  const inner = bodyJson?.data ?? {};
  const run_id = String(inner.run_id ?? "");
  const wait_url = String(inner.wait_url ?? "");
  if (!run_id || !wait_url) {
    return {
      ok: false,
      stage: "bad_response",
      message: `server settled the payment but didn't return run_id / wait_url. body: ${JSON.stringify(bodyJson).slice(0, 280)}`,
    };
  }

  return {
    ok: true,
    run_id,
    status: String(inner.status ?? "queued"),
    wait_url,
    status_url: inner.status_url ? String(inner.status_url) : undefined,
    payer: inner.payer ? String(inner.payer) : undefined,
    payment_tx_hash: txHash,
    network,
    amount_paid: "1000000", // $1 USDC base units. Server-defined; sourced from PAYMENT-RESPONSE in v0.26.
  };
}

// ============================== legacy receive-side helpers ==============================

/**
 * Format a completed sim for posting to SIGNA's /feed/miroshark bot.
 * The webhook handler at /api/webhooks/miroshark uses this function
 * (re-imported there for clarity) so both the receive path and any
 * future client-side render of a sim share the same formatting.
 */
export function formatMirosharkVerdict(sim: MirosharkSim): string {
  const topic = (sim.scenario ?? "untitled").trim().slice(0, 220);
  const c = sim.final_consensus ?? {};
  const pct = (n: number | undefined): string => {
    if (typeof n !== "number" || !Number.isFinite(n)) return "—";
    const v = n <= 1 ? n * 100 : n;
    return `${Math.round(v)}%`;
  };
  const verdict =
    sim.resolution_outcome === "YES"
      ? "verdict: YES"
      : sim.resolution_outcome === "NO"
        ? "verdict: NO"
        : "verdict: inconclusive";
  const lines = [
    `🦈 swarm verdict on "${topic}"`,
    `${pct(c.bullish)} bullish · ${pct(c.neutral)} neutral · ${pct(c.bearish)} bearish`,
    verdict,
  ];
  if (sim.url) lines.push(`watch: ${sim.url}`);
  return lines.join("\n");
}
