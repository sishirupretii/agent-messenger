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

// ============================== x402 paid path (v0.24) ==============================

import { x402Pay, x402SignerFromEnv } from "@/lib/x402-client";
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
  let signer;
  try {
    signer = x402SignerFromEnv("X402_BUYER_PRIVATE_KEY");
  } catch (e) {
    return {
      ok: false,
      stage: "bad_signer",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  if (!signer) {
    return {
      ok: false,
      stage: "missing_signer",
      message: "X402_BUYER_PRIVATE_KEY is empty",
    };
  }

  const body: Record<string, unknown> = { prompt: args.prompt };
  // MiroShark accepts agent metadata as part of the body so they can
  // attribute the sim back to a SIGNA agent on their dashboard.
  if (args.agentAddress) body.agent_address = args.agentAddress;
  if (args.agentDid) body.agent_did = args.agentDid;

  const res = await x402Pay({
    url: MIROSHARK_X402_URL,
    body,
    signer,
    // Force EVM eip155 networks only (MiroShark accepts Base Sepolia
    // now, Base mainnet soon — both are eip155 chains).
    preferNetworkPrefix: "eip155:",
  });

  if (!res.ok) {
    return {
      ok: false,
      stage: res.stage,
      message: res.message,
      status: res.status,
    };
  }

  // The server's success body is { success, data: { run_id, wait_url, ... } }
  const data = res.data as { success?: boolean; data?: Record<string, unknown> };
  const inner = data?.data ?? {};
  const run_id = String(inner.run_id ?? "");
  const wait_url = String(inner.wait_url ?? "");
  if (!run_id || !wait_url) {
    return {
      ok: false,
      stage: "bad_response",
      message: `server settled the payment but didn't return run_id / wait_url. body: ${JSON.stringify(data).slice(0, 280)}`,
    };
  }

  return {
    ok: true,
    run_id,
    status: String(inner.status ?? "queued"),
    wait_url,
    status_url: inner.status_url ? String(inner.status_url) : undefined,
    payer: inner.payer ? String(inner.payer) : undefined,
    payment_tx_hash: res.txHash,
    network: res.network,
    amount_paid: res.amount,
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
