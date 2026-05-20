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
 * POST /api/v1/chat/completions
 *
 * OpenAI-compatible chat completion endpoint. The exact response shape
 * OpenAI returns, so any framework that speaks `/v1/chat/completions`
 * (LangChain, LlamaIndex, Vercel AI SDK, Mastra, Cursor MCP, the
 * OpenAI npm/python SDKs, etc.) can use SIGNA as a drop-in by
 * overriding baseURL:
 *
 *   import OpenAI from "openai";
 *   const ai = new OpenAI({
 *     baseURL: "https://www.signaagent.xyz/api/v1",
 *     apiKey: "not-required-but-sdk-needs-it",
 *   });
 *   const r = await ai.chat.completions.create({
 *     model: "signa-gateway",
 *     messages: [{ role: "user", content: "price of $USDC on base" }],
 *   });
 *
 * Internally we route through the same intent classifier + specialist
 * picker the public /api/gateway/respond endpoint uses. The difference
 * is the response shape — OpenAI-strict here, native here on
 * /api/gateway/respond. Same data, two surfaces.
 *
 * Models:
 *   "signa-gateway"   → auto-route to best specialist (default)
 *   "signa-agent"     → pin to a specific agent (pass `agent_address`
 *                       in the OpenAI-compatible request as a non-
 *                       standard field; OpenAI SDKs forward unknown
 *                       fields untouched)
 *
 * SIGNA extension: every response carries a top-level `signa` block
 * with the interaction_id (permalink), signature, sources cited,
 * intent classification, and routing decision. Strict OpenAI clients
 * ignore unknown top-level fields, so this is purely additive.
 *
 * Streaming (stream: true) is roadmap. v1 returns the full reply in
 * one response. The endpoint returns HTTP 501 with a clear message
 * if streaming is requested, so clients don't hang.
 */

const SUPPORTED_MODELS = new Set([
  "signa-gateway",
  "signa-agent",
  // common aliases — some frameworks need a familiar model id
  "gpt-4",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-3.5-turbo",
]);

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; text?: string }>;
  name?: string;
};

type ChatCompletionsBody = {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  // SIGNA-specific extensions (OpenAI SDKs forward unknown fields
  // untouched, so these come through transparent)
  agent_address?: string;
  from?: string;
  hint_intent?: GatewayIntent;
};

type ForwardJson = {
  ok: boolean;
  response?: string;
  intent?: string;
  sources?: Array<{ kind: string; ref: string }>;
  signed?: boolean;
  signature?: string | null;
  signed_message?: string | null;
  interaction_id?: string | null;
  agent_did?: string | null;
  notice?: string | null;
  error?: string;
  message?: string;
  gateway?: {
    classified_intent?: string;
    routed_to?: {
      address: string;
      name: string;
      net_rating?: number;
      custodial?: boolean;
      fallback?: boolean;
    } | null;
    elapsed_ms?: number;
    permalink?: string | null;
  };
};

/**
 * Collapse an OpenAI messages array into a single prompt string. We
 * use the last user message as the "real" prompt and prepend any
 * system message text as context. Assistant turns are dropped (we
 * don't carry conversation state in v1; each call is independent).
 */
function flattenMessages(messages: ChatMessage[] | undefined): string {
  if (!messages || messages.length === 0) return "";

  const systemParts: string[] = [];
  let lastUser = "";
  for (const m of messages) {
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join(" ")
          : "";
    if (!text) continue;
    if (m.role === "system") systemParts.push(text);
    if (m.role === "user") lastUser = text;
  }

  // System message becomes a prefix on the user prompt — the agent's
  // own system_prompt still applies on top.
  return systemParts.length > 0
    ? `${systemParts.join("\n\n")}\n\n${lastUser}`
    : lastUser;
}

function isValidAddress(s: string | undefined): s is string {
  return !!s && /^0x[a-fA-F0-9]{40}$/.test(s);
}

function chatId(): string {
  // OpenAI chat completions ids are prefixed `chatcmpl-` then 24 chars
  // of base32 random. We mirror that loosely so clients that pattern-
  // match the id don't choke.
  const rand = Array.from(
    { length: 24 },
    () =>
      "abcdefghijklmnopqrstuvwxyz0123456789"[
        Math.floor(Math.random() * 36)
      ],
  ).join("");
  return `chatcmpl-${rand}`;
}

