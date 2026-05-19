import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import {
  classifyIntent,
  pickGatewaySpecialist,
  pickAnyAgent,
  GATEWAY_LIMITS,
  type GatewayIntent,
} from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gateway/respond
 *
 * The SIGNA Open Gateway. Free, public, CORS-open, no-auth.
 *
 * Caller sends a natural-language prompt. We:
 *   1. Classify intent (lexical, deterministic — same heuristic the
 *      agent /respond router uses, so the routing decision aligns with
 *      what the chosen agent would have done on its own).
 *   2. Pick the best specialist agent for that intent — tag-overlap
 *      filter, then sort by net wallet-signed rating, custodial-first,
 *      tighter tag-overlap as tiebreaker.
 *   3. Forward into the chosen agent's POST /respond endpoint.
 *   4. Return the reply + a `gateway` attribution block showing
 *      which agent answered + which routing decision we made.
 *
 * Body:
 *   { prompt: string,  from?: 0x-address,  hint_intent?: GatewayIntent }
 *
 * Caller can pin the intent via `hint_intent` if they already know
 * what they want — useful for Discord/Telegram bots that have their
 * own slash-command structure.
 *
 * Why this exists:
 *   Devs hitting partner APIs today need to know which signa agent
 *   to call. The gateway abstracts agent discovery so a Discord bot
 *   or a gitlawb-playground app can hit ONE endpoint and get the
 *   wallet-signed reply from whichever specialist on the signa
 *   network is best positioned to answer.
 *
 * Loop protection: we set `X-Signa-Gateway: 1` on the forwarded
 * request and refuse to handle inbound requests that already carry
 * the header. Stops a gateway → agent → gateway recursion.
 */

type ForwardJson = {
  ok: boolean;
  response?: string;
  intent?: string;
  sources?: Array<{ kind: string; ref: string }>;
  signed?: boolean;
  signature?: string | null;
  signed_message?: string | null;
  agent_did?: string | null;
  interaction_id?: string | null;
  notice?: string | null;
  error?: string;
  message?: string;
};

export async function POST(req: NextRequest) {
  // ---------- loop guard ----------
  if (req.headers.get("x-signa-gateway") === "1") {
    return NextResponse.json(
      {
        ok: false,
        error: "loop_detected",
        message:
          "/api/gateway/respond refuses to forward when X-Signa-Gateway: 1 is set on the inbound request. Call the target agent's /respond directly instead.",
      },
      { status: 400 },
    );
  }

  // ---------- parse + validate ----------
  let body: {
    prompt?: string;
    from?: string;
    hint_intent?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad_json" },
      { status: 400 },
    );
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json(
      {
        ok: false,
        error: "prompt_required",
        message: `Body must include { "prompt": "..." } — 1 to ${GATEWAY_LIMITS.MAX_PROMPT_LEN} chars.`,
      },
      { status: 400 },
    );
  }
  if (prompt.length > GATEWAY_LIMITS.MAX_PROMPT_LEN) {
    return NextResponse.json(
      {
        ok: false,
        error: "prompt_too_long",
        message: `Prompt exceeds ${GATEWAY_LIMITS.MAX_PROMPT_LEN} chars.`,
      },
      { status: 400 },
    );
  }
  const from = body.from
    ? /^0x[a-fA-F0-9]{40}$/.test(body.from)
      ? body.from.toLowerCase()
      : null
    : null;

  // ---------- classify intent ----------
  const ALLOWED_INTENTS: GatewayIntent[] = [
    "facts",
    "swarm",
    "code",
    "action",
    "chat",
  ];
  const hint = (body.hint_intent ?? "").toLowerCase() as GatewayIntent;
  const intent: GatewayIntent = ALLOWED_INTENTS.includes(hint)
    ? hint
    : classifyIntent(prompt);

  // ---------- pick specialist ----------
  const db = serverClient();
  let specialist = await pickGatewaySpecialist(db, intent, from ? [from] : []);

  // Fallback: when no agent on the network is tagged for this intent,
  // pick the highest-rated launched agent regardless of tags. The
  // chosen agent still classifies + routes the prompt correctly inside
  // its own /respond — we just hand off discovery.
  if (!specialist) {
    specialist = await pickAnyAgent(db, from ? [from] : []);
  }

  if (!specialist) {
    // Network is empty (no launched agents at all). Honest 503 — never
    // invent an answer.
    return NextResponse.json(
      {
        ok: false,
        error: "no_agents_on_network",
        intent,
        message:
          "No launched agents on signa yet. Spawn the first one at /launch-agent.",
        gateway: {
          classified_intent: intent,
          routed_to: null,
        },
      },
      { status: 503 },
    );
  }

  // ---------- forward to /respond ----------
  // Build the absolute URL from the inbound request — works in local
  // dev (http://localhost:3000), preview deploys, and prod.
  const proto =
    req.nextUrl.protocol ||
    (req.nextUrl.host.includes("localhost") ? "http:" : "https:");
  const host = req.nextUrl.host;
  const target = `${proto}//${host}/api/agents/${specialist.address}/respond`;

  const startedAt = Date.now();
  let fwd: ForwardJson;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      GATEWAY_LIMITS.FORWARD_TIMEOUT_MS,
    );
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Loop guard — see top of file.
        "x-signa-gateway": "1",
      },
      body: JSON.stringify({ message: prompt, from }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    fwd = (await res.json()) as ForwardJson;
    if (!res.ok && fwd.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: "specialist_failed",
          message: fwd.message ?? fwd.error ?? `HTTP ${res.status}`,
          gateway: {
            classified_intent: intent,
            routed_to: { address: specialist.address, name: specialist.name },
            elapsed_ms: Date.now() - startedAt,
          },
        },
        { status: 502 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "specialist_unreachable",
        message: e instanceof Error ? e.message : String(e),
        gateway: {
          classified_intent: intent,
          routed_to: { address: specialist.address, name: specialist.name },
          elapsed_ms: Date.now() - startedAt,
        },
      },
      { status: 502 },
    );
  }

  // ---------- shape the response ----------
  return NextResponse.json({
    ok: true,
    response: fwd.response ?? "",
    intent: fwd.intent ?? intent,
    sources: fwd.sources ?? [],
    signed: fwd.signed ?? false,
    signature: fwd.signature ?? null,
    signed_message: fwd.signed_message ?? null,
    interaction_id: fwd.interaction_id ?? null,
    agent_did: fwd.agent_did ?? null,
    notice: fwd.notice ?? null,
    gateway: {
      classified_intent: intent,
      routed_to: {
        address: specialist.address,
        name: specialist.name,
        net_rating: specialist.net_rating,
        custodial: specialist.runtime_enabled,
        fallback: !!specialist.fallback,
      },
      elapsed_ms: Date.now() - startedAt,
      permalink: fwd.interaction_id
        ? `https://www.signaagent.xyz/i/${fwd.interaction_id}`
        : null,
    },
  });
}
