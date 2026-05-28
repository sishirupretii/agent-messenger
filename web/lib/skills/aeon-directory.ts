/**
 * Aeon agent directory (v0.45).
 *
 * Scans the ERC-8004 Identity Registry on Ethereum mainnet for live
 * tokenIds and resolves each one's owner + agentURI metadata in
 * parallel. Cached for 5 minutes so we don't hammer public RPCs.
 *
 * The registry is ERC-721 with deterministic tokenIds starting at 1.
 * Rather than relying on event logs (needs an archive node), we use
 * viem's multicall to read ownerOf(id) for a range of ids and drop
 * the ones that revert (= unminted).
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import {
  IDENTITY_ABI,
  IDENTITY_REGISTRY,
  aeonAgentRegistration,
  type AeonRegistration,
} from "./aeon";

const RPC_URL =
  process.env.ETHEREUM_RPC_URL || "https://ethereum.publicnode.com";

let _client: PublicClient | null = null;
function client(): PublicClient {
  if (!_client) {
    _client = createPublicClient({
      chain: mainnet,
      transport: http(RPC_URL),
    });
  }
  return _client;
}

export type DirectoryEntry = {
  tokenId: number;
  owner: string;
  uri: string;
  name: string | null;
  description: string | null;
  image: string | null;
  serviceCount: number;
  x402Support: boolean;
  active: boolean;
};

type CacheEntry = { ts: number; data: DirectoryEntry[] };
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Scan tokenIds 1..maxScan and return all registered agents.
 *
 * Two-phase:
 *   1. Multicall ownerOf for [1..maxScan]. Failures are unminted → skip.
 *   2. For minted ones, fetch agentURI on-chain + resolve metadata in parallel.
 */
export async function aeonDirectory(
  maxScan = 50,
  force = false,
): Promise<DirectoryEntry[]> {
  if (!force && cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.data;
  }

  const c = client();
  const ids = Array.from({ length: maxScan }, (_, i) => BigInt(i + 1));

  // Multicall ownerOf — viem returns { status, result } per call.
  const ownerResults = await c.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({
      address: IDENTITY_REGISTRY.mainnet,
      abi: IDENTITY_ABI,
      functionName: "ownerOf",
      args: [id],
    })),
  });

  const minted: { tokenId: number; owner: string }[] = [];
  for (let i = 0; i < ownerResults.length; i++) {
    const r = ownerResults[i] as { status: string; result?: unknown };
    if (r.status === "success" && typeof r.result === "string") {
      minted.push({
        tokenId: Number(ids[i]),
        owner: (r.result as string).toLowerCase(),
      });
    }
  }

  // Resolve each minted agent's full registration (uri + parsed JSON).
  // aeonAgentRegistration already handles ipfs/data/https resolution.
  const entries = await Promise.all(
    minted.map(async (m) => {
      const reg = await aeonAgentRegistration(BigInt(m.tokenId), "mainnet");
      const r: AeonRegistration | null = reg?.registration ?? null;
      const entry: DirectoryEntry = {
        tokenId: m.tokenId,
        owner: m.owner,
        uri: reg?.uri ?? "",
        name: r?.name ?? null,
        description: r?.description ?? null,
        image: typeof r?.image === "string" ? r.image : null,
        serviceCount: Array.isArray(r?.services) ? r.services!.length : 0,
        x402Support: !!r?.x402Support,
        active: r?.active !== false,
      };
      return entry;
    }),
  );

  // Sort: x402Support first (paid agents), then by serviceCount, then id.
  entries.sort((a, b) => {
    if (a.x402Support !== b.x402Support) return a.x402Support ? -1 : 1;
    if (a.serviceCount !== b.serviceCount) return b.serviceCount - a.serviceCount;
    return a.tokenId - b.tokenId;
  });

  cache = { ts: Date.now(), data: entries };
  return entries;
}

export function clearAeonDirectoryCache() {
  cache = null;
}
