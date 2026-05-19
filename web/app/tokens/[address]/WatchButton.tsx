"use client";

import { useEffect, useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { useAccount, useSignMessage } from "wagmi";
import {
  isWatched,
  addToWatchlist,
  removeFromWatchlist,
  mergeFromServer,
} from "@/lib/watchlist";
import { toast } from "sonner";

/**
 * Bookmark/unbookmark a token. State is localStorage primarily; when a
 * wallet is connected, a wallet-signed POST mirrors the change to
 * /api/me/watchlist so it follows the user across devices.
 *
 * No wallet = local-only (still works instantly).
 * Wallet connected = local + server sync.
 */
export function WatchButton({
  address,
  symbol,
}: {
  address: string;
  symbol: string;
}) {
  const { address: connectedAddress } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [watched, setWatched] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setWatched(isWatched(address));
    // On first mount with a connected wallet, pull the server-side
    // watchlist and merge so prior bookmarks reappear.
    if (connectedAddress) {
      void mergeFromServer(connectedAddress).then(() => {
        setWatched(isWatched(address));
      });
    }
  }, [address, connectedAddress]);

  async function toggle() {
    const signOpts = connectedAddress
      ? {
          walletAddress: connectedAddress,
          signMessage: signMessageAsync,
        }
      : undefined;

    if (watched) {
      await removeFromWatchlist(address, signOpts);
      setWatched(false);
      toast.success(
        connectedAddress
          ? `$${symbol || "token"} unbookmarked (syncing…)`
          : `$${symbol || "token"} unbookmarked locally`,
      );
    } else {
      await addToWatchlist(address, signOpts);
      setWatched(true);
      toast.success(
        connectedAddress
          ? `$${symbol || "token"} bookmarked (syncing…)`
          : `$${symbol || "token"} bookmarked locally`,
      );
    }
  }

  if (!mounted) {
    // Avoid SSR-vs-client mismatch — render a neutral placeholder until
    // localStorage is readable.
    return (
      <button
        disabled
        className="border border-white/10 text-white/40 rounded-md px-3 py-2 text-[13px] inline-flex items-center gap-1.5 cursor-default"
      >
        <Bookmark className="size-3.5" />
        watch
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      className={
        watched
          ? "border border-amber-300/40 bg-amber-300/[0.06] text-amber-200 rounded-md px-3 py-2 text-[13px] inline-flex items-center gap-1.5 hover:brightness-110 transition"
          : "border border-white/15 text-white rounded-md px-3 py-2 text-[13px] inline-flex items-center gap-1.5 hover:bg-white/[0.04] transition"
      }
      title={
        watched
          ? `Remove $${symbol} from your watchlist`
          : `Add $${symbol} to your watchlist`
      }
    >
      {watched ? (
        <BookmarkCheck className="size-3.5" />
      ) : (
        <Bookmark className="size-3.5" />
      )}
      {watched ? "watching" : "watch"}
    </button>
  );
}
