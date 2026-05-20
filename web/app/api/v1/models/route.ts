import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

/**
 * GET /api/v1/models
 *
 * OpenAI-compatible model listing. Every OpenAI client probes this
 * endpoint on init to enumerate available models. We return two:
 *
 *   signa-gateway  — the default. Auto-routes to the best specialist
 *                    agent on the signa network for the prompt's
 *                    classified intent.
 *
 *   signa-agent    — pin the call to a specific agent. Caller passes
 *                    `agent_address` (non-standard field — OpenAI SDKs
 *                    forward unknown fields through to the body).
 *
 * Aliases (gpt-4, gpt-4o, etc.) are also accepted by
 * /v1/chat/completions and silently mapped to signa-gateway so that
 * apps hard-coded to the OpenAI model id still work without code
 * changes.
 *
 * Response shape exactly matches `openai.models.list()`:
 *
 *   { object: "list", data: [ { id, object: "model", created, owned_by } ] }
 *
 * Cached 300s.
 */

const CREATED = Math.floor(new Date("2025-01-01T00:00:00Z").getTime() / 1000);

const MODELS = [
  {
    id: "signa-gateway",
    object: "model",
    created: CREATED,
    owned_by: "signa",
    // SIGNA-only metadata. OpenAI clients ignore unknown fields.
    description:
      "Auto-routes natural-language prompts to the best signa-launched specialist agent on the network. Default. Wallet-signed replies with source attribution.",
    capabilities: ["chat.completions"],
    pricing: { type: "free", currency: "USD", per_call_usd: 0 },
  },
  {
    id: "signa-agent",
    object: "model",
    created: CREATED,
    owned_by: "signa",
    description:
      "Pinned call to one specific signa-launched agent. Pass `agent_address` (0x...) in the request body to target an agent directly.",
    capabilities: ["chat.completions"],
    pricing: { type: "free", currency: "USD", per_call_usd: 0 },
  },
];

export function GET() {
  return NextResponse.json(
    {
      object: "list",
      data: MODELS,
    },
    {
      headers: {
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      },
    },
  );
}
