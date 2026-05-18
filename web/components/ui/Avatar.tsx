"use client";

import Avatar from "boring-avatars";
import { useEnsAvatar, useEnsName } from "wagmi";
import { normalize } from "viem/ens";
import { mainnet } from "wagmi/chains";
import { cn } from "@/lib/cn";

const PALETTE = ["#8b5cf6", "#d946ef", "#f472b6", "#06b6d4", "#22d3ee"];

export function PeerAvatar({
  address,
  size = 32,
  className,
}: {
  address: string | null | undefined;
  size?: number;
  className?: string;
}) {
  // ENS lives on mainnet — wagmi resolves via the mainnet config if available
  const { data: ensName } = useEnsName({
    address: (address as `0x${string}` | undefined) ?? undefined,
    chainId: mainnet.id,
    query: { enabled: !!address },
  });
  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ? normalize(ensName) : undefined,
    chainId: mainnet.id,
    query: { enabled: !!ensName },
  });

  if (ensAvatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={ensAvatar}
        alt={ensName ?? address ?? "avatar"}
        width={size}
        height={size}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }

  return (
    <div
      className={cn("rounded-full overflow-hidden flex-shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <Avatar
        size={size}
        name={address ?? "anon"}
        variant="beam"
        colors={PALETTE}
      />
    </div>
  );
}
