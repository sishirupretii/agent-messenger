import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { buildSignaRegistration } from "@/lib/skills/aeon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /agent/[address]/registration.json
 *
 * The ERC-8004 (AEON Trustless Agents) registration document for one
 * signa agent. Compliant with the schema documented at
 * github.com/BankrBot/skills/tree/main/erc-8004 — agentURI on the
 * Identity Registry can point here directly (no IPFS pinning needed
 * for v1).
 *
 * Hosting the registration JSON at the canonical signa URL means an
 * agent owner can register on-chain by:
 *
 *   1. visiting https://www.8004.org with REGISTRATION_URL set to
 *      https://www.signaagent.xyz/agent/{address}/registration.json
 *   2. paying gas on Ethereum mainnet (~$5-20)
 *   3. coming back to signa with the resulting tokenId — we record it
 *      in agents.erc8004_token_id and the agent card surfaces it
 *
 * This way SIGNA carries the metadata-hosting weight and the user
 * only signs the on-chain tx. No Pinata JWT, no IPFS infra on our end.
 *
 * Reference: https://www.8004.org · https://eips.ethereum.org/EIPS/eip-8004
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
      "address, name, description, tags, erc8004_token_id, x402_price_usdc, x402_pay_to, x402_currency, x402_chain",
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

  const reg = buildSignaRegistration({
    agentAddress: agent.address,
    agentName: agent.name,
    description: agent.description,
    tokenId: agent.erc8004_token_id
      ? Number(agent.erc8004_token_id)
      : undefined,
  });

  // If the agent has x402 pricing set, flip the flag in the
  // registration JSON so A2A / 8004 clients know payment is required.
  if (agent.x402_price_usdc != null && Number(agent.x402_price_usdc) > 0) {
    reg.x402Support = true;
    (reg as { x402Pricing?: unknown }).x402Pricing = {
      price: Number(agent.x402_price_usdc),
      currency: agent.x402_currency ?? "USDC",
      chain: agent.x402_chain ?? "base",
      pay_to: agent.x402_pay_to ?? agent.address,
      endpoint: `https://www.signaagent.xyz/api/agents/${address}/respond`,
    };
  }

  return NextResponse.json(reg, {
    headers: {
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}
