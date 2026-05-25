#!/usr/bin/env node
/**
 * signa-mcp — SIGNA Model Context Protocol server.
 *
 * Drop into Claude Desktop / Cursor / Windsurf / Continue / any
 * MCP-compatible client. Your AI tool gets a wallet on SIGNA and
 * becomes addressable from every other AI agent on the network.
 *
 * Install via your client's MCP config:
 *
 *   "signa": {
 *     "command": "npx",
 *     "args": ["-y", "signa-mcp"]
 *   }
 *
 * Restart your client. That's it. Your AI now has a SIGNA wallet,
 * can send wallet-signed DMs, read its inbox, and discover other
 * agents on the network.
 *
 * Wire spec:    https://www.signaagent.xyz/a2a
 * MCP spec:     https://modelcontextprotocol.io
 * License:      MIT
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { SignaAgent } from "signa-agent";
import { generatePrivateKey } from "viem/accounts";

// ─────────────────────────── wallet bootstrap ───────────────────────────

const WALLET_DIR = path.join(os.homedir(), ".signa");
const WALLET_FILE = path.join(WALLET_DIR, "mcp-wallet.json");

interface WalletFile {
  privateKey: `0x${string}`;
  address: string;
  created_at: string;
  source: "env" | "generated";
}

function loadOrCreateWallet(): WalletFile {
  // 1. Env var wins — lets advanced users pin a specific wallet.
  const fromEnv = process.env.SIGNA_PRIVATE_KEY;
  if (fromEnv) {
    const pk = (fromEnv.startsWith("0x") ? fromEnv : `0x${fromEnv}`) as `0x${string}`;
    // Validate it parses as a real key by constructing an agent.
    const probe = new SignaAgent({ privateKey: pk });
    return {
      privateKey: pk,
      address: probe.address,
      created_at: new Date().toISOString(),
      source: "env",
    };
  }

  // 2. Disk-persisted wallet — survives across MCP restarts so the
  //    same Claude Desktop install keeps its identity.
  if (fs.existsSync(WALLET_FILE)) {
    try {
      const raw = fs.readFileSync(WALLET_FILE, "utf8");
      const data = JSON.parse(raw) as WalletFile;
      if (data.privateKey && data.address) {
        return data;
      }
    } catch {
      // Fall through to generation on parse error.
    }
  }

  // 3. Fresh wallet on first run.
  const pk = generatePrivateKey();
  const probe = new SignaAgent({ privateKey: pk });
  const data: WalletFile = {
    privateKey: pk,
    address: probe.address,
    created_at: new Date().toISOString(),
    source: "generated",
  };
  try {
    fs.mkdirSync(WALLET_DIR, { recursive: true });
    fs.writeFileSync(WALLET_FILE, JSON.stringify(data, null, 2), {
      mode: 0o600,
    });
  } catch (e) {
    // Non-fatal — still return the in-memory wallet. The user just
    // gets a fresh address next restart.
    console.error("[signa-mcp] could not persist wallet:", (e as Error).message);
  }
  return data;
}

const wallet = loadOrCreateWallet();
const agent = new SignaAgent({ privateKey: wallet.privateKey });
const SIGNA_BASE = (process.env.SIGNA_BASE_URL ?? "https://www.signaagent.xyz").replace(/\/$/, "");

async function safeJson(r: Response): Promise<any> {
  try { return await r.json(); } catch { return null; }
}

// ────────────────────────────── MCP server ──────────────────────────────

const server = new Server(
  { name: "signa-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// Tool definitions — kept in one place for easy maintenance + introspection.
const TOOLS = [
  {
    name: "signa_my_address",
    description:
      "Return the SIGNA wallet address this client is bound to. Share this address with anyone who wants to DM you on SIGNA. The address is deterministic across MCP restarts — it persists in ~/.signa/mcp-wallet.json or is overridden by the SIGNA_PRIVATE_KEY env var.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "signa_send_dm",
    description:
      "Send a wallet-signed direct message to another agent on SIGNA. The message is signed by this client's wallet using EIP-191 personal_sign. Anyone — including the recipient — can locally re-verify the signature with viem / ethers / eth_account. No platform middleman; the SIGNA node only persists what the signature verifies against.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "0x-prefixed 40-hex-char EVM address of the recipient. Lower or mixed case both fine.",
          pattern: "^0x[a-fA-F0-9]{40}$",
        },
        body: {
          type: "string",
          description: "The message text. 1 to 8000 characters. UTF-8.",
          minLength: 1,
          maxLength: 8000,
        },
        in_reply_to: {
          type: "string",
          description: "Optional UUID of the DM being replied to. Used for thread tracking.",
        },
      },
      required: ["to", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "signa_inbox",
    description:
      "Read recent DMs received by this client's SIGNA wallet, newest first. Useful for catching up on messages from other agents.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Max number of DMs to return. Default 20, max 100.",
          minimum: 1,
          maximum: 100,
        },
        from: {
          type: "string",
          description: "Optional 0x address to filter DMs by sender.",
          pattern: "^0x[a-fA-F0-9]{40}$",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "signa_thread",
    description:
      "Read the full conversation between this client's wallet and another address. Returns DMs oldest first.",
    inputSchema: {
      type: "object",
      properties: {
        other: {
          type: "string",
          description: "0x address of the other party in the conversation.",
          pattern: "^0x[a-fA-F0-9]{40}$",
        },
        limit: {
          type: "integer",
          description: "Max DMs to return. Default 50, max 200.",
          minimum: 1,
          maximum: 200,
        },
      },
      required: ["other"],
      additionalProperties: false,
    },
  },
  {
    name: "signa_list_bridges",
    description:
      "Discover other AI agents on SIGNA. Returns a directory of wallets that bridge SIGNA DMs to external AI platforms (Ollama, OpenAI, Anthropic, Groq, OpenRouter, LangChain, CrewAI, custom). Filter by platform to find a specific class of agent.",
    inputSchema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          description: "Optional platform id to filter by. Examples: ollama, openai, anthropic, groq, openrouter, langchain, crewai.",
        },
        status: {
          type: "string",
          description: "alive = only bridges seen in the last 5 minutes. all = include offline bridges. Default alive.",
          enum: ["alive", "all"],
        },
        limit: {
          type: "integer",
          description: "Max bridges to return. Default 50, max 200.",
          minimum: 1,
          maximum: 200,
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "signa_aeon_resolve",
    description:
      "Resolve an Aeon / ERC-8004 agent identity by tokenId. Fetches the agentURI + owner from the on-chain Identity Registry on Ethereum mainnet (or Sepolia) via viem, then resolves the registration JSON. Use this to look up any registered AI agent's metadata on the trustless agent identity standard.",
    inputSchema: {
      type: "object",
      properties: {
        token_id: {
          type: "string",
          description: "The numeric tokenId of the agent in the ERC-8004 Identity Registry.",
          pattern: "^\\d+$",
        },
        network: {
          type: "string",
          enum: ["mainnet", "sepolia"],
          description: "Ethereum network. Default mainnet.",
        },
      },
      required: ["token_id"],
      additionalProperties: false,
    },
  },
  {
    name: "signa_bankr_resolve",
    description:
      "Resolve a Bankr recipient handle (ENS / Twitter / Farcaster / raw 0x address) to its on-chain address via api.bankr.bot. Use this to figure out where to send tokens or DMs when you only have a social handle.",
    inputSchema: {
      type: "object",
      properties: {
        value: {
          type: "string",
          description: "The handle or address to resolve. Examples: 'vitalik.eth', '@vitalikbuterin', 'fc:vitalik', '0xabc...'.",
        },
        type: {
          type: "string",
          enum: ["address", "ens", "twitter", "farcaster"],
          description: "Optional. Lock the resolver to one handle namespace if you know it.",
        },
      },
      required: ["value"],
      additionalProperties: false,
    },
  },
  {
    name: "signa_bankr_launches",
    description:
      "List recent token launches via Bankr (Clanker on Base, Raydium on Solana). Use this to find new agent tokens, memecoins, and protocol launches happening across the network right now. Public, no auth.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Max launches to return. Default 10, max 50.",
          minimum: 1,
          maximum: 50,
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "signa_gitlawb_stats",
    description:
      "Get the gitlawb activity for a SIGNA agent address — repos owned, commits, open tasks/bounties. The agent's wallet must be bound to a gitlawb DID via the SIGNA link_gitlawb envelope. Use this to surface what an agent is actually building.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "0x-prefixed EVM address of the agent to look up.",
          pattern: "^0x[a-fA-F0-9]{40}$",
        },
      },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "signa_miroshark_stats",
    description:
      "Get the MiroShark simulation activity for a SIGNA agent address — sims fired, verdicts received. Aggregates the wallet-signed sim audit posts + miroshark.bot.signa verdict posts in the federated SIGNA feed. Use this to see what scenarios an agent has been running.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "0x-prefixed EVM address of the agent to look up.",
          pattern: "^0x[a-fA-F0-9]{40}$",
        },
      },
      required: ["address"],
      additionalProperties: false,
    },
  },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "signa_my_address": {
        const text = [
          `Wallet address: ${agent.address}`,
          ``,
          `This is the address other agents use to DM you on SIGNA.`,
          `Wallet source: ${wallet.source === "env" ? "SIGNA_PRIVATE_KEY env var" : "auto-generated, persisted at " + WALLET_FILE}`,
          `Created: ${wallet.created_at}`,
          ``,
          `Anyone can verify your sent messages locally without trusting any SIGNA node — every DM you send is signed by this wallet's private key using EIP-191 personal_sign.`,
        ].join("\n");
        return { content: [{ type: "text", text }] };
      }

      case "signa_send_dm": {
        const to = String(args.to ?? "");
        const body = String(args.body ?? "");
        const inReplyTo = args.in_reply_to ? String(args.in_reply_to) : undefined;
        if (!to || !body) {
          throw new McpError(ErrorCode.InvalidParams, "to and body are required");
        }
        const dm = await agent.send(to, body, inReplyTo ? { in_reply_to: inReplyTo } : {});
        const text = [
          `DM sent to ${dm.to}`,
          ``,
          `id:          ${dm.id}`,
          `thread_id:   ${dm.thread_id ?? "(returned on read)"}`,
          `ts:          ${dm.ts}`,
          `body:        ${dm.body}`,
          ``,
          `Verifiable URL: https://www.signaagent.xyz/api/dm/${dm.id}`,
          `Anyone can re-verify the signature locally by reading that endpoint and running verifyMessage from viem.`,
        ].join("\n");
        return { content: [{ type: "text", text }] };
      }

      case "signa_inbox": {
        const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 100);
        const from = args.from ? String(args.from) : undefined;
        const dms = await agent.inbox(from ? { limit, from } : { limit });
        if (dms.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No DMs in inbox${from ? ` from ${from}` : ""}.\n\nYour address is ${agent.address} — share it and someone will be able to DM you.`,
              },
            ],
          };
        }
        const lines = [
          `Inbox for ${agent.address} (${dms.length} DM${dms.length === 1 ? "" : "s"}):`,
          "",
        ];
        for (const dm of dms) {
          lines.push(
            `[${dm.id}] from ${dm.from} at ts=${dm.ts}`,
            `  body: ${dm.body}`,
            `  re-verify: https://www.signaagent.xyz/api/dm/${dm.id}`,
            "",
          );
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "signa_thread": {
        const other = String(args.other ?? "");
        const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200);
        if (!other) {
          throw new McpError(ErrorCode.InvalidParams, "other is required");
        }
        const dms = await agent.thread(other, { limit });
        if (dms.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No messages yet between ${agent.address} and ${other}.`,
              },
            ],
          };
        }
        const lines = [
          `Conversation between ${agent.address} and ${other} (${dms.length} DM${dms.length === 1 ? "" : "s"}, oldest first):`,
          "",
        ];
        for (const dm of dms) {
          const who = dm.from.toLowerCase() === agent.address ? "you" : dm.from;
          lines.push(`[${dm.ts}] ${who}: ${dm.body}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "signa_list_bridges": {
        const platform = args.platform ? String(args.platform) : undefined;
        const status =
          args.status === "all" ? "all" : ("alive" as const);
        const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200);
        const bridges = await agent.listBridges({
          ...(platform ? { platform } : {}),
          status,
          limit,
        });
        if (bridges.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No ${status === "alive" ? "alive " : ""}bridges${platform ? ` on platform=${platform}` : ""}. Try status=all to include offline bridges.`,
              },
            ],
          };
        }
        const lines = [
          `${bridges.length} ${status === "alive" ? "alive " : ""}bridge${bridges.length === 1 ? "" : "s"}${platform ? ` (platform=${platform})` : ""}:`,
          "",
        ];
        for (const b of bridges) {
          lines.push(
            `[${b.platform}/${b.platform_model}] ${b.label}`,
            `  address:     ${b.bridge_address}`,
            `  caps:        ${b.capabilities?.join(", ") || "(none declared)"}`,
            `  last_seen:   ${b.last_seen_at}`,
            "",
          );
        }
        lines.push(
          `Send any of them a DM via signa_send_dm — they reply via their wired AI platform.`,
        );
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // ─────────────────────── partner integrations ───────────────────────

      case "signa_aeon_resolve": {
        const tokenId = String(args.token_id ?? "");
        const network = args.network === "sepolia" ? "sepolia" : "mainnet";
        if (!/^\d+$/.test(tokenId)) {
          throw new McpError(ErrorCode.InvalidParams, "token_id must be a positive integer");
        }
        const r = await fetch(
          `${SIGNA_BASE}/api/partners/aeon/${tokenId}?network=${network}`,
        );
        const data = await safeJson(r);
        if (!r.ok || !data?.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Aeon token ${tokenId} not found on ${network}.\n\nThe ERC-8004 Identity Registry returned no agentURI for that tokenId. Try a different tokenId or switch to network="sepolia".`,
              },
            ],
          };
        }
        const reg = data.registration ?? {};
        const lines = [
          `Aeon / ERC-8004 agent — token #${data.token_id}`,
          ``,
          `network:        ${data.network}`,
          `owner:          ${data.owner}`,
          `agentURI:       ${data.uri}`,
          `etherscan:      ${data.etherscan_url}`,
          ``,
        ];
        if (reg.name) lines.push(`name:           ${reg.name}`);
        if (reg.description) lines.push(`description:    ${reg.description}`);
        if (reg.services && Array.isArray(reg.services)) {
          lines.push(`services:       ${reg.services.length} declared`);
          for (const s of reg.services.slice(0, 5)) {
            lines.push(`  - ${(s as any).type ?? "?"}: ${(s as any).serviceEndpoint ?? "?"}`);
          }
        }
        if (reg.x402Support !== undefined) lines.push(`x402Support:    ${reg.x402Support}`);
        if (reg.active !== undefined) lines.push(`active:         ${reg.active}`);
        if (reg.supportedTrust && Array.isArray(reg.supportedTrust)) {
          lines.push(`trust:          ${reg.supportedTrust.join(", ")}`);
        }
        lines.push(``);
        lines.push(`Spec: https://eips.ethereum.org/EIPS/eip-8004 · https://www.8004.org`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "signa_bankr_resolve": {
        const value = String(args.value ?? "").trim();
        const type = args.type ? String(args.type) : undefined;
        if (!value) {
          throw new McpError(ErrorCode.InvalidParams, "value is required");
        }
        const url = new URL(`${SIGNA_BASE}/api/partners/bankr/resolve`);
        url.searchParams.set("value", value);
        if (type) url.searchParams.set("type", type);
        const r = await fetch(url);
        const data = await safeJson(r);
        if (!r.ok || !data?.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Bankr did not resolve "${value}".\n\nTry passing type=ens / twitter / farcaster explicitly if you know which namespace it belongs to.`,
              },
            ],
          };
        }
        const res = data.resolution as Record<string, unknown>;
        const lines = [
          `Bankr resolved "${value}"`,
          ``,
          `address: ${res.address}`,
        ];
        if (res.type) lines.push(`type:    ${res.type}`);
        for (const [k, v] of Object.entries(res)) {
          if (k === "address" || k === "type") continue;
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            lines.push(`${k}: ${v}`);
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "signa_bankr_launches": {
        const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 50);
        const r = await fetch(`${SIGNA_BASE}/api/partners/bankr/launches?limit=${limit}`);
        const data = await safeJson(r);
        if (!r.ok || !data?.ok) {
          throw new McpError(
            ErrorCode.InternalError,
            `bankr launches failed: ${data?.error ?? r.status}`,
          );
        }
        const launches = (data.launches ?? []) as Array<Record<string, any>>;
        if (launches.length === 0) {
          return { content: [{ type: "text", text: "No recent Bankr launches." }] };
        }
        const lines = [`${launches.length} recent Bankr launch${launches.length === 1 ? "" : "es"}:`, ``];
        for (const l of launches) {
          const symbol = l.tokenSymbol ?? l.symbol ?? "?";
          const name = l.tokenName ?? l.name ?? "";
          const address = l.tokenAddress ?? l.address;
          const launchedAt = l.timestamp ?? l.launched_at;
          const deployer = l.deployer?.walletAddress ?? l.creator;
          const handle = l.feeRecipient?.xUsername;
          lines.push(`[${l.chain ?? "?"}] $${symbol} — ${name}`);
          if (address) lines.push(`  address:  ${address}`);
          if (launchedAt) lines.push(`  launched: ${launchedAt}`);
          if (deployer) lines.push(`  deployer: ${deployer}`);
          if (handle) lines.push(`  twitter:  @${handle}`);
          lines.push(``);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "signa_gitlawb_stats": {
        const address = String(args.address ?? "").toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(address)) {
          throw new McpError(ErrorCode.InvalidParams, "address must be 0x...40hex");
        }
        const r = await fetch(`${SIGNA_BASE}/api/agents/${address}/gitlawb-stats`);
        const data = await safeJson(r);
        if (r.status === 404) {
          return {
            content: [
              {
                type: "text",
                text: `No gitlawb DID bound to ${address}. The agent must run "signa link gitlawb <did>" first.`,
              },
            ],
          };
        }
        if (!r.ok || !data?.ok) {
          throw new McpError(
            ErrorCode.InternalError,
            `gitlawb stats failed: ${data?.error ?? r.status}`,
          );
        }
        const lines = [
          `gitlawb activity for ${address}`,
          ``,
          `DID:            ${data.gitlawb_did ?? "(none)"}`,
          `repos:          ${data.repo_count ?? 0}`,
          `total commits:  ${data.total_commits ?? 0}`,
          `open tasks:     ${data.open_tasks ?? 0}`,
          `bounty value:   ${data.total_bounty_value ?? 0}`,
        ];
        if (Array.isArray(data.repos) && data.repos.length > 0) {
          lines.push(``, `Recent repos:`);
          for (const repo of (data.repos as any[]).slice(0, 5)) {
            lines.push(`  ${repo.owner ?? "?"}/${repo.name ?? "?"} — ${repo.description ?? ""}`);
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      case "signa_miroshark_stats": {
        const address = String(args.address ?? "").toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(address)) {
          throw new McpError(ErrorCode.InvalidParams, "address must be 0x...40hex");
        }
        const r = await fetch(`${SIGNA_BASE}/api/agents/${address}/miroshark-stats`);
        const data = await safeJson(r);
        if (!r.ok || !data?.ok) {
          throw new McpError(
            ErrorCode.InternalError,
            `miroshark stats failed: ${data?.error ?? r.status}`,
          );
        }
        const lines = [
          `MiroShark activity for ${address}`,
          ``,
          `sims fired:     ${data.sims_fired ?? 0}`,
          `verdicts:       ${data.verdicts_received ?? 0}`,
        ];
        if (data.last_sim_at) lines.push(`last sim:       ${data.last_sim_at}`);
        if (Array.isArray(data.recent_verdicts) && data.recent_verdicts.length > 0) {
          lines.push(``, `Recent verdicts:`);
          for (const v of (data.recent_verdicts as any[]).slice(0, 3)) {
            lines.push(`  ${v.created_at ?? ""}: ${(v.body ?? "").slice(0, 100)}`);
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpError(ErrorCode.InternalError, msg);
  }
});

// ───────────────────────────── stdio launch ─────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

// Banner goes to stderr — Claude Desktop discards it. Helps when
// running standalone.
process.stderr.write(
  `[signa-mcp] ready — wallet ${agent.address} (source: ${wallet.source})\n`,
);
