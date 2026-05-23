import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  mirosharkConfigured,
  mirosharkCreateSim,
  mirosharkX402Configured,
  mirosharkRunSimX402,
} from "@/lib/skills/miroshark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[address]/miroshark-fire
 *
 * Public, no-auth endpoint. Any visitor on a SIGNA agent profile can
 * click "Run a sim" and have a real MiroShark swarm-intelligence
 * simulation kicked off against the agent's scenario. Drives traffic +
 * sim volume to MiroShark (partner protocol). The verdict auto-posts
 * back to the SIGNA feed via the existing miroshark webhook handler
 * once MiroShark finishes the run.
 *
 * Body: { scenario: string }
 *
 * Attribution flow:
 *   - We pass agent_address to mirosharkCreateSim so MiroShark can
 *     credit the sim to the SIGNA agent that triggered it.
 *   - We pass agent_did when bound, useful for DID-aware MiroShark.
 *   - The referrer is signaagent.xyz/agent/<address> implicitly via
 *     the user-agent + the agent_address payload field.
 *
 * Rate limit: 5 fires per IP per 10 minutes. In-memory token bucket —
 * cold-start resets are fine for this soft-limit purpose (real abuse
 * would be cheap to scale-out anyway; the rate limit is just polite).
 *
 * 503 if MIROSHARK_BASE_URL not configured. 404 if agent doesn't exist.
 * 429 if rate-limited. 200 with sim_id on success.
 */

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

// IP -> list of fire timestamps within the window. Trimmed lazily.
const rateLimitMap = new Map<string, number[]>();

function ipFrom(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(ip: string): {
  ok: boolean;
  remaining: number;
  retry_after_seconds?: number;
} {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const arr = (rateLimitMap.get(ip) ?? []).filter((t) => t > cutoff);
  if (arr.length >= RATE_LIMIT_MAX) {
    const oldest = arr[0];
    return {
      ok: false,
      remaining: 0,
      retry_after_seconds: Math.max(
        1,
        Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000),
      ),
    };
  }
  arr.push(now);
  rateLimitMap.set(ip, arr);
  return { ok: true, remaining: RATE_LIMIT_MAX - arr.length };
}

const MAX_SCENARIO_LENGTH = 500;
const MIN_SCENARIO_LENGTH = 10;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: addrRaw } = await params;
  const agent = (addrRaw ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(agent)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  // 503 BEFORE we touch the DB or rate limit. No point counting a fire
  // against an IP if no MiroShark path is configured on this node.
  // Two valid paths:
  //   1. x402-paid (v0.24+): MIROSHARK_X402_URL + X402_BUYER_PRIVATE_KEY
  //   2. legacy free: MIROSHARK_BASE_URL + MIROSHARK_API_KEY
  const useX402 = mirosharkX402Configured();
  if (!useX402 && !mirosharkConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "miroshark_not_configured",
        hint: "set X402_BUYER_PRIVATE_KEY (preferred, x402-paid) or MIROSHARK_BASE_URL (legacy) on this SIGNA node.",
      },
      { status: 503 },
    );
  }

  let body: { scenario?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const scenario = (body.scenario ?? "").trim();
  if (scenario.length < MIN_SCENARIO_LENGTH) {
    return NextResponse.json(
      {
        error: `scenario_too_short_min_${MIN_SCENARIO_LENGTH}_chars`,
      },
      { status: 400 },
    );
  }
  if (scenario.length > MAX_SCENARIO_LENGTH) {
    return NextResponse.json(
      { error: `scenario_too_long_max_${MAX_SCENARIO_LENGTH}_chars` },
      { status: 400 },
    );
  }

  // Verify the agent exists. A 404 here means a visitor typed a fake
  // address — we don't want to credit MiroShark with nonsense sims
  // attributed to non-existent SIGNA agents.
  const [{ data: agentRow, error: agentErr }, { data: userRow }] =
    await Promise.all([
      supabase
        .from("agents")
        .select("address, name, deleted_at")
        .eq("address", agent)
        .maybeSingle(),
      // Pull the linked gitlawb DID if any — MiroShark can use it to
      // cross-reference the agent's identity if needed.
      supabase
        .from("users")
        .select("gitlawb_did")
        .eq("address", agent)
        .maybeSingle(),
    ]);
  if (agentErr) {
    return NextResponse.json({ error: agentErr.message }, { status: 500 });
  }
  if (!agentRow || agentRow.deleted_at) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  // Apply the rate limit only AFTER all the cheap rejections. This
  // means a malformed POST doesn't burn the visitor's rate budget.
  const ip = ipFrom(req);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        retry_after_seconds: rl.retry_after_seconds,
        hint: `you can fire up to ${RATE_LIMIT_MAX} sims per ${RATE_LIMIT_WINDOW_MS / 60_000} minutes per IP. try again in ~${rl.retry_after_seconds}s.`,
      },
      {
        status: 429,
        headers: {
          "retry-after": String(rl.retry_after_seconds ?? 60),
        },
      },
    );
  }

  // x402-paid path (v0.24): SIGNA pays $1 USDC per sim from the
  // X402_BUYER_PRIVATE_KEY wallet on Base Sepolia. Returns a wait_url
  // the buyer can watch until the report is ready.
  if (useX402) {
    const x402 = await mirosharkRunSimX402({
      prompt: scenario,
      agentAddress: agent,
      agentDid: userRow?.gitlawb_did ?? undefined,
    });
    if (!x402.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `miroshark_x402_${x402.stage}`,
          message: x402.message,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      agent_address: agent,
      sim_id: x402.run_id,
      status: x402.status,
      preview: null,
      sim_url: x402.wait_url,
      feed_url: `/feed/${agent}`,
      payment: {
        protocol: "x402-v2",
        network: x402.network,
        amount_usdc_base_units: x402.amount_paid,
        tx_hash: x402.payment_tx_hash,
      },
      rate_limit_remaining: rl.remaining,
    });
  }

  // Legacy free path. Falls back to mirosharkCreateSim when the x402
  // env vars aren't set (older deployments).
  let sim: Awaited<ReturnType<typeof mirosharkCreateSim>> = null;
  try {
    sim = await mirosharkCreateSim({
      prompt: scenario,
      agentAddress: agent,
      agentDid: userRow?.gitlawb_did ?? undefined,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "miroshark_create_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
  if (!sim) {
    return NextResponse.json(
      {
        ok: false,
        error: "miroshark_returned_null",
        hint: "MiroShark accepted the request but returned an empty body. check MIROSHARK_BASE_URL + MIROSHARK_API_KEY on this deployment.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    agent_address: agent,
    sim_id: sim.sim_id ?? null,
    status: sim.status ?? "queued",
    preview: sim.preview ?? null,
    sim_url: sim.url ?? null,
    feed_url: `/feed/${agent}`,
    rate_limit_remaining: rl.remaining,
  });
}
