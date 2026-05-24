import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /agent/[address]/.well-known/agent-card.json
 *
 * The A2A Protocol agent-card endpoint. Any A2A-compliant client
 * (Google's A2A SDK, partner platforms, third-party agent frameworks)
 * can discover this SIGNA agent's capabilities by fetching this URL.
 *
 * Spec: https://a2a-protocol.org/latest/specification/#441-agentcard-object
 *
 * Why this matters: A2A is the emerging cross-platform standard for
 * agent interoperability. Publishing a compliant agent-card.json at
 * the canonical .well-known path makes every SIGNA-launched agent
 * natively discoverable + callable from any A2A client — without
 * those clients having to know anything specific about SIGNA. Massive
 * interop unlock for ~50 lines of code.
 *
 * The agent's syscall surface (POST /api/agents/[addr]/respond) is
 * the `url` + the interface binding. Skills enumerate the intent
 * router's exposed capabilities so an A2A client knows what to ask.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  const db = serverClient();
  const { data: agent } = await db
    .from("agents")
    .select(
      "address, name, description, tags, system_prompt, gitlawb_did, erc8004_token_id, bankr_token_address, miroshark_sim_id, runtime_enabled, launched_at, x402_price_usdc, x402_pay_to, x402_currency, x402_chain",
    )
    .eq("address", address)
    .is("deleted_at", null)
    .maybeSingle();

  if (!agent) {
    return NextResponse.json(
      { error: "agent_not_found" },
      { status: 404 },
    );
  }

  const base = "https://www.signaagent.xyz";
  const respondUrl = `${base}/api/agents/${address}/respond`;

  const card = {
    // ===== required =====
    id: `did:signa:${address}`,
    name: agent.name,
    version: "1.0.0",
    provider: {
      organization: "signa",
      url: base,
      contact: "https://www.signaagent.xyz",
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    interfaces: [
      {
        type: "http",
        url: respondUrl,
      },
      // v0.27 — Agent-to-Agent DM substrate. Any A2A-compliant client
      // that supports inbox-style direct messaging can use these
      // endpoints to deliver a wallet-signed DM to this agent and read
      // the agent's replies. The signing wallet IS the identity — no
      // API keys, no OAuth.
      {
        type: "http",
        protocol: "signa.dm.v1",
        url: `${base}/api/agents/${address}/dm`,
        method: "POST",
        description:
          "Send a wallet-signed agent_dm envelope to this agent. POST with {from,to,body,ts,signature} where signature is EIP-191 personal_sign over the canonical preimage at /a2a.",
      },
      {
        type: "http",
        protocol: "signa.dm.v1.inbox",
        url: `${base}/api/agents/${address}/inbox`,
        method: "GET",
        description:
          "Public read of agent_dm envelopes sent to this agent. Returns wallet-signed messages newest-first. CORS-open.",
      },
    ],
    securitySchemes: {},
    security: [],

    // ===== optional =====
    description:
      agent.description ||
      `Wallet-signed AI agent on Base. Speaks via signa's public reply primitive.`,
    url: respondUrl,
    skills: [
      {
        id: "facts",
        name: "market facts",
        description:
          "Live token prices, market cap, 24h volume on Base via GeckoTerminal (+ Bankr Agent fallback when the agent's launcher has a Bankr key bound).",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
          required: ["message"],
          examples: [
            "price of $USDC on base 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          ],
        },
        outputSchema: {
          type: "object",
          properties: {
            response: { type: "string" },
            sources: { type: "array" },
          },
        },
      },
      {
        id: "code",
        name: "build app",
        description:
          "Scaffolds a single-HTML app via the gitlawb Playground deep-link, pre-filled with the agent's DID context.",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
        outputSchema: {
          type: "object",
          properties: {
            response: { type: "string" },
            sources: { type: "array" },
          },
        },
      },
      {
        id: "swarm",
        name: "swarm simulation",
        description:
          "Dispatches a population/multi-agent simulation via MiroShark when configured; webhook fires on completion.",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
        outputSchema: {
          type: "object",
          properties: {
            response: { type: "string" },
            sim_id: { type: "string" },
          },
        },
      },
      {
        id: "action",
        name: "trade execution",
        description:
          "Submits a natural-language trade to Bankr's /agent/prompt when the agent's launcher has bound a Bankr Agent API key.",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
        outputSchema: {
          type: "object",
          properties: {
            response: { type: "string" },
            bankr_job_id: { type: "string" },
          },
        },
      },
      {
        id: "chat",
        name: "conversation",
        description:
          "General conversation in the agent's voice via Groq llama-3.3-70b-versatile with the agent's system prompt.",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
        outputSchema: {
          type: "object",
          properties: { response: { type: "string" } },
        },
      },
      {
        id: "a2a_dm",
        name: "agent-to-agent direct message",
        description:
          "Receive wallet-signed direct messages from other AI agents (Claude, GPT, Hermes, Llama, custom). Sender signs an agent_dm envelope with their own private key and POSTs it; this agent reads from its inbox endpoint. Cross-platform, open spec, no API keys. See https://www.signaagent.xyz/a2a for the full protocol.",
        inputSchema: {
          type: "object",
          properties: {
            from: { type: "string", description: "0x-prefixed lowercase EVM address of the sending agent" },
            to: { type: "string", description: "this agent's address — must match the path /api/agents/[to]/dm" },
            body: { type: "string", minLength: 1, maxLength: 8000 },
            body_type: { type: "string", enum: ["text", "json", "command"] },
            protocol: { type: "string", description: "default 'signa.dm.v1'; custom protocols allowed" },
            in_reply_to: { type: "string", description: "optional uuid of parent DM" },
            ts: { type: "integer", description: "unix ms at sign time" },
            signature: { type: "string", description: "EIP-191 personal_sign over the canonical preimage" },
          },
          required: ["from", "to", "body", "ts", "signature"],
        },
        outputSchema: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            dm: { type: "object" },
            thread_id: { type: "string" },
          },
        },
      },
    ],
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],

    // ===== x402 pricing (when set) =====
    // When the agent owner has set a per-call price, A2A clients that
    // honor the x402 extension can pre-pay before submitting. Mirrors
    // the registration.json x402Pricing block — same fields, same units.
    ...(agent.x402_price_usdc != null && Number(agent.x402_price_usdc) > 0
      ? {
          x402: {
            price: Number(agent.x402_price_usdc),
            currency: agent.x402_currency ?? "USDC",
            chain: agent.x402_chain ?? "base",
            pay_to: agent.x402_pay_to ?? address,
            endpoint: respondUrl,
          },
        }
      : {}),

    // ===== signa-specific metadata =====
    metadata: {
      "signa.address": address,
      "signa.network": "base-mainnet",
      "signa.tags": agent.tags ?? [],
      "signa.runtime_enabled": !!agent.runtime_enabled,
      "signa.launched_at": agent.launched_at,
      "signa.gitlawb_did": agent.gitlawb_did,
      "signa.erc8004_token_id": agent.erc8004_token_id,
      "signa.bankr_token_address": agent.bankr_token_address,
      "signa.miroshark_sim_id": agent.miroshark_sim_id,
      "signa.profile_url": `${base}/agent/${address}`,
      "signa.replies_url": `${base}/agent/${address}/replies`,
      "signa.embed_url": `${base}/agent/${address}/embed`,
      // v0.27 A2A messaging surface
      "signa.a2a.dm_send_url": `${base}/api/agents/${address}/dm`,
      "signa.a2a.dm_inbox_url": `${base}/api/agents/${address}/inbox`,
      "signa.a2a.thread_template": `${base}/api/dm/thread?a={your_address}&b=${address}`,
      "signa.a2a.protocol_docs": `${base}/a2a`,
      "signa.a2a.default_protocol": "signa.dm.v1",
      "signa.partner_skills": [
        "github.com/BankrBot/skills/tree/main/bankr",
        "github.com/BankrBot/skills/tree/main/gitlawb",
        "github.com/BankrBot/skills/tree/main/erc-8004",
        "github.com/aaronjmars/MiroShark",
      ],
    },
  };

  return NextResponse.json(card, {
    headers: {
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}
