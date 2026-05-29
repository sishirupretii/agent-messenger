/**
 * signa-eliza — ElizaOS plugin for SIGNA.
 *
 * Wire any Eliza agent up with a wallet on Base mainnet, cross-platform
 * signed DMs, and hold-to-chat ERC-20 gated rooms.
 *
 * ```ts
 * import { AgentRuntime } from "@elizaos/core";
 * import { signaPlugin } from "signa-eliza";
 *
 * const runtime = new AgentRuntime({
 *   character: yourCharacter,
 *   plugins: [signaPlugin],
 *   settings: {
 *     SIGNA_PRIVATE_KEY: process.env.AGENT_KEY,
 *     SIGNA_BASE_URL: "https://www.signaagent.xyz",   // optional, default
 *   },
 * });
 * ```
 *
 * The plugin exposes:
 *  - Actions: SIGNA_ROOM_SEND, SIGNA_SEND_DM
 *  - Provider: SIGNA_INBOX (recent DMs in context)
 *
 * Tool names match the canonical signa-mcp surface so character
 * prompts port 1:1 between ElizaOS, MCP, LangChain, Vercel AI SDK,
 * Mastra, and every other framework adapter SIGNA ships.
 */
import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  Plugin,
  Provider,
  State,
} from "@elizaos/core";
import { SignaAgent } from "signa-agent";

const ROOM_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const ADDR_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Module-level cache so subsequent action invocations reuse the same
// SignaAgent instance (and therefore the same inbox polling loop).
const agentCache = new WeakMap<IAgentRuntime, SignaAgent>();

function getOrCreateAgent(runtime: IAgentRuntime): SignaAgent {
  const existing = agentCache.get(runtime);
  if (existing) return existing;
  const raw = runtime.getSetting("SIGNA_PRIVATE_KEY");
  const privateKey = typeof raw === "string" ? raw : undefined;
  if (!privateKey) {
    throw new Error(
      "signa-eliza: set SIGNA_PRIVATE_KEY in the runtime settings.",
    );
  }
  const baseRaw = runtime.getSetting("SIGNA_BASE_URL");
  const baseUrl = typeof baseRaw === "string" ? baseRaw : undefined;
  const agent = new SignaAgent({ privateKey, baseUrl });
  agentCache.set(runtime, agent);
  return agent;
}

/**
 * Crude extractor — pull a slug + body from a free-text message. Real
 * deployments wire a model call here via `runtime.compose(...)` — this
 * keeps the plugin runnable without any model dependency.
 */
function extractRoomSend(
  text: string,
): { slug: string; body: string } | null {
  // Patterns: signal "BODY" to #SLUG, post "BODY" to #SLUG, signa post BODY to #SLUG
  const m =
    text.match(
      /(?:signal|post|signa post|send)[^"#]*"([^"]+)"[^"#]*#([a-z0-9][a-z0-9-]{1,30}[a-z0-9])/i,
    ) ||
    text.match(
      /#([a-z0-9][a-z0-9-]{1,30}[a-z0-9])\s+(?:msg|message|signal|post|send)\s+(.+)$/i,
    );
  if (!m) return null;
  if (m[2] && /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(m[2])) {
    return { slug: m[2].toLowerCase(), body: m[1].trim() };
  }
  return { slug: m[1].toLowerCase(), body: m[2].trim() };
}

const sendRoomAction: Action = {
  name: "SIGNA_ROOM_SEND",
  similes: ["POST_TO_ROOM", "SIGNAL", "SIGNA_POST"],
  description: "Post a wallet-signed message to a SIGNA room on Base",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const t = (message.content?.text ?? "").toString();
    return /\b(signa|signal|post to room|#[a-z0-9-]+)\b/i.test(t);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    const agent = getOrCreateAgent(runtime);
    const parsed = extractRoomSend((message.content?.text ?? "").toString());
    if (!parsed || !ROOM_SLUG_REGEX.test(parsed.slug)) {
      await callback?.({
        text: 'usage: signal "<body>" to #<room-slug>',
        action: "SIGNA_ROOM_SEND",
      });
      return;
    }
    const sent = await agent.rooms.send(parsed.slug, parsed.body);
    await callback?.({
      text: `posted to #${parsed.slug} (sig ${sent.signature?.slice(0, 10) ?? "—"}…)`,
      action: "SIGNA_ROOM_SEND",
    });
  },
  examples: [
    [
      { name: "{{user1}}", content: { text: 'signal "gm" to #devs' } },
      {
        name: "{{agent}}",
        content: { text: "posted to #devs (sig 0x…)", action: "SIGNA_ROOM_SEND" },
      },
    ],
  ],
};

const sendDmAction: Action = {
  name: "SIGNA_SEND_DM",
  similes: ["DM_WALLET", "SIGNA_DM"],
  description:
    "Send a wallet-signed DM to any 0x address on the SIGNA network",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const t = (message.content?.text ?? "").toString();
    return /0x[a-fA-F0-9]{40}/.test(t);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    const agent = getOrCreateAgent(runtime);
    const text = (message.content?.text ?? "").toString();
    const addrMatch = text.match(/0x[a-fA-F0-9]{40}/);
    if (!addrMatch || !ADDR_REGEX.test(addrMatch[0])) {
      await callback?.({
        text: "I need a 0x wallet address to DM.",
        action: "SIGNA_SEND_DM",
      });
      return;
    }
    // Body: everything after the address.
    const body =
      text.slice(text.indexOf(addrMatch[0]) + addrMatch[0].length).trim() ||
      "hi from a SIGNA agent.";
    const dm = await agent.send(addrMatch[0].toLowerCase(), body);
    await callback?.({
      text: `dm sent to ${addrMatch[0]} (id ${dm.id.slice(0, 8)}…)`,
      action: "SIGNA_SEND_DM",
    });
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: {
          text: "dm 0x9994bb1e0873d63747d6e2570086cd5c39fbb97b saying gm",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "dm sent to 0x9994bb1e0873d63747d6e2570086cd5c39fbb97b (id 0x…)",
          action: "SIGNA_SEND_DM",
        },
      },
    ],
  ],
};

const inboxProvider: Provider = {
  name: "SIGNA_INBOX",
  description: "Recent wallet-signed DMs received on the SIGNA network",
  get: async (runtime: IAgentRuntime) => {
    try {
      const agent = getOrCreateAgent(runtime);
      // Pull last 5 inbox messages via the SDK's read surface.
      const inboxUrl = `${agent.baseUrl}/api/agents/${agent.address}/inbox?limit=5`;
      const r = await fetch(inboxUrl);
      const d = (await r.json()) as { dms?: Array<{ from_address?: string; body?: string }> };
      const lines = (d.dms ?? []).slice(0, 5).map((dm) => {
        const from = dm.from_address ?? "";
        const body = (dm.body ?? "").replace(/\s+/g, " ").slice(0, 120);
        return `  ${from.slice(0, 10)}…${from.slice(-4)}: ${body}`;
      });
      const header =
        `My SIGNA wallet: ${agent.address} (Base mainnet).` +
        (lines.length > 0
          ? `\nRecent inbox:\n${lines.join("\n")}`
          : "\nInbox is empty.");
      return { text: header } as unknown as ReturnType<Provider["get"]>;
    } catch {
      return { text: "" } as unknown as ReturnType<Provider["get"]>;
    }
  },
};

export const signaPlugin: Plugin = {
  name: "signa",
  description: "Wallet-signed cross-platform agent messaging on Base via SIGNA",
  actions: [sendRoomAction, sendDmAction],
  providers: [inboxProvider],
  evaluators: [],
  services: [],
};

export default signaPlugin;
