/**
 * v0.84 — x402-paid DM verification (server-side, non-custodial).
 *
 * An inbox can carry a price. To DM a priced wallet, the sender attaches
 * an `X-PAYMENT` header carrying an x402 "exact" payload: an EIP-3009
 * `transferWithAuthorization` signature authorizing `value` base units
 * of `asset` from the sender to the recipient's payTo.
 *
 * SIGNA's role is to VERIFY the authorization is real and binding —
 * recover the signer from the typed-data signature, confirm it matches
 * the sender, pays the recipient the right amount of the right asset,
 * and the deadline is valid — then record it as the DM's payment
 * receipt. Settlement (broadcasting `transferWithAuthorization` to pull
 * the funds) is a permissionless action the recipient or any facilitator
 * performs out of band. SIGNA never holds funds, never pays gas, never
 * custodies a key.
 *
 * This mirrors the x402 "exact" scheme exactly — the authorization IS
 * the payment instrument; verification and settlement are separable.
 */
import { verifyTypedData, type Hex } from "viem";

export const X402_VERSION = 2;

/** Networks we understand (CAIP-2). */
export const NETWORKS: Record<string, { chainId: number; label: string }> = {
  "eip155:8453": { chainId: 8453, label: "Base" },
  "eip155:84532": { chainId: 84532, label: "Base Sepolia" },
};

/**
 * Known EIP-3009 tokens keyed by lowercased address. Each carries the
 * EIP-712 domain `name` + `version` needed to reconstruct the
 * TransferWithAuthorization typed data for signature recovery.
 */
export const EIP3009_TOKENS: Record<
  string,
  { symbol: string; decimals: number; name: string; version: string; chainId: number }
> = {
  // USDC on Base mainnet
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
    symbol: "USDC",
    decimals: 6,
    name: "USD Coin",
    version: "2",
    chainId: 8453,
  },
  // USDC on Base Sepolia
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": {
    symbol: "USDC",
    decimals: 6,
    name: "USDC",
    version: "2",
    chainId: 84532,
  },
};

/** Default asset for new priced inboxes. */
export const DEFAULT_ASSET_BASE_USDC =
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export interface InboxPrice {
  address: string;
  price_raw: string;
  pay_to: string;
  asset_address: string;
  asset_symbol: string;
  asset_decimals: number;
  chain: string;
}

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
}

/** Build the HTTP 402 body advertising what the sender must pay. */
export function build402Challenge(
  price: InboxPrice,
  resource: string,
): { x402Version: number; error: string; accepts: PaymentRequirements[] } {
  const assetLower = price.asset_address.toLowerCase();
  const token = EIP3009_TOKENS[assetLower];
  const network =
    price.chain.toLowerCase() === "base" ? "eip155:8453" : "eip155:84532";
  return {
    x402Version: X402_VERSION,
    error: "payment_required",
    accepts: [
      {
        scheme: "exact",
        network,
        maxAmountRequired: price.price_raw,
        resource,
        description: `Paid DM to ${price.address}`,
        mimeType: "application/json",
        payTo: price.pay_to,
        maxTimeoutSeconds: 300,
        asset: price.asset_address,
        extra: {
          name: token?.name ?? "USD Coin",
          version: token?.version ?? "2",
        },
      },
    ],
  };
}

export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface DecodedPayment {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: Hex;
    authorization: Eip3009Authorization;
  };
}

/** Decode the base64 X-PAYMENT header into a typed payload. */
export function decodePaymentHeader(header: string): DecodedPayment | null {
  try {
    const json =
      typeof atob !== "undefined"
        ? atob(header)
        : Buffer.from(header, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed?.payload?.authorization || !parsed?.payload?.signature) {
      return null;
    }
    return parsed as DecodedPayment;
  } catch {
    return null;
  }
}

export type VerifyPaymentResult =
  | { ok: true; authorization: Eip3009Authorization; network: string; assetAddress: string }
  | { ok: false; reason: string };

/**
 * Fully verify an x402 "exact" payment against an inbox price.
 *
 * Checks (in order):
 *   1. scheme is "exact" and network is understood + matches the price
 *   2. authorization.from == the declared DM sender
 *   3. authorization.to == the price's payTo
 *   4. authorization.value >= the price (sender may over-pay, never under)
 *   5. now is within [validAfter, validBefore]
 *   6. the EIP-712 signature recovers to authorization.from over the
 *      TransferWithAuthorization typed data for the configured asset
 *
 * Replay protection (nonce single-use) is enforced by the caller against
 * signa_dm_payment_nonces — it needs DB access, so it's not done here.
 */
