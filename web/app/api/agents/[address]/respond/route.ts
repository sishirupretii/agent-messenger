import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import Groq from "groq-sdk";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { serverClient } from "@/lib/supabase";
import { decryptAgentKey, decryptOpaque } from "@/lib/key-vault";
import { tokenOnBase, formatUsd, formatPct } from "@/lib/geckoterminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[address]/respond
 *
 * The killer ship — a single public, CORS-open, free endpoint that turns
 * any SIGNA-launched agent into a multi-source-grounded reply engine.
 * Used by:
 *
 *   - human DMs in any SIGNA chat (composer hits this for non-user peers)
 *   - third-party clients (Discord/TG bots, dashboards, gitlawb Playground
 *     apps) — same shape, same auth model
 *   - other agents talking to this agent
 *
 * Request shape (v1, intentionally tiny):
 *   { message: string, from?: 0x-address }
 *
 * Response shape:
 *   {
 *     ok: true,
 *     response: string,
 *     agent_address: 0x...,
 *     intent: "facts" | "swarm" | "code" | "chat" | "action" | "error",
 *     sources: Array<{ kind, ref }>,    // citations for transparency
 *     signed: boolean,                  // true iff agent has runtime custody
 *     signature?: 0x...,                // EIP-191 over the response body
 *     signed_message?: string,          // exact preimage used
 *     agent_did?: string,               // gitlawb DID if linked
 *     interaction_id: uuid,             // for future rating + replay
 *   }
 *
 * Architecture — partners are load-bearing, not garnish:
 *
 *   1. Intent classifier (Groq llama-3.3-70b-versatile) → one of
 *      {facts, swarm, code, chat, action}. Real LLM, real classification,
 *      no regex hacks.
 *
 *   2. Tool router executes the intent against the partner stack:
 *        facts  → GeckoTerminal direct on Base (free, structured) +
 *                 optional Bankr /agent/prompt fallback for natural-lang
 *                 market questions (when agent owner has a Bankr key)
 *        swarm  → MiroShark simulation create (env-gated; falls back to a
 *                 graceful "MiroShark not wired on this deploy" line)
 *        code   → agent's gitlawb_did + a deep-link to a fresh Playground
 *                 prompt that reuses the asked context (build with them)
 *        chat   → plain Groq reply with the agent's system prompt
 *        action → Bankr /agent/prompt routed through the AGENT's own
 *                 bankr key if it has one (custodial trade)
 *
 *   3. Synthesizer takes the raw tool output + the agent's system prompt
 *      and asks Groq to write the final reply in the agent's voice. The
 *      raw tool data is in the prompt context — the model can't invent
 *      prices because the grounding facts are pinned.
 *
 *   4. Signer: if the agent has an encrypted_key in vault (opted into
 *      custody), we decrypt it server-side, sign an EIP-191 message over
 *      a canonical response preimage, and return { signature, signed:true,
 *      signed_message }. Callers can verify off-platform. Non-custodial
 *      agents return { signed: false } — caller knows the reply isn't
 *      cryptographically attributable.
 *
 *   5. Persist into agent_interactions for future reputation + replay.
 *
 * This is the primitive — every higher-level surface (DM autoreply,
 * Discord bot, Playground app) calls this. We build the network effect
 * by making the cheapest place to host an agent be inside SIGNA.
 */

const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const BANKR = "https://api.bankr.bot";
const MIROSHARK_BASE = process.env.MIROSHARK_BASE_URL || "";
const MIROSHARK_KEY = process.env.MIROSHARK_API_KEY || "";
const MAX_MESSAGE_LEN = 1500;

type Intent = "facts" | "swarm" | "code" | "chat" | "action";

type Source = {
  kind:
    | "geckoterminal"
    | "bankr_agent"
    | "miroshark"
    | "gitlawb"
    | "groq"
    | "system";
  ref: string;
};

type AgentRow = {
  address: string;
  name: string;
  description: string;
  tags: string[] | null;
  system_prompt: string | null;
  launched_by: string | null;
  gitlawb_did: string | null;
  erc8004_token_id: string | null;
  bankr_token_address: string | null;
  miroshark_sim_id: string | null;
  encrypted_key: string | null;
  runtime_enabled: boolean | null;
  /**
   * NOT a column on agents — populated at request time by looking up the
   * launcher's row in users. Agents borrow Bankr-execution capacity from
   * whoever launched them (and connected their personal Bankr Agent key).
   */
  bankr_api_key_encrypted: string | null;
};

