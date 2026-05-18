"use client";

import { useMemo } from "react";
import { Plus, Sparkles, RefreshCw, Search, X } from "lucide-react";
import Link from "next/link";
import { useChat } from "@/context/ChatProvider";
import { ConversationItem } from "./ConversationItem";
import { ConversationSkeleton } from "./ConversationSkeleton";
import { SidebarEmpty } from "./EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { ProfileChip } from "@/components/shell/ProfileChip";
import { isGroup, getGroupName } from "@/lib/conversation";
import { getMessageText } from "@/lib/message";
import { cn } from "@/lib/cn";

export function Sidebar({
  onNewChat,
  className,
}: {
  onNewChat: () => void;
  className?: string;
}) {
  const {
    conversations,
    conversationsLoading,
    activeConversationId,
    setActiveConversationId,
    peerInfoByConvId,
    unreadByConvId,
    messagesByConvId,
    refreshConversations,
    searchQuery,
    setSearchQuery,
    pinnedIds,
    togglePin,
    mutedIds,
    toggleMute,
  } = useChat();

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const withMeta = conversations.map((c) => {
      const msgs = messagesByConvId.get(c.id) ?? [];
      const last = msgs[msgs.length - 1];
      const ns = (last as unknown as { sentAtNs?: bigint } | undefined)?.sentAtNs;
      const t = ns ? Number(ns / 1_000_000n) : 0;
      return { conv: c, lastTime: t, lastMessage: last, pinned: pinnedIds.has(c.id) };
    });
    const filtered = !q
      ? withMeta
      : withMeta.filter(({ conv, lastMessage }) => {
          const peer = peerInfoByConvId.get(conv.id);
          const lastText = lastMessage
            ? getMessageText(lastMessage).toLowerCase()
            : "";
          const groupName = isGroup(conv) ? getGroupName(conv)?.toLowerCase() ?? "" : "";
          const addr = peer?.address?.toLowerCase() ?? "";
          return (
            addr.includes(q) ||
            lastText.includes(q) ||
            groupName.includes(q)
          );
        });
    return filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastTime - a.lastTime;
    });
  }, [conversations, messagesByConvId, peerInfoByConvId, searchQuery, pinnedIds]);

  return (
    <aside
      className={cn(
        "flex flex-col h-full border-r border-white/[0.06] bg-black",
        className,
      )}
    >
      <ProfileChip />

      <div className="px-3 pb-2 flex gap-1.5">
        <button
          onClick={onNewChat}
          className="flex-1 bg-white text-black text-[13px] font-medium rounded-md px-2.5 py-1.5 flex items-center justify-center gap-1.5 hover:bg-white/90 transition-colors"
        >
          <Plus className="size-3.5" />
          New chat
        </button>
        <Link
          href="/directory"
          className="border border-white/[0.1] text-white/70 text-[13px] font-medium rounded-md px-2.5 py-1.5 hover:bg-white/[0.04] hover:text-white transition-colors flex items-center justify-center"
          title="Agent directory"
        >
          <Sparkles className="size-3.5" />
        </Link>
        <button
          onClick={() => void refreshConversations()}
          disabled={conversationsLoading}
          className="border border-white/[0.1] text-white/55 hover:text-white hover:bg-white/[0.04] rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-50 flex items-center justify-center"
          aria-label="Refresh"
          title="Refresh"
        >
          {conversationsLoading ? <Spinner size={13} /> : <RefreshCw className="size-3.5" />}
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="size-3 text-white/30 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full rounded-md bg-white/[0.03] border border-white/[0.07] pl-7 pr-7 py-1.5 text-[12px] text-white outline-none focus:border-white/20 transition-colors placeholder:text-white/30"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white p-0.5"
              aria-label="Clear"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-3">
        {conversationsLoading && conversations.length === 0 ? (
          <ConversationSkeleton />
        ) : filteredAndSorted.length === 0 ? (
          searchQuery ? (
            <div className="text-center text-xs text-white/40 px-4 py-8">
              Nothing matches &ldquo;{searchQuery}&rdquo;
            </div>
          ) : (
            <SidebarEmpty />
          )
        ) : (
          <div className="px-2 flex flex-col gap-0.5">
            {filteredAndSorted.map(({ conv, lastMessage, pinned }) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                peerInfo={peerInfoByConvId.get(conv.id)}
                active={conv.id === activeConversationId}
                unread={unreadByConvId.get(conv.id) ?? 0}
                lastMessage={lastMessage}
                pinned={pinned}
                muted={mutedIds.has(conv.id)}
                onSelect={() => setActiveConversationId(conv.id)}
                onTogglePin={() => togglePin(conv.id)}
                onToggleMute={() => toggleMute(conv.id)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
