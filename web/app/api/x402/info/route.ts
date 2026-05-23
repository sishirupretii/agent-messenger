import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Revalidate every 5 min — Aaron's network/asset/payTo doesn't change
// often, but when he flips mainnet we want the UI to follow within ~5
// min without a redeploy. Force-dynamic is wrong here; we want caching.
export const revalidate = 300;

/**
 * GET /api/x402/info
 *
 * v0.26.1 chain-agnostic probe. Issues a POST with no payment header
 * against MiroShark's x402 endpoint, parses the 402 challenge, and
 * returns the parameters the client needs to render the right chain
 * switch button + USDC balance check + faucet/onramp link.
 *
 * Why server-side and not browser-side:
 *   - We don't need to fight Aaron's CORS on a probe request. The real
 *     payment call goes browser → Aaron directly (we verified CORS
 *     works for that), but the probe is plain JSON and we'd rather
 *     not depend on a second CORS allowance.
 *   - Next.js fetch revalidate gives us free 5-min caching across all
 *     viewers, so Aaron's server gets pinged ~12x/hr regardless of
 *     traffic.
 *   - If Aaron's server is down or returns a malformed 402, we fall
 *     back to a sane default (Base Sepolia, since that's what his doc
 *     says he serves today). The UI degrades gracefully.
 *
 * Response shape:
 *
 *   {
 *     ok: true,
 *     network:    "eip155:84532" | "eip155:8453",
 *     chain_id:   84532 | 8453,
 *     asset:      "0x...USDC contract",
 *     pay_to:     "0x...Aaron's payTo",
 *     amount:     "1000000" (base units),
 *     chain_label:"Base Sepolia" | "Base",
 *     faucet_url: "https://faucet.circle.com/" | null,
 *     onramp_url: null | "https://www.coinbase.com/...",
 *     probed_at:  ISO string
 *   }
 */

const MIROSHARK_X402_URL =
  process.env.MIROSHARK_X402_URL ||
  "https://miroshark-x402-production.up.railway.app/x402/run";

// Fallback if probe fails / Aaron's server is down — Sepolia, since
// that's his current state per his INTEGRATION.md doc.
const FALLBACK = {
  ok: true as const,
  network: "eip155:84532",
  chain_id: 84532,
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  pay_to: "0x0000ce08fa224696a819877070bf378e8b131acf",
  amount: "1000000",
  chain_label: "Base Sepolia",
  faucet_url: "https://faucet.circle.com/",
  onramp_url: null as string | null,
  probed_at: new Date().toISOString(),
  source: "fallback" as const,
};

function chainLabel(network: string): { label: string; chainId: number } {
  if (network === "eip155:8453") return { label: "Base", chainId: 8453 };
  if (network === "eip155:84532")
    return { label: "Base Sepolia", chainId: 84532 };
  // Future-proof — if Aaron ever serves another EVM chain, show the raw
  // network so at least the wallet switch is targeted.
  const m = /^eip155:(\d+)$/.exec(network);
  if (m) return { label: `chain ${m[1]}`, chainId: Number(m[1]) };
  return { label: network, chainId: 0 };
}

function fundingLinks(chainId: number): {
  faucet: string | null;
  onramp: string | null;
} {
  // Testnet → faucet. Mainnet → onramp.
  if (chainId === 84532) {
    return { faucet: "https://faucet.circle.com/", onramp: null };
  }
  if (chainId === 8453) {
    return {
      faucet: null,
      // Coinbase has a deep-link onramp for Base USDC; leaving a clean
      // user-facing redirect rather than a parameterized one so we
      // don't leak referral info from observed content.
      onramp: "https://www.coinbase.com/onramp/buy/usdc?network=base",
    };
  }
  return { faucet: null, onramp: null };
}

export async function GET() {
  let res: Response;
  try {
    res = await fetch(MIROSHARK_X402_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "x402-info-probe" }),
      // Don't allow Next to follow redirects — we want to read the 402
      // header directly, no transparent re-routing.
      redirect: "manual",
      // Server-side 5-min cache via Next's fetch revalidate.
      next: { revalidate: 300, tags: ["x402-info"] },
    });
  } catch (e) {
    return NextResponse.json(
      { ...FALLBACK, source: "fallback_fetch_threw", error: String(e) },
      { status: 200 },
    );
  }

  // Expect HTTP 402. Anything else means Aaron's server is in an
  // unusual state or has changed protocol — fall back rather than
  // surface a broken UI.
  if (res.status !== 402) {
    return NextResponse.json(
      {
        ...FALLBACK,
        source: "fallback_unexpected_status",
        upstream_status: res.status,
      },
      { status: 200 },
    );
  }

  // The 402 challenge ships in the PAYMENT-REQUIRED header (base64
  // JSON) per Aaron's INTEGRATION.md spec.
  const required = res.headers.get("payment-required");
  if (!required) {
    return NextResponse.json(
      { ...FALLBACK, source: "fallback_missing_required_header" },
      { status: 200 },
    );
  }

  let parsed: {
    accepts?: Array<{
      network?: string;
      asset?: string;
      amount?: string;
      payTo?: string;
    }>;
  };
  try {
    parsed = JSON.parse(Buffer.from(required, "base64").toString("utf8"));
  } catch {
    return NextResponse.json(
      { ...FALLBACK, source: "fallback_unparseable_header" },
      { status: 200 },
    );
  }

  const accept = parsed.accepts?.[0];
  if (!accept?.network || !accept.asset || !accept.payTo) {
    return NextResponse.json(
      { ...FALLBACK, source: "fallback_incomplete_accepts" },
      { status: 200 },
    );
  }

  const { label, chainId } = chainLabel(accept.network);
  const { faucet, onramp } = fundingLinks(chainId);

  return NextResponse.json(
    {
      ok: true,
      network: accept.network,
      chain_id: chainId,
      asset: accept.asset,
      pay_to: accept.payTo,
      amount: accept.amount ?? "1000000",
      chain_label: label,
      faucet_url: faucet,
      onramp_url: onramp,
      probed_at: new Date().toISOString(),
      source: "probe" as const,
    },
    { status: 200 },
  );
}
