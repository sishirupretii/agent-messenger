"use client";

import { motion } from "framer-motion";
import { MessageSquare, Sparkles } from "lucide-react";

export function ConversationEmptyState({
  onNewChat,
  onBrowseAgents,
}: {
  onNewChat: () => void;
  onBrowseAgents: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-1 flex-col items-center justify-center p-8 text-center gap-5"
    >
      <div className="relative">
        <div className="absolute inset-0 brand-gradient blur-2xl opacity-40 rounded-full" />
        <div className="relative size-16 rounded-2xl glass-strong flex items-center justify-center">
          <MessageSquare className="size-7 text-white/80" />
        </div>
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-white">
          No chat selected
        </h2>
        <p className="text-sm text-white/50 max-w-xs">
          Pick a conversation from the sidebar, start a new one with any wallet, or browse agents.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onNewChat}
          className="brand-gradient text-white text-sm font-medium rounded-xl px-4 py-2 hover:opacity-90 transition-opacity"
        >
          New chat
        </button>
        <button
          onClick={onBrowseAgents}
          className="glass text-white text-sm font-medium rounded-xl px-4 py-2 hover:bg-white/[0.06] transition-colors flex items-center gap-1.5"
        >
          <Sparkles className="size-3.5" />
          Browse agents
        </button>
      </div>
    </motion.div>
  );
}

export function SidebarEmpty() {
  return (
    <div className="flex flex-col items-center justify-center text-center px-4 py-8 text-white/40">
      <MessageSquare className="size-5 mb-2 opacity-50" />
      <p className="text-xs">No conversations yet</p>
      <p className="text-[11px] text-white/30 mt-0.5">
        Tap “New chat” to start one
      </p>
    </div>
  );
}