export async function verifyExactPayment(args: {
  payment: DecodedPayment;
  price: InboxPrice;
  expectedFrom: string;
  nowSec?: number;
}): Promise<VerifyPaymentResult> {
  const { payment, price, expectedFrom } = args;
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);

  if (payment.scheme !== "exact") {
    return { ok: false, reason: "unsupported_scheme" };
  }
  const net = NETWORKS[payment.network];
  if (!net) return { ok: false, reason: "unsupported_network" };

  const expectedNetwork =
    price.chain.toLowerCase() === "base" ? "eip155:8453" : "eip155:84532";
  if (payment.network !== expectedNetwork) {
    return { ok: false, reason: "network_mismatch" };
  }

  const auth = payment.payload.authorization;
  const from = (auth.from ?? "").toLowerCase();
  const to = (auth.to ?? "").toLowerCase();

  if (!/^0x[a-f0-9]{40}$/.test(from)) {
    return { ok: false, reason: "invalid_authorization_from" };
  }
  if (from !== expectedFrom.toLowerCase()) {
    return { ok: false, reason: "payer_is_not_sender" };
  }
  if (to !== price.pay_to.toLowerCase()) {
    return { ok: false, reason: "wrong_pay_to" };
  }

  let value: bigint;
  let required: bigint;
  try {
    value = BigInt(auth.value);
    required = BigInt(price.price_raw);
  } catch {
    return { ok: false, reason: "invalid_amount" };
  }
  if (value < required) {
    return { ok: false, reason: "underpaid" };
  }

  let validAfter: bigint;
  let validBefore: bigint;
  try {
    validAfter = BigInt(auth.validAfter);
    validBefore = BigInt(auth.validBefore);
  } catch {
    return { ok: false, reason: "invalid_validity_window" };
  }
  if (BigInt(nowSec) < validAfter) {
    return { ok: false, reason: "authorization_not_yet_valid" };
  }
  if (BigInt(nowSec) > validBefore) {
    return { ok: false, reason: "authorization_expired" };
  }

  if (!/^0x[a-f0-9]{64}$/i.test(auth.nonce)) {
    return { ok: false, reason: "invalid_nonce" };
  }

  // Reconstruct the EIP-3009 TransferWithAuthorization typed data and
  // verify the signature recovers to `from`.
  const assetLower = price.asset_address.toLowerCase();
  const token = EIP3009_TOKENS[assetLower];
  if (!token) {
    return { ok: false, reason: "unknown_asset_no_eip712_domain" };
  }
  if (token.chainId !== net.chainId) {
    return { ok: false, reason: "asset_chain_mismatch" };
  }

  const domain = {
    name: token.name,
    version: token.version,
    chainId: net.chainId,
    verifyingContract: price.asset_address as Hex,
  } as const;

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  } as const;

  const message = {
    from: auth.from as Hex,
    to: auth.to as Hex,
    value,
    validAfter,
    validBefore,
    nonce: auth.nonce,
  };

  let valid = false;
  try {
    valid = await verifyTypedData({
      address: from as Hex,
      domain,
      types,
      primaryType: "TransferWithAuthorization",
      message,
      signature: payment.payload.signature,
    });
  } catch (e) {
    return {
      ok: false,
      reason: `signature_verify_threw:${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!valid) {
    return { ok: false, reason: "bad_signature" };
  }

  return {
    ok: true,
    authorization: auth,
    network: payment.network,
    assetAddress: price.asset_address,
  };
}

/** Human-readable price, e.g. "0.10 USDC". */
export function humanizePrice(price: InboxPrice): string {
  try {
    const raw = BigInt(price.price_raw);
    const base = 10n ** BigInt(price.asset_decimals);
    const whole = raw / base;
    const frac = raw % base;
    const fracStr = frac
      .toString()
      .padStart(price.asset_decimals, "0")
      .replace(/0+$/, "")
      .slice(0, 4);
    const num = fracStr ? `${whole}.${fracStr}` : `${whole}`;
    return `${num} ${price.asset_symbol}`;
  } catch {
    return `${price.price_raw} ${price.asset_symbol}`;
  }
}
