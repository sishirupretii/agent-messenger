"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Plus, Sparkles, RefreshCw, Search, X } from "lucide-react";
import Link from "next/link";
import { useChat } from "@/context/ChatProvider";
import { ConversationItem } from "./ConversationItem";
import { ConversationSkeleton } from "./ConversationSkeleton";
import { SidebarEmpty } from "./EmptyState";
import { ProfileChip } from "@/components/shell/ProfileChip";
import { Spinner } from "@/components/ui/Spinner";
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
        "flex flex-col h-full border-r border-white/[0.06] bg-black/20",
        className,
      )}
    >
      <ProfileChip />
      <div className="flex items-center justify-between px-3 pt-2 pb-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-white/40 px-1">
          Chats
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void refreshConversations()}
            disabled={conversationsLoading}
            className="text-white/40 hover:text-white/80 p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors disabled:opacity-50"
            aria-label="Refresh"
          >
            {conversationsLoading ? (
              <Spinner size={14} />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 px-3 pb-2">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onNewChat}
          className="flex-1 brand-gradient text-white text-sm font-medium rounded-xl px-3 py-2 flex items-center justify-center gap-1.5 shadow-md"
        >
          <Plus className="size-4" />
          New chat
        </motion.button>
        <Link
          href="/directory"
          className="glass text-white text-sm font-medium rounded-xl px-3 py-2 hover:bg-white/[0.06] transition-colors flex items-center gap-1.5"
          title="Agent directory"
        >
          <Sparkles className="size-4" />
        </Link>
      </div>

      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="size-3.5 text-white/30 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats…"
            className="w-full rounded-xl bg-white/[0.03] border border-white/10 pl-8 pr-7 py-1.5 text-xs text-white outline-none focus:border-white/20 transition-colors placeholder:text-white/30"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white p-0.5"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-3 flex flex-col gap-1">
        {conversationsLoading && conversations.length === 0 ? (
          <ConversationSkeleton />
        ) : filteredAndSorted.length === 0 ? (
          searchQuery ? (
            <div className="text-center text-xs text-white/40 px-4 py-8">
              No chats match “{searchQuery}”
            </div>
          ) : (
            <SidebarEmpty />
          )
        ) : (
          <div className="px-2 flex flex-col gap-1">
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
