import { privateKeyToAccount } from "viem/accounts";
import type { Account, Address, Hex } from "viem";
import crypto from "node:crypto";

/**
 * Minimal x402 v2 client.
 *
 * Implements the buyer side of the protocol defined at
 *   https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md
 *
 * Flow:
 *   1. POST the endpoint with no payment → server responds 402 + PAYMENT-REQUIRED header.
 *   2. Decode the requirements (base64 JSON), pick an accepts[] entry.
 *   3. Sign an EIP-3009 transferWithAuthorization for that USDC amount.
 *   4. POST again with the signed PaymentPayload in the X-PAYMENT header.
 *   5. Server settles on-chain via the CDP facilitator and returns 200/202 +
 *      PAYMENT-RESPONSE header containing the settlement tx hash.
 *
 * Why we built this and not pulled the official SDK:
 *   - The Python/TS SDKs are wagmi-flavored and assume a viem WalletClient
 *     in a browser. SIGNA's paid calls happen server-side from a fresh
 *     Node process per cron tick, where signing a 712-typed message is
 *     a single viem call. A 200-line client beats a 50-MB dependency
 *     graph for this surface.
 *
 * Networks: anything CDP-recognized. We default to Base Sepolia
 * (eip155:84532) since that's where MiroShark currently runs; switch
 * to Base mainnet (eip155:8453) by changing the env without touching
 * any code in this file — the chainId is parsed from the server's
 * accepts[].network response.
 */

/** Subset of x402 v2 accepts[] entry, just what we need to sign. */
export type X402Accepts = {
  scheme: "exact";
  network: string; // e.g. "eip155:84532"
  asset: Address; // USDC contract
  amount: string; // base units, e.g. "1000000" = 1 USDC (6 decimals)
  payTo: Address;
  maxTimeoutSeconds?: number;
  extra: { name: string; version: string };
};

export type X402Requirements = {
  x402Version: 2;
  resource: {
    url: string;
    description?: string;
    mimeType?: string;
  };
  accepts: X402Accepts[];
  extensions?: unknown;
};

/** What the server returns in PAYMENT-RESPONSE, base64-decoded. */
export type X402SettleResponse = {
  success: boolean;
  transaction?: Hex;
  network?: string;
  payer?: Address;
};

export type X402PayResult = {
  ok: true;
  data: unknown;
  /** On-chain settlement tx hash (from PAYMENT-RESPONSE), if present. */
  txHash: Hex | null;
  /** "eip155:84532" etc — which network was used. */
  network: string;
  /** Amount paid in token base units (e.g. "1000000" = 1 USDC). */
  amount: string;
  /** USDC contract used. */
  asset: Address;
};

export type X402PayError = {
  ok: false;
  stage:
    | "initial_fetch"
    | "missing_payment_required"
    | "bad_requirements"
    | "no_accepts"
    | "unsupported_scheme"
    | "sign_failed"
    | "retry_fetch"
    | "settle_rejected"
    | "bad_response";
  status?: number;
  message: string;
};

/**
 * Pay an x402 endpoint and return the parsed JSON response + settlement tx.
 *
 * `signer` is a viem Account capable of EIP-712 signing. The signer
 * must hold sufficient USDC on the network the server requires.
 *
 * If the endpoint does NOT return 402 (e.g. an open endpoint, or
 * already-paid via cookie), we return early with the response — useful
 * for accidental free-pass paths.
 */
