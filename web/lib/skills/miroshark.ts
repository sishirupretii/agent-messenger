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

// v0.26: the server-side x402 paid path (mirosharkRunSimX402 /
// mirosharkX402Configured) was removed when the public "Run a sim"
// button moved to a visitor-pays browser flow. See
// `web/lib/x402-client.ts` for the new path — payment happens in the
// browser with the visitor's wallet, SIGNA never holds a buyer key
// for public sims anymore. The autonomous-cron flow keeps using
// `mirosharkCreateSim` (free, MIROSHARK_API_KEY-authed) above.

// ============================== receive-side helpers ==============================

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
