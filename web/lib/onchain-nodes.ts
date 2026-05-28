/**
 * SignaNodeRegistry reader (v0.56).
 *
 * Reads the live registry on Base mainnet at
 * 0x4316De3847629705C401F8FaF0cecdb40bd68E5A — the same contract the
 * federation cron at /api/cron/sync-nodes pulls peer URLs from.
 *
 * Used by /nodes UI to render every federated SIGNA node, plus an
 * optional liveness check against each node's /api/node/info endpoint.
 *
 * The contract is permissionless: any wallet can register a node URL.
 * The CLI cross-verifies each peer by hitting <url>/api/node/info and
 * confirming the on-chain operator address matches what the JSON
 * declares — that prevents URL squatting attacks.
 */
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";

export const SIGNA_NODE_REGISTRY: Address =
  "0x4316De3847629705C401F8FaF0cecdb40bd68E5A";

export const NODE_REGISTRY_ABI = [
  {
    type: "function",
    name: "listActiveNodes",
    stateMutability: "view",
    inputs: [
      { name: "start", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [
      {
        name: "page",
        type: "tuple[]",
        components: [
          { name: "operator", type: "address" },
          { name: "name", type: "string" },
          { name: "url", type: "string" },
          { name: "version", type: "string" },
          { name: "registeredAt", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "listNodes",
    stateMutability: "view",
    inputs: [
      { name: "start", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [
      {
        name: "page",
        type: "tuple[]",
        components: [
          { name: "operator", type: "address" },
          { name: "name", type: "string" },
          { name: "url", type: "string" },
          { name: "version", type: "string" },
          { name: "registeredAt", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "totalOperators",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "activeCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type FederatedNode = {
  operator: string;
  name: string;
  url: string;
  version: string;
  registeredAt: number;
  updatedAt: number;
  active: boolean;
};

function client() {
  return createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });
}

type CacheEntry = {
  ts: number;
  nodes: FederatedNode[];
  total: number;
  active: number;
};
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60 * 1000;

export async function listFederatedNodes(
  includeInactive = false,
  limit = 100,
): Promise<{ nodes: FederatedNode[]; total: number; active: number }> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return {
      nodes: includeInactive
        ? cache.nodes
        : cache.nodes.filter((n) => n.active),
      total: cache.total,
      active: cache.active,
    };
  }

  const c = client();
  try {
    const [pageAll, total, active] = await Promise.all([
      c.readContract({
        address: SIGNA_NODE_REGISTRY,
        abi: NODE_REGISTRY_ABI,
        functionName: "listNodes",
        args: [0n, BigInt(limit)],
      }) as Promise<
        readonly {
          operator: `0x${string}`;
          name: string;
          url: string;
          version: string;
          registeredAt: bigint;
          updatedAt: bigint;
          active: boolean;
        }[]
      >,
      c.readContract({
        address: SIGNA_NODE_REGISTRY,
        abi: NODE_REGISTRY_ABI,
        functionName: "totalOperators",
        args: [],
      }) as Promise<bigint>,
      c.readContract({
        address: SIGNA_NODE_REGISTRY,
        abi: NODE_REGISTRY_ABI,
        functionName: "activeCount",
        args: [],
      }) as Promise<bigint>,
    ]);

    const nodes: FederatedNode[] = pageAll.map((n) => ({
      operator: String(n.operator).toLowerCase(),
      name: n.name,
      url: n.url,
      version: n.version,
      registeredAt: Number(n.registeredAt),
      updatedAt: Number(n.updatedAt),
      active: n.active,
    }));

    cache = {
      ts: Date.now(),
      nodes,
      total: Number(total),
      active: Number(active),
    };
    return {
      nodes: includeInactive ? nodes : nodes.filter((n) => n.active),
      total: Number(total),
      active: Number(active),
    };
  } catch (e) {
    console.error(
      "[onchain-nodes] read failed:",
      e instanceof Error ? e.message : e,
    );
    return { nodes: [], total: 0, active: 0 };
  }
}

/**
 * Liveness probe: fetch <url>/api/node/info and confirm the JSON's
 * operator matches the on-chain operator. Used by the UI to surface
 * which federated nodes are reachable.
 */
export async function probeNode(
  node: FederatedNode,
  timeoutMs = 4000,
): Promise<{
  reachable: boolean;
  operator_match: boolean | null;
  reported_version: string | null;
  latency_ms: number | null;
  error?: string;
}> {
  const url = node.url.replace(/\/$/, "") + "/api/node/info";
  const started = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) {
      return {
        reachable: false,
        operator_match: null,
        reported_version: null,
        latency_ms: Date.now() - started,
        error: `HTTP ${res.status}`,
      };
    }
    const j = (await res.json().catch(() => ({}))) as {
      operator?: string;
      version?: string;
    };
    const operator_match =
      typeof j.operator === "string"
        ? j.operator.toLowerCase() === node.operator
        : null;
    return {
      reachable: true,
      operator_match,
      reported_version: j.version ?? null,
      latency_ms: Date.now() - started,
    };
  } catch (e) {
    return {
      reachable: false,
      operator_match: null,
      reported_version: null,
      latency_ms: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
