import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/agents/[address]/x402
 *
 * Body:
 *   {
 *     price_usdc: number,             // 0 = free; remove pricing
 *     pay_to?: 0x-address,            // defaults to agent address
 *     currency?: "USDC",
 *     chain?: "base",
 *     ts: number,
 *     signature: 0x...                 // signed by launched_by
 *   }
 *
 * Lets the agent owner (launched_by) advertise an x402 price for the
 * /respond endpoint. v1 is honor-system — we surface the price in the
 * agent-card.json and the GET /respond schema, and trust Bankr's
 * x402 client layer to enforce payment client-side. Server-side
 * verification (HTTP 402 challenge / proof check) is on the roadmap.
 *
 * Setting price_usdc=0 (or null/negative) clears the pricing back to
 * free. The signature covers (ts, address, price, pay_to, currency,
 * chain) so a stale signature can't be replayed against a different
 * price.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  let body: {
    price_usdc?: number;
    pay_to?: string;
    currency?: string;
    chain?: string;
    ts?: number;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const priceUsdc = Number(body.price_usdc ?? 0);
  if (!Number.isFinite(priceUsdc) || priceUsdc < 0 || priceUsdc > 1000) {
    return NextResponse.json(
      { error: "price_out_of_range", message: "price must be 0..1000 USDC" },
      { status: 400 },
    );
  }
  const payTo = body.pay_to ? body.pay_to.toLowerCase() : null;
  if (payTo && !/^0x[a-f0-9]{40}$/.test(payTo)) {
    return NextResponse.json({ error: "invalid_pay_to" }, { status: 400 });
  }
  const currency = body.currency ?? "USDC";
  const chain = body.chain ?? "base";
  if (!["USDC", "BNKR", "ETH"].includes(currency)) {
    return NextResponse.json({ error: "invalid_currency" }, { status: 400 });
  }
  if (!["base", "ethereum", "polygon"].includes(chain)) {
    return NextResponse.json({ error: "invalid_chain" }, { status: 400 });
  }
  const ts = body.ts ?? 0;
  const signature = body.signature ?? "";

  const db = serverClient();
  const { data: agent, error: agentErr } = await db
    .from("agents")
    .select("address, launched_by")
    .eq("address", address)
    .is("deleted_at", null)
    .maybeSingle();
  if (agentErr) {
    return NextResponse.json({ error: agentErr.message }, { status: 500 });
  }
  if (!agent) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }
  if (!agent.launched_by) {
    return NextResponse.json(
      { error: "agent_has_no_owner" },
      { status: 400 },
    );
  }

  const canonicalMessage = [
    "SIGNA x402 set v1",
    `ts:${ts}`,
    `address:${address}`,
    `price_usdc:${priceUsdc}`,
    `pay_to:${payTo ?? address}`,
    `currency:${currency}`,
    `chain:${chain}`,
  ].join("\n");
  const verify = await verifySignedMessage({
    expectedAddress: agent.launched_by,
    message: canonicalMessage,
    signature,
    ts,
  });
  if (!verify.ok) {
    return NextResponse.json({ error: verify.reason }, { status: 401 });
  }

  const { error } = await db
    .from("agents")
    .update({
      x402_price_usdc: priceUsdc > 0 ? priceUsdc : null,
      x402_pay_to: priceUsdc > 0 ? (payTo ?? address) : null,
      x402_currency: priceUsdc > 0 ? currency : "USDC",
      x402_chain: priceUsdc > 0 ? chain : "base",
      updated_at: new Date().toISOString(),
    })
    .eq("address", address);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    address,
    pricing:
      priceUsdc > 0
        ? {
            price: priceUsdc,
            currency,
            chain,
            pay_to: payTo ?? address,
          }
        : null,
  });
}

/**
 * GET /api/agents/[address]/x402 — public read of the current pricing.
 * Same data as in agent-card.json but as a dedicated endpoint for
 * partners polling pricing changes.
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
  const { data } = await db
    .from("agents")
    .select("x402_price_usdc, x402_pay_to, x402_currency, x402_chain")
    .eq("address", address)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }
  const price = data.x402_price_usdc;
  return NextResponse.json({
    ok: true,
    address,
    pricing:
      price != null && Number(price) > 0
        ? {
            price: Number(price),
            currency: data.x402_currency ?? "USDC",
            chain: data.x402_chain ?? "base",
            pay_to: data.x402_pay_to ?? address,
            endpoint: `https://www.signaagent.xyz/api/agents/${address}/respond`,
          }
        : null,
  });
}