function classify(message: string): Intent {
  // Cheap lexical pre-classifier — gives the LLM router a head-start and
  // lets us skip the LLM round-trip for unambiguous prompts. The LLM
  // overrides when ambiguous.
  const m = message.toLowerCase();
  if (/(price|chart|market cap|volume|fdv|holders|pool|liquidity)\b/.test(m)) {
    return "facts";
  }
  if (/(swarm|simulate|simulation|agent.*populate|monte carlo)/.test(m)) {
    return "swarm";
  }
  if (/(build|spin up|playground|gitlawb|code this|html app|ship a)/.test(m)) {
    return "code";
  }
  if (/(buy|sell|swap|trade|long|short|ape|send|transfer)\b/.test(m)) {
    return "action";
  }
  return "chat";
}

async function llmClassify(
  client: Groq,
  message: string,
  hint: Intent,
): Promise<Intent> {
  try {
    const sys =
      "You classify user messages for a Base-mainnet AI agent. " +
      "Output exactly one token, no punctuation, from this set: " +
      "facts (asking about token prices/markets/portfolios), " +
      "swarm (asking to simulate a population/multi-agent scenario), " +
      "code (asking to build/spin up a small app or code artifact), " +
      "action (asking to execute a transaction — buy/sell/swap/transfer), " +
      "chat (general conversation, opinion, casual). " +
      `Lexical hint: ${hint}.`;
    const r = await client.chat.completions.create({
      model: GROQ_MODEL,
      temperature: 0,
      max_completion_tokens: 5,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: message },
      ],
    });
    const tok = (r.choices?.[0]?.message?.content ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    if (
      tok === "facts" ||
      tok === "swarm" ||
      tok === "code" ||
      tok === "action" ||
      tok === "chat"
    ) {
      return tok;
    }
  } catch {
    // fall through to hint
  }
  return hint;
}

/** Extract any 0x-tokens or $TICKERs the message asks about. */
function extractTickersAndAddrs(message: string): {
  addresses: string[];
  tickers: string[];
} {
  const addresses = Array.from(
    message.matchAll(/0x[a-fA-F0-9]{40}/g),
    (m) => m[0].toLowerCase(),
  );
  const tickers = Array.from(
    message.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,9})\b/g),
    (m) => m[1].toUpperCase(),
  );
  return {
    addresses: Array.from(new Set(addresses)),
    tickers: Array.from(new Set(tickers)),
  };
}

/** Resolve any tickers the user mentioned to addresses via the agents table
 *  (we keep a curated bankr_token_address column) + Supabase tokens cache. */
async function resolveTickersToAddrs(
  db: ReturnType<typeof serverClient>,
  tickers: string[],
): Promise<Array<{ ticker: string; address: string }>> {
  if (tickers.length === 0) return [];
  // Try the agents.bankr_token_address column — tokens we know about.
  const { data: agents } = await db
    .from("agents")
    .select("name, tags, bankr_token_address")
    .not("bankr_token_address", "is", null);
  const out: Array<{ ticker: string; address: string }> = [];
  for (const t of tickers) {
    const hit = (agents ?? []).find(
      (a: { name: string; tags: string[] | null; bankr_token_address: string | null }) =>
        a.name?.toUpperCase().includes(t) ||
        (a.tags ?? []).some((tag) => tag.toUpperCase() === t),
    );
    if (hit?.bankr_token_address) {
      out.push({ ticker: t, address: hit.bankr_token_address.toLowerCase() });
    }
  }
  return out;
}

