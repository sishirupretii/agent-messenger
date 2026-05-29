/**
 * v0.84 — client-side x402 payment for paid DMs.
 *
 * When a DM to a priced inbox returns HTTP 402, this module turns the
 * advertised payment requirements into an EIP-3009
 * `transferWithAuthorization` signature (gasless — a typed-data sign,
 * not a broadcast) and packs it into the base64 X-PAYMENT header the
 * server expects.
 *
 * The signature authorizes the recipient (or any facilitator) to pull
 * `value` base units of the asset from the sender to the recipient's
 * payTo. The sender never broadcasts a tx; settlement happens out of
 * band. The signing wallet's funds only move when someone settles.
 */
import type { PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
}

export interface Challenge402 {
  x402Version: number;
  error: string;
  accepts: PaymentRequirements[];
}

function networkToChainId(network: string): number {
  if (network === "eip155:8453") return 8453;
  if (network === "eip155:84532") return 84532;
  const m = network.match(/^eip155:(\d+)$/);
  if (m) return Number(m[1]);
  throw new Error(`unsupported network ${network}`);
}

/** 32-byte random nonce as 0x-hex, using webcrypto (browser + node 20+). */
function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as Hex;
}

function bytesToBase64(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "utf8").toString("base64");
  return btoa(s);
}

/**
 * Build the X-PAYMENT header value satisfying a 402 challenge.
 *
 * @param account  the sender's viem account (signs the authorization)
 * @param challenge the 402 body the server returned
 * @param opts.validForSeconds how long the authorization stays valid (default 600s)
 */
export async function buildPaymentHeader(
  account: PrivateKeyAccount,
  challenge: Challenge402,
  opts: { validForSeconds?: number } = {},
): Promise<string> {
  const req = challenge.accepts?.[0];
  if (!req) throw new Error("402 challenge had no accepts[]");
  if (req.scheme !== "exact") {
    throw new Error(`unsupported payment scheme ${req.scheme}`);
  }

  const chainId = networkToChainId(req.network);
  const nowSec = Math.floor(Date.now() / 1000);
  const validForSeconds = opts.validForSeconds ?? 600;

  const authorization = {
    from: account.address.toLowerCase(),
    to: req.payTo.toLowerCase(),
    value: req.maxAmountRequired,
    validAfter: "0",
    validBefore: String(nowSec + validForSeconds),
    nonce: randomNonce(),
  };

  const domain = {
    name: req.extra.name,
    version: req.extra.version,
    chainId,
    verifyingContract: req.asset as Hex,
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

  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from as Hex,
      to: authorization.to as Hex,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  const payload = {
    x402Version: challenge.x402Version ?? 2,
    scheme: "exact",
    network: req.network,
    payload: { signature, authorization },
  };

  return bytesToBase64(JSON.stringify(payload));
}