export async function POST(req: NextRequest) {
  // ---------- parse ----------
  let body: ChatCompletionsBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          message: "bad json",
          type: "invalid_request_error",
          code: "bad_json",
        },
      },
      { status: 400 },
    );
  }

  // ---------- streaming guard ----------
  if (body.stream === true) {
    return NextResponse.json(
      {
        error: {
          message:
            "Streaming (stream: true) is not yet supported by SIGNA. Set stream:false (default) and the full reply will return in one response. SSE streaming is on the roadmap.",
          type: "not_implemented",
          code: "stream_not_supported",
        },
      },
      { status: 501 },
    );
  }

  // ---------- validate prompt ----------
  const prompt = flattenMessages(body.messages).trim();
  if (!prompt) {
    return NextResponse.json(
      {
        error: {
          message:
            "messages[] must contain at least one user message with non-empty content",
          type: "invalid_request_error",
          code: "empty_messages",
        },
      },
      { status: 400 },
    );
  }
  if (prompt.length > GATEWAY_LIMITS.MAX_PROMPT_LEN) {
    return NextResponse.json(
      {
        error: {
          message: `combined user+system content exceeds ${GATEWAY_LIMITS.MAX_PROMPT_LEN} chars`,
          type: "invalid_request_error",
          code: "content_too_long",
        },
      },
      { status: 400 },
    );
  }

  // ---------- pick target agent ----------
  const proto =
    req.nextUrl.protocol ||
    (req.nextUrl.host.includes("localhost") ? "http:" : "https:");
  const host = req.nextUrl.host;
  const from = isValidAddress(body.from) ? body.from!.toLowerCase() : null;

  const model = body.model ?? "signa-gateway";
  if (!SUPPORTED_MODELS.has(model)) {
    return NextResponse.json(
      {
        error: {
          message: `model "${model}" is not supported. Use "signa-gateway" (default) or "signa-agent" with agent_address.`,
          type: "invalid_request_error",
          code: "model_not_found",
          param: "model",
        },
      },
      { status: 404 },
    );
  }

  let targetUrl: string;
  let routedTo: {
    address: string;
    name: string;
    net_rating?: number;
    custodial?: boolean;
    fallback?: boolean;
  } | null = null;
  let classifiedIntent: GatewayIntent;

  if (model === "signa-agent" && isValidAddress(body.agent_address)) {
    // Pinned call — caller already knows which agent.
    targetUrl = `${proto}//${host}/api/agents/${body.agent_address!.toLowerCase()}/respond`;
    classifiedIntent = body.hint_intent ?? classifyIntent(prompt);
  } else {
    // Gateway route — pick the best specialist.
    classifiedIntent = body.hint_intent ?? classifyIntent(prompt);
    const db = serverClient();
    let specialist = await pickGatewaySpecialist(
      db,
      classifiedIntent,
      from ? [from] : [],
    );
    if (!specialist) specialist = await pickAnyAgent(db, from ? [from] : []);
    if (!specialist) {
      return NextResponse.json(
        {
          error: {
            message:
              "No launched agents on signa network. Spawn the first one at /launch-agent.",
            type: "service_unavailable",
            code: "no_agents_on_network",
          },
        },
        { status: 503 },
      );
    }
    targetUrl = `${proto}//${host}/api/agents/${specialist.address}/respond`;
    routedTo = {
      address: specialist.address,
      name: specialist.name,
      net_rating: specialist.net_rating,
      custodial: specialist.runtime_enabled,
      fallback: !!specialist.fallback,
    };
  }

  // ---------- forward to /respond ----------
  const startedAt = Date.now();
  let fwd: ForwardJson;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      GATEWAY_LIMITS.FORWARD_TIMEOUT_MS,
    );
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // loop guard against gateway forwarding into itself
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
          error: {
            message: fwd.message ?? fwd.error ?? `HTTP ${res.status}`,
            type: "specialist_error",
            code: "agent_unreachable",
          },
        },
        { status: 502 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          message: e instanceof Error ? e.message : String(e),
          type: "specialist_error",
          code: "agent_unreachable",
        },
      },
      { status: 502 },
    );
  }

  // ---------- shape the OpenAI response ----------
  const completion = fwd.response ?? "";
  // Rough token counts so OpenAI client libraries that surface usage
  // don't show null. ~4 chars per token is the conventional estimate.
  const promptTokens = Math.ceil(prompt.length / 4);
  const completionTokens = Math.ceil(completion.length / 4);

  return NextResponse.json({
    id: chatId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: completion,
        },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    // SIGNA extension — additive on top of the strict OpenAI shape.
    // OpenAI clients ignore unknown top-level fields, so this is safe.
    signa: {
      interaction_id: fwd.interaction_id ?? null,
      intent: fwd.intent ?? classifiedIntent,
      sources: fwd.sources ?? [],
      signed: fwd.signed ?? false,
      signature: fwd.signature ?? null,
      signed_message: fwd.signed_message ?? null,
      agent_did: fwd.agent_did ?? null,
      routed_to: routedTo,
      elapsed_ms: Date.now() - startedAt,
      permalink: fwd.interaction_id
        ? `https://www.signaagent.xyz/i/${fwd.interaction_id}`
        : null,
    },
  });
}
