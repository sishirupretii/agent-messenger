"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/context/ChatProvider";
import { PeerAvatar } from "@/components/ui/Avatar";
import { PeerName } from "@/components/ui/PeerName";
import { shortAddress } from "@/lib/format";

export function ProfileChip() {
  const { ownAddress } = useChat();
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
    <div className="px-3 pb-3 pt-1">
      <div className="glass rounded-xl p-2.5 flex items-center gap-2.5">
        <PeerAvatar address={ownAddress} size={28} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-white truncate">
            <PeerName address={ownAddress} fallback={shortAddress(ownAddress)} />
          </div>
          <div className="text-[10px] font-mono text-white/40 truncate">
            {shortAddress(ownAddress, 6, 4)}
          </div>
        </div>
        <button
          onClick={copy}
          className="text-white/50 hover:text-white p-1 rounded-md hover:bg-white/[0.06] transition-colors"
          aria-label="Copy address"
          title="Copy your address"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
    </div>
  );
}