export async function x402Pay(args: {
  url: string;
  body: object;
  signer: Account;
  /**
   * If multiple accepts[] are offered, pick the one whose network
   * starts with this prefix. Defaults to "eip155:" so any EVM chain
   * matches.
   */
  preferNetworkPrefix?: string;
  /** Timeout for each HTTP call, in ms. */
  perRequestTimeoutMs?: number;
}): Promise<X402PayResult | X402PayError> {
  const perRequestTimeoutMs = args.perRequestTimeoutMs ?? 30_000;

  // 1. INITIAL POST — no payment header. Server should reply 402.
  let initial: Response;
  try {
    initial = await fetch(args.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(args.body),
      signal: AbortSignal.timeout(perRequestTimeoutMs),
    });
  } catch (e) {
    return {
      ok: false,
      stage: "initial_fetch",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  // If the server returns a non-402 success, treat it as a free pass.
  if (initial.status >= 200 && initial.status < 300) {
    let data: unknown = null;
    try {
      data = await initial.json();
    } catch {
      data = null;
    }
    return {
      ok: true,
      data,
      txHash: null,
      network: "none",
      amount: "0",
      asset: "0x0000000000000000000000000000000000000000" as Address,
    };
  }

  if (initial.status !== 402) {
    return {
      ok: false,
      stage: "initial_fetch",
      status: initial.status,
      message: `expected 402 or 2xx, got ${initial.status}`,
    };
  }

  // 2. DECODE PAYMENT-REQUIRED header
  const headerB64 = initial.headers.get("payment-required");
  if (!headerB64) {
    return {
      ok: false,
      stage: "missing_payment_required",
      status: 402,
      message: "server returned 402 but no PAYMENT-REQUIRED header",
    };
  }
  let requirements: X402Requirements;
  try {
    requirements = JSON.parse(
      Buffer.from(headerB64, "base64").toString("utf8"),
    ) as X402Requirements;
  } catch (e) {
    return {
      ok: false,
      stage: "bad_requirements",
      message: `couldn't parse PAYMENT-REQUIRED: ${e instanceof Error ? e.message : "bad json"}`,
    };
  }

  const prefix = args.preferNetworkPrefix ?? "eip155:";
  const accepted =
    requirements.accepts?.find((a) => a.network?.startsWith(prefix)) ??
    requirements.accepts?.[0];
  if (!accepted) {
    return {
      ok: false,
      stage: "no_accepts",
      message: "server's accepts[] was empty",
    };
  }
  if (accepted.scheme !== "exact") {
    return {
      ok: false,
      stage: "unsupported_scheme",
      message: `only the "exact" scheme is supported by this client (got "${accepted.scheme}")`,
    };
  }

  // 3. BUILD + SIGN EIP-3009 transferWithAuthorization
  const chainId = Number(accepted.network.replace(/^eip155:/, ""));
  if (!Number.isFinite(chainId) || chainId <= 0) {
    return {
      ok: false,
      stage: "bad_requirements",
      message: `couldn't parse chain id from network "${accepted.network}"`,
    };
  }
  const now = Math.floor(Date.now() / 1000);
  // Allow a 60s clock-skew tolerance in the past, max 5 min validity by default.
  const validAfter = now - 60;
  const validBefore = now + (accepted.maxTimeoutSeconds ?? 300);
  const nonce = ("0x" +
    crypto.randomBytes(32).toString("hex")) as Hex;

  let signature: Hex;
  try {
    signature = (await args.signer.signTypedData!({
      domain: {
        name: accepted.extra.name,
        version: accepted.extra.version,
        chainId,
        verifyingContract: accepted.asset,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: args.signer.address,
        to: accepted.payTo,
        value: BigInt(accepted.amount),
        validAfter: BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce,
      },
    })) as Hex;
  } catch (e) {
    return {
      ok: false,
      stage: "sign_failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  // 4. BUILD PaymentPayload + base64-encode
  const paymentPayload = {
    x402Version: 2,
    accepted,
    resource: requirements.resource?.url ?? args.url,
    payload: {
      signature,
      authorization: {
        from: args.signer.address,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce,
      },
    },
  };
  const xPayment = Buffer.from(JSON.stringify(paymentPayload), "utf8").toString(
    "base64",
  );

  // 5. RETRY POST with X-PAYMENT
  let retry: Response;
  try {
    retry = await fetch(args.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-payment": xPayment,
      },
      body: JSON.stringify(args.body),
      signal: AbortSignal.timeout(perRequestTimeoutMs),
    });
  } catch (e) {
    return {
      ok: false,
      stage: "retry_fetch",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  if (!retry.ok) {
    let body = "";
    try {
      body = await retry.text();
    } catch {
      // ignore
    }
    return {
      ok: false,
      stage: "settle_rejected",
      status: retry.status,
      message: `server rejected the signed payment (HTTP ${retry.status}): ${body.slice(0, 280)}`,
    };
  }

  // 6. DECODE PAYMENT-RESPONSE header for the on-chain tx hash
  let txHash: Hex | null = null;
  const respHeader = retry.headers.get("payment-response");
  if (respHeader) {
    try {
      const settle = JSON.parse(
        Buffer.from(respHeader, "base64").toString("utf8"),
      ) as X402SettleResponse;
      if (settle.transaction) {
        txHash = settle.transaction;
      }
    } catch {
      // Soft-fail on a malformed header — the call still succeeded.
    }
  }

  let data: unknown = null;
  try {
    data = await retry.json();
  } catch {
    // Some endpoints return text/plain bodies; surface what we can.
    return {
      ok: false,
      stage: "bad_response",
      status: retry.status,
      message: "settle returned 2xx but body was not valid JSON",
    };
  }

  return {
    ok: true,
    data,
    txHash,
    network: accepted.network,
    amount: accepted.amount,
    asset: accepted.asset,
  };
}

/**
 * Convenience wrapper: build a viem Account from an env var private key
 * and pay an x402 endpoint. The env var should contain a 0x-prefixed
 * 64-hex-char private key.
 *
 * Returns null + a structured error if the env var is missing OR the
 * key is malformed — callers should branch on that for clean
 * "not configured" handling.
 */
export function x402SignerFromEnv(envName: string): Account | null {
  const raw = process.env[envName];
  if (!raw) return null;
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error(
      `${envName} is set but malformed — expected 0x-prefixed 64-hex-char EVM private key`,
    );
  }
  return privateKeyToAccount(key as Hex);
}
