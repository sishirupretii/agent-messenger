import { NextRequest, NextResponse } from "next/server";
import { serverClient, supabase } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign } from "@/lib/feed-types";
import {
  EIP3009_TOKENS,
  DEFAULT_ASSET_BASE_USDC,
  humanizePrice,
  type InboxPrice,
} from "@/lib/x402-paid-dm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * v0.84 — per-wallet SIGNA inbox pricing.
 *
 * GET  /api/agents/[address]/dm-price   Public price lookup. Senders
 *       call this before DMing to learn the cost. Returns {priced:false}
 *       when the inbox is free.
 *
 * POST /api/agents/[address]/dm-price   Wallet-signed set/clear. Body:
 *       { address, price_raw, asset_address?, pay_to?, chain?, ts, signature }
 *       price_raw "0" clears the price (free inbox).
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const address = (raw ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json(
      { ok: false, error: "invalid_address" },
      { status: 400, headers: CORS },
    );
  }
  const { data, error } = await supabase
    .from("signa_dm_pricing")
    .select(
      "address, price_raw, pay_to, asset_address, asset_symbol, asset_decimals, chain, ts, signature, signed_message, updated_at",
    )
    .eq("address", address)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: CORS },
    );
  }
  if (!data || !data.price_raw || data.price_raw === "0") {
    return NextResponse.json(
      { ok: true, address, priced: false },
      { status: 200, headers: CORS },
    );
  }
  const price = data as InboxPrice & { signature: string; signed_message: string };
  return NextResponse.json(
    {
      ok: true,
      address,
      priced: true,
      price_raw: price.price_raw,
      pay_to: price.pay_to,
      asset_address: price.asset_address,
      asset_symbol: price.asset_symbol,
      asset_decimals: price.asset_decimals,
      chain: price.chain,
      human_price: humanizePrice(price),
      network: price.chain === "base" ? "eip155:8453" : "eip155:84532",
      // re-verifiable: the signed envelope that set this price
      signature: price.signature,
      signed_message: price.signed_message,
    },
    { status: 200, headers: CORS },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const routeAddress = (raw ?? "").toLowerCase();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad_json" },
      { status: 400, headers: CORS },
    );
  }

  const address = String(body.address ?? "").toLowerCase();
  const price_raw = String(body.price_raw ?? "").trim();
  const ts = Number(body.ts ?? 0);
  const signature = String(body.signature ?? "");

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json(
      { ok: false, error: "invalid_address" },
      { status: 400, headers: CORS },
    );
  }
  if (address !== routeAddress) {
    return NextResponse.json(
      { ok: false, error: "address_mismatch" },
      { status: 400, headers: CORS },
    );
  }
  if (!ts || !signature) {
    return NextResponse.json(
      { ok: false, error: "missing_signature_or_ts" },
      { status: 400, headers: CORS },
    );
  }
  if (!/^\d+$/.test(price_raw)) {
    return NextResponse.json(
      { ok: false, error: "invalid_price_raw", hint: "uint256 base-units string" },
      { status: 400, headers: CORS },
    );
  }

  const isClear = price_raw === "0";

  // Defaults: USDC on Base, payTo = the wallet itself.
  const asset_address = isClear
    ? DEFAULT_ASSET_BASE_USDC
    : String(body.asset_address ?? DEFAULT_ASSET_BASE_USDC).toLowerCase();
  const pay_to = isClear
    ? address
    : String(body.pay_to ?? address).toLowerCase();
  const chain = isClear ? "base" : String(body.chain ?? "base").toLowerCase();

  if (!isClear) {
    if (!/^0x[a-f0-9]{40}$/.test(asset_address)) {
      return NextResponse.json(
        { ok: false, error: "invalid_asset_address" },
        { status: 400, headers: CORS },
      );
    }
    if (!/^0x[a-f0-9]{40}$/.test(pay_to)) {
      return NextResponse.json(
        { ok: false, error: "invalid_pay_to" },
        { status: 400, headers: CORS },
      );
    }
    if (!EIP3009_TOKENS[asset_address]) {
      return NextResponse.json(
        {
          ok: false,
          error: "unsupported_asset",
          hint: "v0.84 supports EIP-3009 tokens with a known EIP-712 domain (USDC on Base). More coming.",
        },
        { status: 400, headers: CORS },
      );
    }
    if (chain !== "base") {
      return NextResponse.json(
        { ok: false, error: "unsupported_chain", hint: "base only in v0.84" },
        { status: 400, headers: CORS },
      );
    }
    try {
      if (BigInt(price_raw) <= 0n) throw new Error("non-positive");
    } catch {
      return NextResponse.json(
        { ok: false, error: "invalid_price_raw" },
        { status: 400, headers: CORS },
      );
    }
  }

  // Verify the wallet signed this exact price config.
  const message = buildMessageToSign({
    kind: "signa_dm_price_set",
    address,
    price_raw,
    asset_address: isClear ? undefined : asset_address,
    pay_to: isClear ? undefined : pay_to,
    chain: isClear ? undefined : chain,
    ts,
  });
  const verify = await verifySignedMessage({
    expectedAddress: address,
    message,
    signature,
    ts,
  });
  if (!verify.ok) {
    return NextResponse.json(
      { ok: false, error: verify.reason },
      { status: 401, headers: CORS },
    );
  }

  const db = serverClient();

  if (isClear) {
    await db.from("signa_dm_pricing").delete().eq("address", address);
    return NextResponse.json(
      { ok: true, address, priced: false, cleared: true },
      { status: 200, headers: CORS },
    );
  }

  const token = EIP3009_TOKENS[asset_address];
  const { data, error: upErr } = await db
    .from("signa_dm_pricing")
    .upsert(
      {
        address,
        price_raw,
        pay_to,
        asset_address,
        asset_symbol: token.symbol,
        asset_decimals: token.decimals,
        chain,
        ts,
        signature,
        signed_message: message,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "address" },
    )
    .select(
      "address, price_raw, pay_to, asset_address, asset_symbol, asset_decimals, chain",
    )
    .single();

  if (upErr) {
    return NextResponse.json(
      { ok: false, error: upErr.message },
      { status: 500, headers: CORS },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      address,
      priced: true,
      human_price: humanizePrice(data as InboxPrice),
      price: data,
    },
    { status: 200, headers: CORS },
  );
}
