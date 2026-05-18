"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/context/ChatProvider";
import { PeerAvatar } from "@/components/ui/Avatar";
import { PeerName } from "@/components/ui/PeerName";
import { shortAddress } from "@/lib/format";
import { useDisplayName } from "@/hooks/useDisplayName";
import { XMTP_ENV } from "@/lib/xmtp";

export function ProfileChip() {
  const { ownAddress } = useChat();
  const [displayName] = useDisplayName();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!ownAddress) return;
    try {
      await navigator.clipboard.writeText(ownAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  if (!ownAddress) return null;

  return (
    <div className="px-3 py-3 flex items-center gap-2.5 border-b border-white/[0.06]">
      <PeerAvatar address={ownAddress} size={26} />
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium text-white truncate flex items-center gap-1.5">
          <span className="truncate">
            {displayName ? (
              displayName
            ) : (
              <PeerName address={ownAddress} fallback={shortAddress(ownAddress)} />
            )}
          </span>
          <span
            className="text-[9px] uppercase tracking-[0.08em] font-medium text-[var(--accent)] border border-[var(--accent)]/25 bg-[var(--accent-dim)] rounded-sm px-1 py-px flex-shrink-0"
            title={`XMTP "${XMTP_ENV}" network`}
          >
            {XMTP_ENV}
          </span>
        </div>
        <div className="text-[10px] font-mono text-white/40 truncate">
          {shortAddress(ownAddress, 6, 4)}
        </div>
      </div>
      <button
        onClick={copy}
        className="text-white/45 hover:text-white p-1 rounded-md hover:bg-white/[0.05] transition-colors"
        aria-label="Copy address"
        title="Copy address"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </div>
  );
}
