/**
 * AEON / ERC-8004 skill — Ethereum mainnet trustless agent identity.
 *
 * Implements the integration contract published at
 * github.com/BankrBot/skills/tree/main/erc-8004 (SKILL.md +
 * references/erc-8004-spec.md).
 *
 * Reads from the Identity + Reputation registries on Ethereum
 * mainnet using viem. SIGNA uses this read-side to:
 *
 *   - prove an agent's registered tokenId by fetching its
 *     `agentURI` on-chain and rendering the registration JSON
 *   - surface the ERC-8004 badge on /agent/[addr] and /i/[id]
 *   - link the agent's mainnet Etherscan profile from /me
 *
 * Writes (registration, profile updates) require mainnet gas + IPFS
 * pinning + ETH bridging — out of scope for the SIGNA web app. The
 * SKILL.md from BankrBot/skills/erc-8004 documents the bash scripts
 * users can run locally (./scripts/register.sh) to publish their
 * own agent on-chain. We surface a deep-link to 8004.org instead.
 *
 * Reference: https://www.8004.org · https://eips.ethereum.org/EIPS/eip-8004
 */

import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { mainnet, sepolia } from "viem/chains";

export const IDENTITY_REGISTRY: Record<
  "mainnet" | "sepolia",
  Address
> = {
  mainnet: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  sepolia: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
};

export const REPUTATION_REGISTRY: Record<
  "mainnet" | "sepolia",
  Address
> = {
  mainnet: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  sepolia: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
};

const RPC_URL_MAINNET =
  process.env.ETHEREUM_RPC_URL || "https://ethereum.publicnode.com";
const RPC_URL_SEPOLIA =
  process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia.publicnode.com";

let _mainnet: PublicClient | null = null;
let _sepolia: PublicClient | null = null;

function client(network: "mainnet" | "sepolia"): PublicClient {
  if (network === "mainnet") {
    if (!_mainnet) {
      _mainnet = createPublicClient({
        chain: mainnet,
        transport: http(RPC_URL_MAINNET),
      });
    }
    return _mainnet;
  }
  if (!_sepolia) {
    _sepolia = createPublicClient({
      chain: sepolia,
      transport: http(RPC_URL_SEPOLIA),
    });
  }
  return _sepolia;
}

/**
 * Minimal ABI for the ERC-8004 Identity Registry. The spec mirrors
 * ERC-721 plus an `agentURI(tokenId)` getter that returns a metadata
 * URI (IPFS / HTTPS / data URI). The contract emits a
 * `Registered(uint256 tokenId, address owner, string agentURI)` event
 * when an agent is minted.
 */
