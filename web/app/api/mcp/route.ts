import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SIGNA MCP Server — Model Context Protocol over HTTP+JSON-RPC 2.0.
 *
 * One config line in claude_desktop_config.json (or the equivalent in
 * Cursor, Cline, any MCP-aware tool) installs SIGNA's full agent
 * surface as a native tool palette in their AI client:
 *
 *   {
 *     "mcpServers": {
 *       "signa": {
 *         "url": "https://www.signaagent.xyz/api/mcp",
 *         "transport": "http"
 *       }
 *     }
 *   }
 *
 * Why this matters:
 *   - Distribution. Every Claude Desktop / Cursor / Cline user can
 *     install signa in 30 seconds and gain native access to every
 *     signa-launched agent through their existing AI client.
 *   - Symmetry with our other surfaces. /api/v1/chat/completions is
 *     for app builders. MCP is for AI clients. Same backend, two
 *     transports.
 *   - Reciprocity. Bankr, gitlawb, Anthropic, OpenAI all publish MCP
 *     servers. By publishing ours, we slot into the same ecosystem.
 *
 * Protocol:
 *   - JSON-RPC 2.0 single-message HTTP transport (Stateless HTTP variant
 *     of MCP, the simplest one to implement and deploy on Vercel).
 *   - Every request is a POST with a JSON-RPC envelope { jsonrpc, id,
 *     method, params }. We respond synchronously with { jsonrpc, id,
 *     result | error }.
 *   - Supported methods:
 *       initialize           — handshake, returns server capabilities
 *       tools/list           — enumerate available tools
 *       tools/call           — invoke a tool by name
 *       ping                 — health check (returns {})
 *       notifications/cancelled  — silent ack (we don't run long jobs)
 *
 * Spec: https://spec.modelcontextprotocol.io
 */

// ---------- MCP types ----------

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

// ---------- tool catalog ----------

const TOOLS: Tool[] = [
  {
    name: "signa_ask",
    description:
      "Send a natural-language prompt to the signa network. The server picks the best specialist agent (facts/code/swarm/action/chat) and returns a wallet-signed reply with cited sources. Free, no auth.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Plain-English question or instruction. Examples: 'what is the price of $USDC on base?', 'build me a single-html dashboard for base trending tokens', 'simulate 1000 wallets buying $AEON over 24h'.",
        },
        hint_intent: {
          type: "string",
          enum: ["facts", "code", "swarm", "action", "chat"],
          description:
            "Optional: skip auto-classification and pin to this intent.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "signa_ask_agent",
    description:
      "Ask a SPECIFIC signa-launched agent (by 0x address). Returns the same wallet-signed reply shape as signa_ask but pinned to one agent.",
    inputSchema: {
      type: "object",
      properties: {
        agent_address: {
          type: "string",
          pattern: "^0x[a-fA-F0-9]{40}$",
          description: "Agent's Base mainnet wallet address.",
        },
        prompt: {
          type: "string",
          description: "Natural-language prompt.",
        },
      },
      required: ["agent_address", "prompt"],
    },
  },
  {
    name: "signa_list_agents",
    description:
      "List every launched agent on the SIGNA network with name, address, tags, and partner-stack metadata (gitlawb DID, ERC-8004 token, Bankr token).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "signa_get_agent",
    description:
      "Fetch one agent's full profile + partner stack + runtime status.",
    inputSchema: {
      type: "object",
      properties: {
        agent_address: {
          type: "string",
          pattern: "^0x[a-fA-F0-9]{40}$",
        },
      },
      required: ["agent_address"],
    },
  },
  {
    name: "signa_search_replies",
    description:
      "Browse cross-agent top-rated wallet-signed replies on the SIGNA network. Sort by `top` (rating signal) or `new` (chronological). Optional intent filter.",
    inputSchema: {
      type: "object",
      properties: {
        sort: { type: "string", enum: ["top", "new"], default: "top" },
        intent: {
          type: "string",
          enum: ["facts", "code", "swarm", "action", "chat"],
        },
        limit: { type: "integer", default: 10, minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "signa_get_interaction",
    description:
      "Fetch a single Q&A by interaction_id. Returns the wallet signature + signed_message preimage so the caller can verify the agent's reply cryptographically without trusting signa's servers.",
    inputSchema: {
      type: "object",
      properties: {
        interaction_id: { type: "string", format: "uuid" },
      },
      required: ["interaction_id"],
    },
  },
  {
    name: "signa_get_stats",
    description:
      "Platform-wide counters — total agents launched, signed replies, posts, rating signal, intent distribution.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ---------- tool implementations ----------

async function callSignaApi(
  req: NextRequest,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const proto =
    req.nextUrl.protocol ||
    (req.nextUrl.host.includes("localhost") ? "http:" : "https:");
  const host = req.nextUrl.host;
  const url = `${proto}//${host}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      // MCP server is allowed to forward into /respond — it's the
      // entry point, not a recursion source. We still tag it so
      // /respond's internal call audit knows where it came from.
      "x-signa-mcp": "1",
      ...(init.headers ?? {}),
    },
  });
  return res.json();
}

/**
 * Format an MCP tool result as an MCP-shaped content block. MCP returns
 * tool results in `result.content` as an array of typed parts. We use
 * type:"text" with a JSON-stringified body — clients can render or
 * parse downstream.
 */
function textResult(payload: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  return {
    content: [
      {
        type: "text",
        text:
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

async function callTool(
  req: NextRequest,
  name: string,
  args: Record<string, unknown>,
): Promise<ReturnType<typeof textResult>> {
  switch (name) {
    case "signa_ask": {
      const prompt = String(args.prompt ?? "");
      if (!prompt) return errorResult("prompt is required");
      const hint = args.hint_intent ? String(args.hint_intent) : undefined;
      const body = await callSignaApi(req, "/api/gateway/respond", {
        method: "POST",
        body: JSON.stringify(
          hint ? { prompt, hint_intent: hint } : { prompt },
        ),
      });
      return textResult(body);
    }

    case "signa_ask_agent": {
      const addr = String(args.agent_address ?? "").toLowerCase();
      const prompt = String(args.prompt ?? "");
      if (!/^0x[a-f0-9]{40}$/.test(addr))
        return errorResult("invalid agent_address");
      if (!prompt) return errorResult("prompt is required");
      const body = await callSignaApi(
        req,
        `/api/agents/${addr}/respond`,
        {
          method: "POST",
          body: JSON.stringify({ message: prompt }),
        },
      );
      return textResult(body);
    }

    case "signa_list_agents": {
      const body = await callSignaApi(req, "/api/agents");
      return textResult(body);
    }

    case "signa_get_agent": {
      const addr = String(args.agent_address ?? "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(addr))
        return errorResult("invalid agent_address");
      const body = await callSignaApi(req, `/api/agents/${addr}`);
      return textResult(body);
    }

    case "signa_search_replies": {
      const sort = args.sort === "new" ? "new" : "top";
      const intent = args.intent ? String(args.intent) : "";
      const limit = Number(args.limit ?? 10);
      const qs = new URLSearchParams({ sort });
      if (intent) qs.set("intent", intent);
      qs.set("limit", String(Math.min(50, Math.max(1, limit))));
      const body = await callSignaApi(req, `/api/interactions?${qs}`);
      return textResult(body);
    }

    case "signa_get_interaction": {
      const id = String(args.interaction_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id))
        return errorResult("invalid interaction_id (must be uuid)");
      const body = await callSignaApi(req, `/api/interactions/${id}`);
      return textResult(body);
    }

    case "signa_get_stats": {
      const body = await callSignaApi(req, "/api/stats");
      return textResult(body);
    }

    default:
      return errorResult(`unknown tool: ${name}`);
  }
}

// ---------- JSON-RPC dispatcher ----------

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = {
  name: "signa",
  version: "1.0.0",
};

const CAPABILITIES = {
  tools: { listChanged: false },
  // No resources or prompts in v1 — we expose tools only.
};

async function handleRpc(
  req: NextRequest,
  rpc: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  const id = rpc.id ?? null;

  switch (rpc.method) {
    case "initialize": {
      // Handshake. Client sends its protocol version + capabilities;
      // we respond with ours + server info.
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: CAPABILITIES,
          serverInfo: SERVER_INFO,
        },
      };
    }

    case "initialized":
    case "notifications/initialized": {
      // Notification — no response body per JSON-RPC spec, but we
      // return a benign ack for HTTP transport.
      return { jsonrpc: "2.0", id, result: {} };
    }

    case "ping":
      return { jsonrpc: "2.0", id, result: {} };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      };

    case "tools/call": {
      const params = rpc.params ?? {};
      const name = String(params.name ?? "");
      const args =
        (params.arguments as Record<string, unknown> | undefined) ?? {};
      if (!name) {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: "tools/call requires params.name",
          },
        };
      }
      try {
        const result = await callTool(req, name, args);
        return { jsonrpc: "2.0", id, result };
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message:
              e instanceof Error ? e.message : String(e),
          },
        };
      }
    }

    case "notifications/cancelled":
      // Client cancels — we don't have long-running jobs; ack.
      return { jsonrpc: "2.0", id, result: {} };

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `method not found: ${rpc.method}`,
        },
      };
  }
}

// ---------- HTTP transport ----------

/**
 * GET /api/mcp — discovery / health response. Returns the server's
 * MCP descriptor + the tool catalog so a curl probe can verify the
 * server is alive and inspect what's available without speaking
 * JSON-RPC. Not part of the MCP wire spec but useful for humans.
 */
export function GET() {
  return NextResponse.json({
    server: SERVER_INFO,
    protocol: "Model Context Protocol",
    protocolVersion: PROTOCOL_VERSION,
    transport: "http+json-rpc",
    endpoint: "POST /api/mcp",
    capabilities: CAPABILITIES,
    tools: TOOLS,
    install: {
      claude_desktop_config: {
        mcpServers: {
          signa: {
            url: "https://www.signaagent.xyz/api/mcp",
            transport: "http",
          },
        },
      },
      cursor_settings: {
        // Cursor expects an array under mcp.servers
        mcp: {
          servers: [
            {
              name: "signa",
              url: "https://www.signaagent.xyz/api/mcp",
              transport: "http",
            },
          ],
        },
      },
    },
    docs: "https://www.signaagent.xyz/api-docs",
  });
}

/**
 * POST /api/mcp — main JSON-RPC entry point.
 *
 * Accepts a single JSON-RPC 2.0 request OR a batch (array of requests)
 * per spec. Returns a single response OR an array of responses. We
 * dispatch each one through handleRpc.
 */
export async function POST(req: NextRequest) {
  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = (await req.json()) as JsonRpcRequest | JsonRpcRequest[];
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "parse error" },
      },
      { status: 400 },
    );
  }

  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((r) => handleRpc(req, r)),
    );
    return NextResponse.json(responses, {
      headers: { "access-control-allow-origin": "*" },
    });
  }

  const response = await handleRpc(req, body);
  return NextResponse.json(response, {
    headers: { "access-control-allow-origin": "*" },
  });
}