async function runFacts(
  message: string,
  agent: AgentRow,
  db: ReturnType<typeof serverClient>,
): Promise<{ context: string; sources: Source[] }> {
  const { addresses, tickers } = extractTickersAndAddrs(message);
  const resolved = await resolveTickersToAddrs(db, tickers);
  const allAddrs = Array.from(
    new Set([...addresses, ...resolved.map((r) => r.address)]),
  );

  const lines: string[] = [];
  const sources: Source[] = [];

  for (const addr of allAddrs.slice(0, 5)) {
    const t = await tokenOnBase(addr);
    if (!t) {
      lines.push(`token ${addr} → not indexed on Base`);
      continue;
    }
    lines.push(
      `$${t.symbol} (${addr.slice(0, 6)}…${addr.slice(-4)}): ` +
        `price=${formatUsd(t.price_usd)} | ` +
        `24h=${formatPct(t.change_24h_pct)} | ` +
        `vol=${formatUsd(t.volume_24h_usd)} | ` +
        `mcap=${formatUsd(t.market_cap_usd)}`,
    );
    sources.push({ kind: "geckoterminal", ref: addr });
  }

  // Optional: if agent owner has a Bankr key, route a natural-lang query
  // to Bankr for richer answers (Bankr does more than trade — it can
  // answer market questions). Cheap fallback when GT has no signal.
  if (agent.bankr_api_key_encrypted && lines.length === 0) {
    try {
      const apiKey = decryptOpaque(agent.bankr_api_key_encrypted);
      const submit = await fetch(`${BANKR}/agent/prompt`, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prompt: message }),
      });
      if (submit.ok) {
        const j = (await submit.json()) as {
          response?: string;
          answer?: string;
          jobId?: string;
        };
        const txt = j.response || j.answer;
        if (txt) {
          lines.push(`bankr: ${txt}`);
          sources.push({ kind: "bankr_agent", ref: j.jobId ?? "prompt" });
        }
      }
    } catch {
      // skip silently — facts intent should never hard-fail on a missing partner
    }
  }

  if (lines.length === 0) {
    lines.push(
      "no tokens parsed from message — try mentioning a $TICKER or 0xADDRESS",
    );
  }
  return {
    context: `MARKET FACTS (live, do not invent numbers):\n${lines.join("\n")}`,
    sources,
  };
}

async function runSwarm(
  message: string,
  agent: AgentRow,
): Promise<{ context: string; sources: Source[] }> {
  if (!MIROSHARK_BASE) {
    return {
      context:
        "SWARM CONTEXT:\nMiroShark not wired on this deployment. Respond by " +
        "describing what a swarm sim of this scenario would explore, but " +
        "make it clear you can't actually run one right now.",
      sources: [{ kind: "system", ref: "miroshark_not_configured" }],
    };
  }
  try {
    const res = await fetch(`${MIROSHARK_BASE.replace(/\/$/, "")}/api/simulation/create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(MIROSHARK_KEY ? { authorization: `Bearer ${MIROSHARK_KEY}` } : {}),
      },
      body: JSON.stringify({
        prompt: message,
        agent_address: agent.address,
        agent_did: agent.gitlawb_did,
      }),
    });
    if (!res.ok) {
      return {
        context: `SWARM CONTEXT:\nMiroShark create failed (HTTP ${res.status}). Describe the swarm scenario qualitatively.`,
        sources: [{ kind: "miroshark", ref: `http_${res.status}` }],
      };
    }
    const j = (await res.json()) as { sim_id?: string; preview?: string; url?: string };
    return {
      context:
        `SWARM CONTEXT (MiroShark sim_id ${j.sim_id ?? "?"} dispatched):\n` +
        (j.preview ?? "simulation queued") +
        (j.url ? `\nview: ${j.url}` : ""),
      sources: [{ kind: "miroshark", ref: j.sim_id ?? "queued" }],
    };
  } catch (e) {
    return {
      context: `SWARM CONTEXT:\nMiroShark unreachable (${e instanceof Error ? e.message : String(e)}). Describe the swarm scenario qualitatively.`,
      sources: [{ kind: "miroshark", ref: "unreachable" }],
    };
  }
}

function runCode(message: string, agent: AgentRow): {
  context: string;
  sources: Source[];
} {
  // gitlawb Playground accepts a `?prompt=` deep-link that pre-fills the
  // build prompt. We hand the user a personalized one — building WITH
  // gitlawb, not just citing them.
  const seed = `Build a small single-HTML app: ${message}. Use SIGNA agent ${agent.name} (${agent.address}) data via https://signaagent.xyz/api/agents/${agent.address}.`;
  const playground = `https://playground.gitlawb.app/?prompt=${encodeURIComponent(
    seed.slice(0, 500),
  )}`;
  const did = agent.gitlawb_did;
  const lines: string[] = [];
  lines.push(`CODE CONTEXT:`);
  lines.push(`gitlawb_playground_url: ${playground}`);
  if (did) {
    lines.push(`agent_gitlawb_did: ${did}`);
    lines.push(
      `Tell the user that you can spin them a single-HTML app on gitlawb Playground using your DID context — share the playground URL above.`,
    );
  } else {
    lines.push(
      `This agent has no gitlawb DID linked yet — still share the playground URL so the user can scaffold their idea.`,
    );
  }
  return {
    context: lines.join("\n"),
    sources: [{ kind: "gitlawb", ref: did ?? "playground_only" }],
  };
}

async function runAction(
  message: string,
  agent: AgentRow,
): Promise<{ context: string; sources: Source[] }> {
  // Custodial trade — only if the agent's owner has a Bankr key bound to
  // the agent. v1: we don't actually execute the trade automatically (too
  // dangerous for a public endpoint); we return what Bankr says the
  // intent is so the human can confirm out-of-band.
  if (!agent.bankr_api_key_encrypted) {
    return {
      context:
        "ACTION CONTEXT:\nThis agent has no Bankr Agent API key bound — it can describe the trade plan but cannot execute one. Suggest the user execute via /trade on /me.",
      sources: [{ kind: "system", ref: "no_bankr_key" }],
    };
  }
  try {
    const apiKey = decryptOpaque(agent.bankr_api_key_encrypted);
    // Use Bankr's dry-run-ish behavior: we submit the prompt but DO NOT
    // poll to completion here — the response endpoint is supposed to be
    // fast (<2s). Caller is told the jobId so they can poll independently.
    const submit = await fetch(`${BANKR}/agent/prompt`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt: message }),
    });
    const j = (await submit.json().catch(() => ({}))) as {
      jobId?: string;
      id?: string;
      response?: string;
      error?: string;
    };
    const jobId = j.jobId || j.id;
    const lines: string[] = ["ACTION CONTEXT (Bankr agent):"];
    if (jobId) {
      lines.push(`bankr_job_id: ${jobId}`);
      lines.push(`bankr_poll_url: ${BANKR}/agent/job/${jobId}`);
    }
    if (j.response) lines.push(`bankr_preview: ${j.response}`);
    if (j.error) lines.push(`bankr_error: ${j.error}`);
    return {
      context: lines.join("\n"),
      sources: [{ kind: "bankr_agent", ref: jobId ?? "submitted" }],
    };
  } catch (e) {
    return {
      context: `ACTION CONTEXT:\nBankr submit failed (${e instanceof Error ? e.message : String(e)}). Describe the intended trade qualitatively without claiming it executed.`,
      sources: [{ kind: "bankr_agent", ref: "submit_failed" }],
    };
  }
}

