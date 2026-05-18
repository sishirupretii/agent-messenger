import type { Address } from "viem";

export type TokenInfo = {
  symbol: string;
  name: string;
  /** null = native asset (ETH). otherwise ERC-20 contract address. */
  address: Address | null;
  decimals: number;
  /** Default quick-pick amounts shown in PaymentModal. */
  presets: string[];
  /** Where this token lives in the ecosystem (for amplification copy). */
  project?: string;
  homepage?: string;
};

/**
 * Featured tokens for in-chat tipping on Base mainnet.
 * - ETH: native gas + universal tip
 * - USDC: AEON's preferred unit, stablecoin
 * - BNKR / GITLAWB / MIROSHARK: ecosystem amplification — every token holder
 *   community has a reason to mention SIGNA when they can tip in their token
 */
export const TOKENS: TokenInfo[] = [
  {
    symbol: "ETH",
    name: "Ether",
    address: null,
    decimals: 18,
    presets: ["0.001", "0.005", "0.01", "0.05"],
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    decimals: 6,
    presets: ["1", "5", "10", "25"],
    project: "AEON Pay",
    homepage: "https://aeon.xyz",
  },
  {
    symbol: "BNKR",
    name: "BankrCoin",
    address: "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b",
    decimals: 18,
    presets: ["10", "50", "100", "500"],
    project: "Bankr",
    homepage: "https://bankr.bot",
  },
  {
    symbol: "GITLAWB",
    name: "gitlawb",
    address: "0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3",
    decimals: 18,
    presets: ["100", "500", "1000", "5000"],
    project: "gitlawb",
    homepage: "https://gitlawb.com",
  },
  {
    symbol: "MIRO",
    name: "MiroShark",
    address: "0xd7bc6a05a56655fb2052f742b012d1dfd66e1ba3",
    decimals: 18,
    presets: ["10", "50", "100", "500"],
    project: "MiroShark",
    homepage: "https://web3.bitget.com/swap/base/0xd7bc6a05a56655FB2052F742B012d1DFD66e1BA3",
  },
];

export function getToken(symbol: string): TokenInfo | undefined {
  return TOKENS.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
}

export const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "to", type: "address" as const },
      { name: "amount", type: "uint256" as const },
    ],
    outputs: [{ name: "", type: "bool" as const }],
  },
] as const;

/** Parse a decimal user input into the token's smallest unit. */
export function parseTokenAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, fracRaw = ""] = trimmed.split(".");
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, "0");
  try {
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || "0");
  } catch {
    return null;
  }
}

/** Format a smallest-unit amount back to a human decimal string. */
export function formatTokenAmount(amount: bigint | number, decimals: number): string {
  const n = typeof amount === "bigint" ? amount : BigInt(Math.trunc(amount));
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  if (frac === 0n) return `${whole}`;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
