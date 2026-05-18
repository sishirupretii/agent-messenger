import { parseEther, type Address, type Hex } from "viem";
import type { Conversation } from "@xmtp/browser-sdk";
import { base } from "wagmi/chains";

export const PAYMENT_CHAIN_ID = base.id; // 8453 — Base mainnet
export const PAYMENT_NAMESPACE = "eip155";

export function parseEthAmount(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  try {
    return parseEther(trimmed);
  } catch {
    return null;
  }
}

/**
 * After a transfer (ETH or ERC-20) is mined on Base, publish a
 * TransactionReference XMTP message so the tx appears as a payment card
 * in the conversation. Currency + decimals carry the token info — the
 * receiving side renders any token symbol natively.
 */
export async function shareTransactionReference(
  conv: Conversation,
  args: {
    txHash: Hex;
    fromAddress: Address;
    toAddress: Address;
    amountRaw: bigint;
    currency: string;
    decimals: number;
  },
) {
  const convAny = conv as unknown as {
    sendTransactionReference: (
      ref: {
        namespace?: string;
        networkId: string;
        reference: string;
        metadata?: {
          transactionType: string;
          currency: string;
          amount: number;
          decimals: number;
          fromAddress: string;
          toAddress: string;
        };
      },
    ) => Promise<string>;
  };

  const amountNumber = Number(args.amountRaw);

  return convAny.sendTransactionReference({
    namespace: PAYMENT_NAMESPACE,
    networkId: String(PAYMENT_CHAIN_ID),
    reference: args.txHash,
    metadata: {
      transactionType: "transfer",
      currency: args.currency,
      amount: Number.isFinite(amountNumber) ? amountNumber : 0,
      decimals: args.decimals,
      fromAddress: args.fromAddress.toLowerCase(),
      toAddress: args.toAddress.toLowerCase(),
    },
  });
}

export function weiToEthString(wei: bigint | number, decimals = 18): string {
  const n = typeof wei === "bigint" ? wei : BigInt(Math.trunc(wei));
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  if (frac === 0n) return `${whole}`;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
