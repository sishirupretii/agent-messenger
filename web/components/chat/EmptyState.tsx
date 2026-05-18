"use client";

import { motion } from "framer-motion";

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
      <div className="space-y-2 max-w-sm">
        <h2 className="font-display text-[22px] sm:text-2xl font-semibold tracking-tight text-white">
          Your wallet is your identity.
        </h2>
        <p className="text-sm text-white/50 leading-relaxed">
          Start a conversation with any wallet, ENS, or Basename.
        </p>
      </div>
      <div className="flex gap-2 text-sm">
        <button
          onClick={onNewChat}
          className="bg-white text-black font-medium rounded-md px-3.5 py-1.5 hover:bg-white/90 transition-colors"
        >
          New chat
        </button>
        <button
          onClick={onBrowseAgents}
          className="border border-white/[0.12] text-white font-medium rounded-md px-3.5 py-1.5 hover:bg-white/[0.04] transition-colors"
        >
          Browse agents
        </button>
      </div>
    </motion.div>
  );
}

export function SidebarEmpty() {
  return (
    <div className="flex flex-col items-center justify-center text-center px-4 py-8">
      <p className="text-[13px] text-white font-medium font-display">
        Your wallet is your identity.
      </p>
      <p className="text-[11px] text-white/45 mt-1 max-w-[220px] leading-relaxed">
        Start a conversation with any wallet, ENS, or Basename.
      </p>
    </div>
  );
}
