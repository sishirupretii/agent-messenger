/**
 * On-chain room anchor reader (v0.51).
 *
 * Wraps reads against SignaRoomRegistry on Base mainnet. Returns the
 * room anchor for a given slug, or null if the contract isn't deployed
 * yet (env var unset) or the slug was never anchored.
 *
 * Gracefully no-ops when SIGNA_ROOM_REGISTRY_ADDRESS isn't configured —
 * the web app stays fully functional without an anchor while the
 * contract is being deployed.
 */
import { createPublicClient, http, keccak256, toBytes, type Address } from "viem";
import { base } from "viem/chains";

export const ROOM_REGISTRY_ABI = [
  {
    type: "function",
    name: "getAnchor",
    stateMutability: "view",
    inputs: [{ name: "slug", type: "string" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "manifestHash", type: "bytes32" },
          { name: "anchoredAt", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "totalAnchored",
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
  {
    type: "function",
    name: "listAnchors",
    stateMutability: "view",
    inputs: [
      { name: "start", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [
      { name: "slugs", type: "string[]" },
      {
        name: "page",
        type: "tuple[]",
        components: [
          { name: "creator", type: "address" },
          { name: "manifestHash", type: "bytes32" },
          { name: "anchoredAt", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
] as const;

export type RoomAnchor = {
  creator: string;
  manifestHash: string;
  anchoredAt: number;
  updatedAt: number;
  active: boolean;
};

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export function roomRegistryAddress(): Address | null {
  const v = process.env.SIGNA_ROOM_REGISTRY_ADDRESS;
  if (!v) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(v)) return null;
  return v as Address;
}

const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
});

/**
 * Compute the keccak256 manifestHash that matches what the contract
 * expects. Input is the canonical signed_message string from
 * lib/feed-types.ts buildMessageToSign().
 */
export function computeManifestHash(signedMessage: string): `0x${string}` {
  return keccak256(toBytes(signedMessage));
}

/**
 * Get the on-chain anchor for a room slug. Returns null if:
 *   - the contract isn't deployed (env unset)
 *   - the slug was never anchored
 *   - the read failed (RPC down)
 */
export async function getRoomAnchor(slug: string): Promise<RoomAnchor | null> {
  const addr = roomRegistryAddress();
  if (!addr) return null;
  try {
    const result = (await client.readContract({
      address: addr,
      abi: ROOM_REGISTRY_ABI,
      functionName: "getAnchor",
      args: [slug],
    })) as {
      creator: string;
      manifestHash: string;
      anchoredAt: bigint;
      updatedAt: bigint;
      active: boolean;
    };
    // Zero-valued struct = never anchored.
    if (
      result.creator.toLowerCase() === ZERO_ADDR &&
      result.manifestHash === ZERO_HASH
    ) {
      return null;
    }
    return {
      creator: result.creator.toLowerCase(),
      manifestHash: result.manifestHash,
      anchoredAt: Number(result.anchoredAt),
      updatedAt: Number(result.updatedAt),
      active: result.active,
    };
  } catch {
    return null;
  }
}

export async function getAnchorStats(): Promise<{
  total: number;
  active: number;
} | null> {
  const addr = roomRegistryAddress();
  if (!addr) return null;
  try {
    const [total, active] = await Promise.all([
      client.readContract({
        address: addr,
        abi: ROOM_REGISTRY_ABI,
        functionName: "totalAnchored",
        args: [],
      }) as Promise<bigint>,
      client.readContract({
        address: addr,
        abi: ROOM_REGISTRY_ABI,
        functionName: "activeCount",
        args: [],
      }) as Promise<bigint>,
    ]);
    return { total: Number(total), active: Number(active) };
  } catch {
    return null;
  }
}
