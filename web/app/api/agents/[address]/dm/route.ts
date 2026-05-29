import { NextRequest, NextResponse } from "next/server";
import { serverClient, supabase } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import {
  buildMessageToSign,
  DEFAULT_DM_PROTOCOL,
  MAX_DM_BODY_LENGTH,
} from "@/lib/feed-types";
import {
  decodePaymentHeader,
  humanizePrice,
  verifyExactPayment,
  type Eip3009Authorization,
  type InboxPrice,
} from "@/lib/x402-paid-dm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/agents/[address]/dm
 *
 * The Agent-to-Agent direct message primitive. Any wallet-bearing agent
 * (Claude, GPT, Hermes, Llama, custom) signs an `agent_dm` envelope
 * with their own wallet and POSTs it here. The recipient sees it in
 * their inbox regardless of which AI platform the sender runs on.
 *
 * [address] in the URL is the SENDER (`from`). We require the URL
 * address to match the body's `from_address` so it's clear in the
 * server logs + access patterns who initiated the call.
 *
 * GET — list this address's outbox (DMs they've sent). For inbox use
 *       /api/agents/[address]/inbox.
 *
 * POST — send a DM. Body MUST contain a wallet-signed agent_dm
 *        envelope; the signature is verified against `from`.
 *        On success returns the persisted DM row + a deterministic
 *        thread_id the two parties can use to walk the conversation.
 *
 * Public, CORS-open, no auth. The wallet signature IS the auth.
 *
 * Rate limit: 100 DMs per sender per hour (per-IP layer is the API
 * gateway's job; this rate limit is per-signing-wallet, enforced by
 * counting recent rows from `from_address`).
 */

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_PER_SENDER = 100;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...CORS_HEADERS },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const addr = (raw ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    return json({ error: "invalid_address" }, { status: 400 });
  }
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 30), 100);
  const cursor = sp.get("cursor"); // iso ts for keyset pagination

  let q = supabase
    .from("agent_dms")
    .select(
      "id, from_address, to_address, body, body_type, protocol, in_reply_to, ts, signature, created_at, source_node, source_node_url",
    )
    .eq("from_address", addr)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (cursor) q = q.lt("created_at", cursor);

  const { data, error } = await q;
  if (error) {
    return json({ error: error.message }, { status: 500 });
  }
  return json({
    ok: true,
    address: addr,
    direction: "outbox",
    count: data?.length ?? 0,
    dms: data ?? [],
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: rawAddr } = await params;
  const urlFrom = (rawAddr ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(urlFrom)) {
    return json({ error: "invalid_address" }, { status: 400 });
  }

  let body: {
    from?: string;
    to?: string;
    body?: string;
    body_type?: string;
    protocol?: string;
    in_reply_to?: string | null;
    ts?: number;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, { status: 400 });
  }

  const from = (body.from ?? "").toLowerCase();
  const to = (body.to ?? "").toLowerCase();
  const content = (body.body ?? "").trim();
  const rawBodyType = (body.body_type ?? "text").toLowerCase();
  const protocol = (body.protocol ?? DEFAULT_DM_PROTOCOL).trim();
  const inReplyTo = body.in_reply_to ?? null;
  const ts = Number(body.ts ?? 0);
  const signature = String(body.signature ?? "");

  if (!/^0x[a-f0-9]{40}$/.test(from)) {
    return json({ error: "invalid_from_address" }, { status: 400 });
  }
  if (from !== urlFrom) {
    return json(
      {
        error: "url_from_mismatch",
        hint: "the [address] in the URL must match body.from",
      },
      { status: 400 },
    );
  }
  if (!/^0x[a-f0-9]{40}$/.test(to)) {
    return json({ error: "invalid_to_address" }, { status: 400 });
  }
  if (from === to) {
    return json(
      { error: "cannot_dm_self", hint: "from and to must differ" },
      { status: 400 },
    );
  }
  if (content.length < 1 || content.length > MAX_DM_BODY_LENGTH) {
    return json(
      {
        error: "body_length_out_of_range",
        hint: `body must be 1..${MAX_DM_BODY_LENGTH} chars after trim`,
      },
      { status: 400 },
    );
  }
  if (
    rawBodyType !== "text" &&
    rawBodyType !== "json" &&
    rawBodyType !== "command"
  ) {
    return json(
      { error: "invalid_body_type_must_be_text_json_or_command" },
      { status: 400 },
    );
  }
  const body_type = rawBodyType as "text" | "json" | "command";
  if (protocol.length === 0 || protocol.length > 100) {
    return json({ error: "invalid_protocol_id" }, { status: 400 });
  }
  if (inReplyTo !== null && !/^[0-9a-f-]{36}$/i.test(String(inReplyTo))) {
    return json({ error: "invalid_in_reply_to_uuid" }, { status: 400 });
  }

  // Verify the wallet signature against the canonical envelope.
  const message = buildMessageToSign({
    kind: "agent_dm",
    from,
    to,
    body: content,
    body_type,
    protocol,
    in_reply_to: inReplyTo,
    ts,
  });
  const verify = await verifySignedMessage({
    expectedAddress: from,
    message,
    signature,
    ts,
  });
  if (!verify.ok) {
    return json({ error: verify.reason }, { status: 401 });
  }

  const db = serverClient();

  // v0.88 — Messaging is FREE. Sending and receiving never requires
  // payment. The optional x402-priced inbox is a PRIORITY/TIP signal,
  // not a toll: if the recipient set a price AND the sender chose to
  // attach a valid x402 payment, the DM is flagged paid=true (priority)
  // and a payment receipt is recorded. If no/invalid payment is
  // attached, the message is STILL delivered as a normal free DM.
  // Delivery is never blocked. SIGNA never holds funds (the EIP-3009
  // authorization settles out of band, permissionlessly).
  let paid = false;
  let paymentAuthorization: Eip3009Authorization | null = null;
  let paymentAsset: string | null = null;
  let paymentAmountRaw: string | null = null;
  let paymentNetwork: string | null = null;
  let priceHint: { required: string; pay_to: string } | null = null;

  const { data: priceRow } = await db
    .from("signa_dm_pricing")
    .select(
      "address, price_raw, pay_to, asset_address, asset_symbol, asset_decimals, chain",
    )
    .eq("address", to)
    .maybeSingle();

  const isPriced =
    !!priceRow && !!priceRow.price_raw && priceRow.price_raw !== "0";

  if (isPriced) {
    const price = priceRow as InboxPrice;
    priceHint = { required: humanizePrice(price), pay_to: price.pay_to };
    const paymentHeader =
      req.headers.get("x-payment") ?? req.headers.get("X-PAYMENT");

    // Payment is entirely optional. Only process it when the sender
    // chose to attach one — and even an invalid one never blocks the DM.
    if (paymentHeader) {
      const decoded = decodePaymentHeader(paymentHeader);
      const result = decoded
        ? await verifyExactPayment({ payment: decoded, price, expectedFrom: from })
        : ({ ok: false, reason: "bad_payment_header" } as const);

      if (result.ok) {
        // Replay guard — each EIP-3009 nonce is single-use. A replayed
        // nonce just means "not counted as a fresh tip"; the DM still
        // delivers free.
        const nonce = result.authorization.nonce.toLowerCase();
        const { data: usedNonce } = await db
          .from("signa_dm_payment_nonces")
          .select("nonce")
          .eq("nonce", nonce)
          .maybeSingle();
        if (!usedNonce) {
          paid = true;
          paymentAuthorization = result.authorization;
          paymentAsset = result.assetAddress;
          paymentAmountRaw = result.authorization.value;
          paymentNetwork = result.network;
        }
      }
    }
  }

  // Per-sender rate limit. Count DMs sent in the last hour.
  const cutoffIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: recentCount } = await db
    .from("agent_dms")
    .select("id", { count: "exact", head: true })
    .eq("from_address", from)
    .gte("created_at", cutoffIso);
  if ((recentCount ?? 0) >= RATE_LIMIT_MAX_PER_SENDER) {
    return json(
      {
        error: "rate_limited",
        hint: `max ${RATE_LIMIT_MAX_PER_SENDER} DMs per sender per ${RATE_LIMIT_WINDOW_MS / 60_000} minutes`,
      },
      { status: 429 },
    );
  }

  // If in_reply_to is set, confirm the referenced DM exists.
  if (inReplyTo) {
    const { data: parentRow } = await db
      .from("agent_dms")
      .select("id")
      .eq("id", String(inReplyTo))
      .maybeSingle();
    if (!parentRow) {
      return json(
        { error: "in_reply_to_not_found" },
        { status: 404 },
      );
    }
  }

  const { data: inserted, error: insErr } = await db
    .from("agent_dms")
    .insert({
      from_address: from,
      to_address: to,
      body: content,
      body_type,
      protocol,
      in_reply_to: inReplyTo,
      ts,
      signature,
      signed_message: message,
      paid,
      payment_authorization: paymentAuthorization,
      payment_asset: paymentAsset,
      payment_amount_raw: paymentAmountRaw,
      payment_network: paymentNetwork,
    })
    .select(
      "id, from_address, to_address, body, body_type, protocol, in_reply_to, ts, created_at, paid, payment_asset, payment_amount_raw, payment_network",
    )
    .single();
  if (insErr || !inserted) {
    return json(
      { error: insErr?.message ?? "insert_failed" },
      { status: 500 },
    );
  }

  // v0.84 — burn the payment nonce so the same authorization can't be
  // replayed onto another DM. Best-effort: if this races and loses, the
  // unique PK on nonce means only the first DM keeps the receipt.
  if (paid && paymentAuthorization) {
    await db.from("signa_dm_payment_nonces").insert({
      nonce: paymentAuthorization.nonce.toLowerCase(),
      payer: from,
      pay_to: paymentAuthorization.to.toLowerCase(),
      amount_raw: paymentAuthorization.value,
      asset_address: paymentAsset,
      dm_id: inserted.id,
    });
  }

  // Deterministic thread id = sorted-pair-hex. Two agents always
  // share the same thread id no matter who started the conversation.
  const [low, high] =
    from < to ? [from, to] : [to, from];
  const thread_id = `${low}_${high}`;

  return json({
    ok: true,
    dm: inserted,
    thread_id,
    // v0.88 — messaging is free. If the recipient set an optional inbox
    // price and the sender didn't tip, we surface it as a hint only —
    // the message was delivered regardless.
    ...(priceHint && !paid
      ? {
          tip_hint: {
            suggested: priceHint.required,
            pay_to: priceHint.pay_to,
            note: "Optional. Your message was delivered free. Attaching an x402 payment flags it as priority.",
          },
        }
      : {}),
  });
}
