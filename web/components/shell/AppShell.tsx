"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Spinner } from "@/components/ui/Spinner";
import { useChat } from "@/context/ChatProvider";
import { Sidebar } from "@/components/chat/Sidebar";
import { ConversationView } from "@/components/chat/ConversationView";
import { ConversationEmptyState } from "@/components/chat/EmptyState";
import { NewChatModal } from "@/components/chat/NewChatModal";
import { cn } from "@/lib/cn";

export function AppShell() {
  const {
    initStatus,
    initError,
    initXmtp,
    activeConversationId,
    setActiveConversationId,
    client,
  } = useChat();

  const [modalOpen, setModalOpen] = useState(false);
  const [modalPrefill, setModalPrefill] = useState<string | undefined>();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Handle ?to=0x... deep link from agent directory
  useEffect(() => {
    const to = searchParams.get("to");
    if (to && client) {
      setModalPrefill(to);
      setModalOpen(true);
      router.replace("/");
    }
  }, [searchParams, client, router]);

  if (initStatus === "ready" && client) {
    return (
      <div className="flex flex-1 min-h-0">
        <Sidebar
          onNewChat={() => {
            setModalPrefill(undefined);
            setModalOpen(true);
          }}
          className={cn(
            "w-full lg:w-80 lg:flex",
            activeConversationId ? "hidden lg:flex" : "flex",
          )}
        />
        <main
          className={cn(
            "flex-1 min-h-0 flex flex-col",
            activeConversationId ? "flex" : "hidden lg:flex",
          )}
        >
          {activeConversationId ? (
            <ConversationView onBack={() => setActiveConversationId(null)} />
          ) : (
            <ConversationEmptyState
              onNewChat={() => {
                setModalPrefill(undefined);
                setModalOpen(true);
              }}
              onBrowseAgents={() => router.push("/directory")}
            />
          )}
        </main>
        <NewChatModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          prefill={modalPrefill}
        />
      </div>
    );
  }

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md flex flex-col items-center gap-5 text-center"
      >
        <div className="relative">
          <div className="absolute inset-0 brand-gradient blur-3xl opacity-50 rounded-full" />
          <div className="relative size-14 rounded-2xl brand-gradient shadow-2xl" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            Enable XMTP messaging
          </h1>
          <p className="text-sm text-white/55 max-w-sm">
            One-time signature to derive your XMTP identity. No gas. Takes ~10–30s the
            first time, instant after.
          </p>
        </div>
        <motion.button
          whileHover={{ scale: initStatus === "loading" ? 1 : 1.03 }}
          whileTap={{ scale: initStatus === "loading" ? 1 : 0.97 }}
          onClick={initXmtp}
          disabled={initStatus === "loading"}
          className="brand-gradient text-white font-medium rounded-xl px-6 py-3 shadow-lg disabled:opacity-70 flex items-center gap-2"
        >
          {initStatus === "loading" && <Spinner size={14} />}
          {initStatus === "loading"
            ? "Setting up… check your wallet"
            : "Enable messaging"}
        </motion.button>
        {initError && (
          <div className="glass rounded-xl px-3 py-2 text-xs text-red-300 break-words max-w-sm">
            {initError}
          </div>
        )}
      </motion.div>
    </main>
  );
}
