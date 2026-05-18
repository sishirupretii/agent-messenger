"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Plus, Sparkles, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useChat } from "@/context/ChatProvider";
import { ConversationItem } from "./ConversationItem";
import { SidebarEmpty } from "./EmptyState";
import { Spinner } from "@/components/ui/Spinner";
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
  } = useChat();

  const sorted = useMemo(() => {
    const withTime = conversations.map((c) => {
      const msgs = messagesByConvId.get(c.id) ?? [];
      const last = msgs[msgs.length - 1];
      const ns = (last as unknown as { sentAtNs?: bigint } | undefined)?.sentAtNs;
      const t = ns ? Number(ns / 1_000_000n) : 0;
      return { conv: c, lastTime: t, lastMessage: last };
    });
    return withTime.sort((a, b) => b.lastTime - a.lastTime);
  }, [conversations, messagesByConvId]);

  return (
    <aside
      className={cn(
        "flex flex-col h-full border-r border-white/[0.06] bg-black/20",
        className,
      )}
    >
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
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

      <div className="flex gap-1.5 px-3 pb-3">
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

      <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-1">
        {sorted.length === 0 && !conversationsLoading ? (
          <SidebarEmpty />
        ) : (
          sorted.map(({ conv, lastMessage }) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              peerInfo={peerInfoByConvId.get(conv.id)}
              active={conv.id === activeConversationId}
              unread={unreadByConvId.get(conv.id) ?? 0}
              lastMessage={lastMessage}
              onSelect={() => setActiveConversationId(conv.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