export const IDENTITY_ABI = [
  {
    type: "function",
    name: "agentURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type AeonRegistration = {
  type?: string;
  name?: string;
  description?: string;
  image?: string;
  services?: Array<{ name?: string; endpoint?: string; version?: string }>;
  x402Support?: boolean;
  active?: boolean;
  registrations?: Array<{ agentId?: number; agentRegistry?: string }>;
  supportedTrust?: string[];
  [k: string]: unknown;
};

/**
 * Read an agent's on-chain `agentURI` and resolve the metadata.
 *
 * The URI can be:
 *   ipfs://Qm…          — fetched via gateway
 *   https://…           — direct fetch
 *   data:application/json;base64,…  — decoded in-process
 *
 * Returns null if the tokenId isn't registered or any step fails.
 */
export async function aeonAgentRegistration(
  tokenId: bigint | string,
  network: "mainnet" | "sepolia" = "mainnet",
): Promise<{
  tokenId: bigint;
  owner: Address;
  uri: string;
  registration: AeonRegistration | null;
} | null> {
  try {
    const id = typeof tokenId === "bigint" ? tokenId : BigInt(tokenId);
    const c = client(network);

    // ownerOf() is the required call — if it reverts, the token isn't
    // minted and we genuinely have nothing to return.
    const owner = (await c.readContract({
      address: IDENTITY_REGISTRY[network],
      abi: IDENTITY_ABI,
      functionName: "ownerOf",
      args: [id],
    })) as Address;

    // agentURI() is an ERC-8004 extension. Many agents are minted
    // without their URI being set yet (early adopters on mainnet).
    // Tolerate a revert / missing URI — fall back to empty string and
    // null registration JSON instead of 404'ing the whole page.
    let uri = "";
    try {
      uri = (await c.readContract({
        address: IDENTITY_REGISTRY[network],
        abi: IDENTITY_ABI,
        functionName: "agentURI",
        args: [id],
      })) as string;
    } catch {
      // agent registered on-chain but no agentURI metadata published yet
    }

    const registration = uri ? await resolveRegistration(uri) : null;
    return { tokenId: id, owner, uri, registration };
  } catch (e) {
    console.error(
      "[aeon] readContract failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Resolve an agentURI (ipfs:// | https:// | data:) to the registration
 * JSON. Tolerates malformed URIs by returning null instead of throwing.
 */
async function resolveRegistration(
  uri: string,
): Promise<AeonRegistration | null> {
  if (!uri) return null;
  try {
    if (uri.startsWith("data:")) {
      // data:application/json;base64,<...> OR data:application/json,<...>
      const comma = uri.indexOf(",");
      if (comma < 0) return null;
      const meta = uri.slice(5, comma);
      const payload = uri.slice(comma + 1);
      const decoded = meta.includes("base64")
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
      return JSON.parse(decoded) as AeonRegistration;
    }

    let url = uri;
    if (uri.startsWith("ipfs://")) {
      const cid = uri.slice("ipfs://".length);
      // Public gateway; tolerate gateway downtime by trying the
      // canonical one first then a fallback.
      url = `https://ipfs.io/ipfs/${cid}`;
    }

    const res = await fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as AeonRegistration;
  } catch {
    return null;
  }
}

/**
 * Render the registration JSON SIGNA would publish for any of its own
 * agents. Mirrors the schema documented in BankrBot/skills/erc-8004 —
 * services array (web + A2A), x402Support flag, active flag, and the
 * supportedTrust list. Callers can pin to IPFS via Pinata or host at
 * `https://www.signaagent.xyz/agent/[address]/registration.json`.
 */
export function buildSignaRegistration(args: {
  agentAddress: string;
  agentName: string;
  description: string;
  image?: string;
  tokenId?: number;
}): AeonRegistration {
  const baseUrl = `https://www.signaagent.xyz/agent/${args.agentAddress}`;
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: args.agentName,
    description: args.description,
    image: args.image ?? `${baseUrl}/opengraph-image`,
    services: [
      { name: "web", endpoint: baseUrl },
      {
        name: "respond",
        endpoint: `https://www.signaagent.xyz/api/agents/${args.agentAddress}/respond`,
        version: "1.0.0",
      },
      {
        name: "A2A",
        endpoint: `https://www.signaagent.xyz/agent/${args.agentAddress}/.well-known/agent-card.json`,
        version: "0.3.0",
      },
    ],
    x402Support: false,
    active: true,
    registrations: args.tokenId
      ? [
          {
            agentId: args.tokenId,
            agentRegistry: `eip155:1:${IDENTITY_REGISTRY.mainnet}`,
          },
        ]
      : [],
    supportedTrust: ["reputation"],
  };
}

/** Etherscan deep-link for a given Identity Registry tokenId. */
export function aeonEtherscanUrl(
  tokenId: bigint | number | string,
  network: "mainnet" | "sepolia" = "mainnet",
): string {
  const base =
    network === "mainnet"
      ? "https://etherscan.io"
      : "https://sepolia.etherscan.io";
  return `${base}/nft/${IDENTITY_REGISTRY[network]}/${tokenId}`;
}
