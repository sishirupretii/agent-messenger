import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { serverClient } from "@/lib/supabase";
import {
  classifyIntent,
  pickGatewaySpecialist,
  pickAnyAgent,
  GATEWAY_LIMITS,
  type GatewayIntent,
} from "@/lib/gateway";

const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

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

type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

type ChatCompletionsBody = {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  // OpenAI tools API. When tools are provided, we route through Groq
  // directly with tool-calling enabled. See "TOOLS PATH" below.
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
  response_format?: { type: "text" | "json_object" };
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

  // Streaming flag — proper SSE response when true, JSON when false.
  // Both paths funnel through the same routing / specialist picker
  // / forward-to-/respond logic; only the response framing differs.
  const wantStream = body.stream === true;

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

  // ============================================================
  // TOOLS PATH — OpenAI function-calling passthrough via Groq.
  //
  // When the caller provides `tools[]` (and didn't disable via
  // tool_choice:"none"), we skip our intent router entirely and
  // route the (messages + tools) ensemble directly to Groq with
  // tool-calling enabled. The response carries Groq's native
  // tool_calls — exactly what every OpenAI tool-using framework
  // (LangChain agents, OpenAI assistants API, Mastra, etc.) expects.
  //
  // The signa extension is omitted in tools mode because we didn't
  // route through a signa agent — the caller opted into the
  // raw-LLM-with-tools workflow. They can still get signed replies
  // by calling the endpoint without tools, which uses our agent
  // routing path below.
  // ============================================================
  const wantsTools =
    Array.isArray(body.tools) &&
    body.tools.length > 0 &&
    body.tool_choice !== "none";

  if (wantsTools) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return NextResponse.json(
        {
          error: {
            message:
              "Tools/function-calling requires GROQ_API_KEY on the SIGNA deployment. Without it, omit `tools` and the endpoint will use the intent router instead.",
            type: "service_unavailable",
            code: "groq_not_configured",
          },
        },
        { status: 503 },
      );
    }
    const groq = new Groq({ apiKey: groqKey });

    try {
      // Note: we pass through OpenAI-shape messages/tools/tool_choice
      // directly. Groq's chat.completions API speaks the same shape
      // as OpenAI's for these fields.
      const groqRes = await groq.chat.completions.create({
        model: GROQ_MODEL,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: (body.messages ?? []) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: body.tools as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tool_choice: (body.tool_choice ?? "auto") as any,
        temperature: body.temperature,
        max_completion_tokens: body.max_tokens,
        stream: false, // streaming + tools is roadmap; v1 always JSON
      });

      // Override the model name in the response so consumers see the
      // signa-* model id they requested, not Groq's internal name.
      const id = `chatcmpl-${groqRes.id?.slice(-24) ?? chatId().slice(9)}`;
      return NextResponse.json({
        id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? "signa-gateway",
        choices: groqRes.choices,
        usage: groqRes.usage,
        // SIGNA extension still present, but minimal — flags that
        // this response came from the tools path so consumers know
        // there's no signed reply attached.
        signa: {
          mode: "tools_passthrough",
          backend: "groq",
          backend_model: GROQ_MODEL,
          signed: false,
          interaction_id: null,
          sources: [],
          notice:
            "Tools mode bypasses the signa agent router — call without `tools` to get a wallet-signed reply with source attribution.",
        },
      });
    } catch (e) {
      return NextResponse.json(
        {
          error: {
            message: e instanceof Error ? e.message : String(e),
            type: "tools_backend_error",
            code: "groq_tools_failed",
          },
        },
        { status: 502 },
      );
    }
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
  const promptTokens = Math.ceil(prompt.length / 4);
  const completionTokens = Math.ceil(completion.length / 4);
  const id = chatId();
  const created = Math.floor(Date.now() / 1000);

  // Common signa extension block — same data on both code paths.
  const signaBlock = {
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
  };

  // -------- NON-STREAMING PATH --------
  if (!wantStream) {
    return NextResponse.json({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: completion },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
      signa: signaBlock,
    });
  }

  // -------- STREAMING PATH (Server-Sent Events) --------
  //
  // Wire format per OpenAI spec: each chunk is a single line:
  //   data: <JSON ChatCompletionChunk>
  // followed by a blank line. Terminator is:
  //   data: [DONE]
  //
  // Each chunk has the same id/object/created/model. The delta carries
  // the new content piece. First chunk includes role:"assistant". Last
  // content chunk has finish_reason:"stop" and an empty delta.
  //
  // We chunk the completion text in ~24-char windows with a 12ms
  // inter-chunk delay so the stream "feels" live in the consumer
  // (matters when the consumer is rendering token-by-token in a UI).
  // The 12ms delay also keeps connections warm — Vercel functions
  // close idle TCP after a few seconds.
  //
  // The final chunk includes the signa extension on the chunk object
  // itself. OpenAI's chat.completion.chunk schema permits unknown
  // top-level fields, so strict parsers ignore it; consumers that
  // know about signa can read the verifiable signature off the stream.

  const encoder = new TextEncoder();
  const chunkSize = 24;
  const interChunkDelayMs = 12;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(obj)}\n\n`),
        );
      };
      const sendDone = () => {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      };

      // 1) Role-only opening chunk — OpenAI clients expect this exact
      //    first delta so they know the assistant is starting.
      send({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "" },
            finish_reason: null,
            logprobs: null,
          },
        ],
      });

      // 2) Content deltas — slice the completion into chunks.
      for (let i = 0; i < completion.length; i += chunkSize) {
        const piece = completion.slice(i, i + chunkSize);
        send({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { content: piece },
              finish_reason: null,
              logprobs: null,
            },
          ],
        });
        if (interChunkDelayMs > 0) {
          await new Promise((r) => setTimeout(r, interChunkDelayMs));
        }
      }

      // 3) Final chunk — empty delta + finish_reason + signa extension.
      send({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
        signa: signaBlock,
      });

      // 4) Terminator per OpenAI spec.
      sendDone();
      controller.close();
    },
    cancel() {
      // Client disconnected mid-stream. Nothing to clean up — we've
      // already fetched the full reply before streaming starts.
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Some proxies (Cloudflare in particular) buffer SSE without
      // this header. Vercel honors it.
      "x-accel-buffering": "no",
      "access-control-allow-origin": "*",
    },
  });
}