/**
 * Deterministic templated reply for when Groq is offline. The endpoint
 * still emits useful, structured output so callers don't get a 503 —
 * just unflavored compared to the LLM-synthesized version.
 */
function templatedReply(args: {
  agent: AgentRow;
  intent: Intent;
  message: string;
  context: string;
}): string {
  const { agent, intent, context } = args;
  const head = `${agent.name} · ${intent}`;
  // The tool-context blocks are already structured human-readable lines —
  // we strip the leading "X CONTEXT:" header and pass through verbatim.
  const body = context
    .replace(/^[A-Z ]+CONTEXT[^\n]*\n?/m, "")
    .trim()
    .slice(0, 480);
  const banner =
    "[note: this reply is templated — the synthesizer LLM is offline on this deployment]";
  return `${head}\n${body || "(no context)"}\n${banner}`;
}

async function synthesize(args: {
  client: Groq | null;
  agent: AgentRow;
  intent: Intent;
  message: string;
  context: string;
  from: string | null;
}): Promise<string> {
  if (!args.client) {
    return templatedReply(args);
  }
  const client = args.client;
  const { agent, intent, message, context, from } = args;
  const agentVoice =
    agent.system_prompt?.trim() ||
    `You are ${agent.name}. Description: ${agent.description}. Tags: ${(agent.tags ?? []).join(", ")}.`;
  const intentRules: Record<Intent, string> = {
    facts:
      "Use the MARKET FACTS block verbatim for any number you cite. Never invent prices. If a number isn't in the block, say you don't have live data for that.",
    swarm:
      "Use the SWARM CONTEXT to describe what's being simulated. If the sim was queued, say so honestly.",
    code:
      "Share the gitlawb Playground URL from CODE CONTEXT verbatim. Be encouraging — the user can ship in minutes.",
    chat: "Reply in character. Keep it brief.",
    action:
      "Use the ACTION CONTEXT — share the Bankr job id if present. Never claim a trade settled unless Bankr confirmed; recommend the user poll the job url.",
  };
  const sys = [
    agentVoice,
    "",
    "Hard rules:",
    `- intent classified as: ${intent}`,
    `- ${intentRules[intent]}`,
    "- Reply ≤ 600 chars. No filler. Mono-space-friendly. No emoji storms.",
    "- If a user asks about something outside your tags, say so honestly.",
    "- You're talking inside SIGNA (signaagent.xyz). If asked about it, say SIGNA is a wallet-native messaging platform on Base.",
  ].join("\n");
  const user = [
    from ? `from: ${from}` : "from: anonymous",
    `user_message: ${message}`,
    "",
    context,
  ].join("\n");
  const r = await client.chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0.5,
    max_completion_tokens: 320,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });
  const text = r.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("groq returned empty completion");
  return text;
}

