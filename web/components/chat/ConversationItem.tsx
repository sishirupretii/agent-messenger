"use client";

import { Users, Pin, PinOff, BellOff, Bell } from "lucide-react";
import type { Conversation, DecodedMessage } from "@xmtp/browser-sdk";
import { cn } from "@/lib/cn";
import { formatRelative, nsToDate, shortAddress } from "@/lib/format";
import { PeerAvatar } from "@/components/ui/Avatar";
import { PeerName } from "@/components/ui/PeerName";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { isGroup, getGroupName } from "@/lib/conversation";
import { isKnownAgentAddress, getKnownAgent } from "@/lib/agents";
import { getMessageText } from "@/lib/message";
import { useChat, type PeerInfo } from "@/context/ChatProvider";

export function ConversationItem({
  conversation,
  peerInfo,
  active,
  unread,
  lastMessage,
  pinned,
  muted,
  onSelect,
  onTogglePin,
  onToggleMute,
}: {
  conversation: Conversation;
  peerInfo: PeerInfo | undefined;
  active: boolean;
  unread: number;
  lastMessage: DecodedMessage | undefined;
  pinned: boolean;
  muted: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onToggleMute: () => void;
}) {
  const { ownInboxId } = useChat();
  const peerAddress = peerInfo?.address ?? null;
  const isGroupConv = isGroup(conversation);
  const groupName = isGroupConv ? getGroupName(conversation) : undefined;
  const isAgent = !isGroupConv && isKnownAgentAddress(peerAddress);
  const knownAgent = isAgent ? getKnownAgent(peerAddress) : null;
  const lastFromMe = lastMessage?.senderInboxId === ownInboxId;

  const lastText = lastMessage ? getMessageText(lastMessage) : "";

  const lastAt = (() => {
    try {
      const ns = (lastMessage as unknown as { sentAtNs?: bigint } | undefined)?.sentAtNs;
      if (ns) return nsToDate(ns);
    } catch {
      // ignore
    }
    return null;
  })();

  return (
    <div
      onClick={onSelect}
      role="button"
      className={cn(
        "group w-full text-left rounded-md px-2 py-2 flex gap-2.5 items-center transition-colors relative cursor-pointer",
        active
          ? "bg-white/[0.06]"
          : "hover:bg-white/[0.03]",
      )}
    >
      {isGroupConv ? (
        <div className="size-8 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
          <Users className="size-3.5 text-white/65" />
        </div>
      ) : (
        <PeerAvatar address={peerAddress} size={32} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-white truncate flex items-center gap-1.5 min-w-0">
            <span className="truncate">
              {isGroupConv ? (
                groupName ?? "Untitled group"
              ) : knownAgent ? (
                knownAgent.name
              ) : peerAddress ? (
                <PeerName address={peerAddress} />
              ) : (
                shortAddress(conversation.id, 4, 4)
              )}
            </span>
            {isAgent && <AgentBadge size="xs" />}
          </span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {muted && <BellOff className="size-2.5 text-white/40" />}
            {pinned && <Pin className="size-2.5 text-white/40 rotate-45" fill="currentColor" />}
            {lastAt && (
              <span className="text-[10px] text-white/30">
                {formatRelative(lastAt)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-xs text-white/45 truncate">
            {lastText
              ? lastFromMe
                ? `You: ${lastText}`
                : lastText
              : "no messages yet"}
          </span>
          {unread > 0 && (
            <span className="text-[10px] font-semibold bg-[var(--accent)] text-black rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center flex-shrink-0">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
      </div>
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMute();
          }}
          className={cn(
            "size-6 rounded-md flex items-center justify-center transition-opacity",
            muted
              ? "opacity-100 text-white/60 hover:bg-white/10"
              : "opacity-0 group-hover:opacity-100 text-white/40 hover:text-white hover:bg-white/10",
          )}
          title={muted ? "Unmute" : "Mute notifications"}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <Bell className="size-3" /> : <BellOff className="size-3" />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          className={cn(
            "size-6 rounded-md flex items-center justify-center transition-opacity",
            pinned
              ? "opacity-100 text-violet-300 hover:bg-white/10"
              : "opacity-0 group-hover:opacity-100 text-white/40 hover:text-white hover:bg-white/10",
          )}
          title={pinned ? "Unpin" : "Pin to top"}
          aria-label={pinned ? "Unpin" : "Pin"}
        >
          {pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
        </button>
      </div>
    </div>
  );
}
