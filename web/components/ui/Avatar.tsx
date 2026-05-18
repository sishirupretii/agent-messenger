"use client";

import { useEnsAvatar, useEnsName } from "wagmi";
import { normalize } from "viem/ens";
import { BASE_CHAIN_ID, BASE_COINTYPE, MAINNET_CHAIN_ID } from "@/lib/names";
import { GradientAvatar } from "./GradientAvatar";
import { cn } from "@/lib/cn";

/**
 * Peer avatar with this priority:
 *   1. ENS avatar (if address has a primary ENS name + an avatar record)
 *   2. Deterministic SIGNA-palette gradient avatar (always works)
 *
 * Basename avatars aren't fetched separately — Basenames primarily provide
 * naming, not avatar records. ENS avatar via the mainnet ENS resolver covers
 * users who set one; everyone else gets a clean gradient.
 */
export function PeerAvatar({
  address,
  size = 32,
  className,
}: {
  address: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const addr = (address as `0x${string}` | undefined) ?? undefined;

  // Try Basename first (in case the user has set an avatar on Base)
  const { data: basename } = useEnsName({
    address: addr,
    chainId: BASE_CHAIN_ID,
    coinType: BASE_COINTYPE,
    query: { enabled: !!addr },
  });

  // Then ENS mainnet
  const { data: ensName } = useEnsName({
    address: addr,
    chainId: MAINNET_CHAIN_ID,
    query: { enabled: !!addr && !basename },
  });

  const name = basename ?? ensName;

  const { data: avatarUrl } = useEnsAvatar({
    name: name ? normalize(name) : undefined,
    chainId: MAINNET_CHAIN_ID,
    query: { enabled: !!name },
  });

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name ?? address ?? "avatar"}
        width={size}
        height={size}
        className={cn("rounded-full object-cover flex-shrink-0", className)}
      />
    );
  }

  return <GradientAvatar seed={address ?? null} size={size} className={className} />;
}