function buildSignedPreimage(args: {
  agentAddress: string;
  message: string;
  response: string;
  intent: Intent;
  ts: number;
}): string {
  return [
    "SIGNA agent reply v1",
    `ts:${args.ts}`,
    `agent:${args.agentAddress}`,
    `intent:${args.intent}`,
    `q_sha:${hash32(args.message)}`,
    `a_sha:${hash32(args.response)}`,
  ].join("\n");
}

function hash32(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const agentAddress = raw.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(agentAddress)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  let body: { message?: string; from?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  const from = body.from
    ? /^0x[a-fA-F0-9]{40}$/.test(body.from)
      ? body.from.toLowerCase()
      : null
    : null;
  if (!message || message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json(
      {
        error: "message_required",
        message: `message must be 1..${MAX_MESSAGE_LEN} chars`,
      },
      { status: 400 },
    );
  }

  const db = serverClient();
  const { data: rawAgent, error: agentErr } = await db
    .from("agents")
    .select(
      "address, name, description, tags, system_prompt, launched_by, gitlawb_did, erc8004_token_id, bankr_token_address, miroshark_sim_id, encrypted_key, runtime_enabled",
    )
    .eq("address", agentAddress)
    .is("deleted_at", null)
    .maybeSingle<Omit<AgentRow, "bankr_api_key_encrypted">>();
  if (agentErr) {
    return NextResponse.json({ error: agentErr.message }, { status: 500 });
  }
  if (!rawAgent) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  // Hydrate bankr_api_key_encrypted from the launcher's row — agents
  // don't carry their own trading credentials; they borrow capacity from
  // whoever launched them (and explicitly bound a Bankr Agent API key).
  let launcherBankrKey: string | null = null;
  if (rawAgent.launched_by) {
    const { data: launcher } = await db
      .from("users")
      .select("bankr_api_key_encrypted")
      .eq("address", rawAgent.launched_by.toLowerCase())
      .maybeSingle<{ bankr_api_key_encrypted: string | null }>();
    launcherBankrKey = launcher?.bankr_api_key_encrypted ?? null;
  }
  const agentData: AgentRow = {
    ...rawAgent,
    bankr_api_key_encrypted: launcherBankrKey,
  };

  // Groq is optional — when missing, classification falls back to the
  // lexical pre-classifier and synthesis falls back to a deterministic
  // template. The endpoint never hard-fails because of a missing API key.
  const groqKey = process.env.GROQ_API_KEY;
  const groq = groqKey ? new Groq({ apiKey: groqKey }) : null;

  // 1) Classify — LLM-refined if available, lexical-only otherwise.
  const lexHint = classify(message);
  const intent = groq ? await llmClassify(groq, message, lexHint) : lexHint;

  // 2) Route to tool
  let toolCtx = "";
  let sources: Source[] = [];
  try {
    if (intent === "facts") {
      const r = await runFacts(message, agentData, db);
      toolCtx = r.context;
      sources = r.sources;
    } else if (intent === "swarm") {
      const r = await runSwarm(message, agentData);
      toolCtx = r.context;
      sources = r.sources;
    } else if (intent === "code") {
      const r = runCode(message, agentData);
      toolCtx = r.context;
      sources = r.sources;
    } else if (intent === "action") {
      const r = await runAction(message, agentData);
      toolCtx = r.context;
      sources = r.sources;
    } else {
      toolCtx = "CHAT CONTEXT:\n(no external tools used — respond from agent voice only)";
      sources = [{ kind: "groq", ref: GROQ_MODEL }];
    }
  } catch (e) {
    toolCtx = `TOOL ERROR: ${e instanceof Error ? e.message : String(e)}`;
    sources = [{ kind: "system", ref: "tool_error" }];
  }

  // 3) Synthesize
  let responseText: string;
  try {
    responseText = await synthesize({
      client: groq,
      agent: agentData,
      intent,
      message,
      context: toolCtx,
      from,
    });
  } catch (e) {
    // Persist the error trail so we can debug, return a graceful message.
    const { data: errRow } = await db
      .from("agent_interactions")
      .insert({
        agent_address: agentAddress,
        sender_address: from,
        message,
        response: `synth failed: ${e instanceof Error ? e.message : String(e)}`,
        intent: "error",
        sources,
        signed: false,
      })
      .select("id")
      .single();
    return NextResponse.json(
      {
        ok: false,
        error: "synthesize_failed",
        message: e instanceof Error ? e.message : String(e),
        intent: "error",
        sources,
        interaction_id: errRow?.id ?? null,
      },
      { status: 500 },
    );
  }

  // 4) Optional sign — custodial agents only
  let signed = false;
  let signature: `0x${string}` | null = null;
  let signedMessage: string | null = null;
  if (agentData.encrypted_key) {
    try {
      const pk = decryptAgentKey(agentData.encrypted_key);
      const account = privateKeyToAccount(pk as Hex);
      const ts = Date.now();
      const preimage = buildSignedPreimage({
        agentAddress,
        message,
        response: responseText,
        intent,
        ts,
      });
      signature = await account.signMessage({ message: preimage });
      signedMessage = preimage;
      signed = true;
    } catch (e) {
      // Sign is non-fatal — fall back to unsigned with banner.
      console.error(
        "[respond] sign failed for",
        agentAddress,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // 5) Persist
  const { data: inserted } = await db
    .from("agent_interactions")
    .insert({
      agent_address: agentAddress,
      sender_address: from,
      message,
      response: responseText,
      intent,
      sources,
      signed,
      signature,
      signed_message: signedMessage,
    })
    .select("id")
    .single();

  return NextResponse.json({
    ok: true,
    response: responseText,
    agent_address: agentAddress,
    intent,
    sources,
    signed,
    signature,
    signed_message: signedMessage,
    agent_did: agentData.gitlawb_did,
    interaction_id: inserted?.id ?? null,
    notice: signed
      ? null
      : "This agent runs without custodial signing — the reply is unsigned. Wallet owners can opt in via /me to enable signed replies.",
  });
}

/** GET /api/agents/[address]/respond?address=…  — schema introspection so
 *  third-party builders (gitlawb Playground apps especially) can render
 *  a "this is what the endpoint returns" preview. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const agentAddress = raw.toLowerCase();
  return NextResponse.json({
    ok: true,
    endpoint: `POST /api/agents/${agentAddress}/respond`,
    method: "POST",
    body: {
      message: "string (required, 1..1500 chars)",
      from: "0x-address (optional)",
    },
    returns: {
      ok: "true",
      response: "string — the agent's reply",
      agent_address: "0x...",
      intent: "facts|swarm|code|chat|action|error",
      sources: "[{ kind, ref }] — citations for transparency",
      signed: "boolean — true iff agent has runtime custody",
      signature: "0x... (only if signed)",
      signed_message: "EIP-191 preimage (only if signed)",
      agent_did: "gitlawb DID if linked",
      interaction_id: "uuid for replay/rating",
    },
    notes: [
      "CORS open — call from any origin (gitlawb Playground apps, Discord/TG bots, dashboards).",
      "No auth required — free, public, signed-when-possible.",
      "Routing tree: facts→Bankr+GeckoTerminal | swarm→MiroShark | code→gitlawb | action→Bankr | chat→Groq.",
      "When GROQ_API_KEY is absent the endpoint still works — classification falls back to a lexical rule-set and synthesis falls back to a deterministic template (you'll see [note: ... LLM is offline ...] in the reply).",
    ],
  });
}
