"use client";

import { useEnsName } from "wagmi";
import { shortAddress } from "@/lib/format";
import { BASE_CHAIN_ID, BASE_COINTYPE, MAINNET_CHAIN_ID } from "@/lib/names";

/**
 * Resolves a wallet address to a display name with this priority:
 *   1. Basename (Base mainnet, ENSIP-19 reverse resolution via coinType)
 *   2. ENS primary name (Ethereum mainnet)
 *   3. Truncated address (0xABC…1234)
 *
 * The two lookups run in parallel; whichever resolves first wins precedence.
 */
export function PeerName({
  address,
  fallback,
  className,
}: {
  address: string | null | undefined;
  fallback?: string;
  className?: string;
}) {
  const addr = (address as `0x${string}` | undefined) ?? undefined;

  // Basename via Base mainnet + ENSIP-19 coinType
  const { data: basename } = useEnsName({
    address: addr,
    chainId: BASE_CHAIN_ID,
    coinType: BASE_COINTYPE,
    query: { enabled: !!addr },
  });

  // ENS via Ethereum mainnet (default reverse)
  const { data: ensName } = useEnsName({
    address: addr,
    chainId: MAINNET_CHAIN_ID,
    query: { enabled: !!addr && !basename },
  });

  const display =
    basename ??
    ensName ??
    (address ? shortAddress(address) : fallback ?? "unknown");

  return <span className={className}>{display}</span>;
}
