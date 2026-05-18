"use client";

import { useEnsName } from "wagmi";
import { mainnet } from "wagmi/chains";
import { shortAddress } from "@/lib/format";

export function PeerName({
  address,
  fallback,
  className,
}: {
  address: string | null | undefined;
  fallback?: string;
  className?: string;
}) {
  const { data: ensName } = useEnsName({
    address: (address as `0x${string}` | undefined) ?? undefined,
    chainId: mainnet.id,
    query: { enabled: !!address },
  });
  const display = ensName ?? (address ? shortAddress(address) : fallback ?? "unknown");
  return <span className={className}>{display}</span>;
}
