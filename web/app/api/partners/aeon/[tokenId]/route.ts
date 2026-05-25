import { NextRequest, NextResponse } from "next/server";
import { aeonAgentRegistration } from "@/lib/skills/aeon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/partners/aeon/[tokenId]?network=mainnet|sepolia
 *
 * Public read. Resolves an ERC-8004 agent identity by tokenId — fetches
 * the agentURI + owner from the on-chain Identity Registry, then
 * resolves the registration JSON (ipfs:// | https:// | data:).
 *
 * Returns:
 *   {
 *     ok: true,
 *     token_id: "12345",
 *     owner: "0x...",
 *     uri: "ipfs://..." | "https://..." | "data:...",
 *     registration: { ...AeonRegistration } | null,
 *     network: "mainnet" | "sepolia",
 *     etherscan_url: "https://etherscan.io/token/..."
 *   }
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-8004
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await params;
  if (!tokenId || !/^\d+$/.test(tokenId)) {
    return NextResponse.json(
      { ok: false, error: "invalid_token_id", hint: "Must be a positive integer" },
      { status: 400, headers: CORS },
    );
  }
  const networkParam = req.nextUrl.searchParams.get("network");
  const network: "mainnet" | "sepolia" = networkParam === "sepolia" ? "sepolia" : "mainnet";

  const reg = await aeonAgentRegistration(BigInt(tokenId), network);
  if (!reg) {
    return NextResponse.json(
      { ok: false, error: "not_found", hint: `Token ${tokenId} not registered on ${network}` },
      { status: 404, headers: CORS },
    );
  }

  const etherscanBase = network === "mainnet" ? "https://etherscan.io" : "https://sepolia.etherscan.io";
  // Identity Registry contract address — etherscan token page
  const REG = network === "mainnet"
    ? "0x..." // resolved at runtime from IDENTITY_REGISTRY in skill
    : "0x...";

  return NextResponse.json(
    {
      ok: true,
      token_id: reg.tokenId.toString(),
      owner: reg.owner,
      uri: reg.uri,
      registration: reg.registration,
      network,
      etherscan_url: `${etherscanBase}/nft/${reg.tokenId.toString()}`,
    },
    { status: 200, headers: CORS },
  );
}
