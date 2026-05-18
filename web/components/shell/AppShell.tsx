"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/Spinner";
import { useChat } from "@/context/ChatProvider";
import { Sidebar } from "@/components/chat/Sidebar";
import { ConversationView } from "@/components/chat/ConversationView";
import { ConversationEmptyState } from "@/components/chat/EmptyState";
import { NewChatModal } from "@/components/chat/NewChatModal";
import { SettingsPanel } from "./SettingsPanel";
import { HelpModal } from "./HelpModal";
import { useKeyboardShortcuts, shortcutLabel } from "@/hooks/useKeyboardShortcuts";
import { listAgents } from "@/lib/agents";
import { cn } from "@/lib/cn";

const ONBOARDING_KEY = "agent-messenger:onboarded";

export function AppShell({
  settingsOpen,
  onCloseSettings,
  onOpenSettings,
}: {
  settingsOpen: boolean;
  onCloseSettings: () => void;
  onOpenSettings: () => void;
}) {
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
  const [helpOpen, setHelpOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useKeyboardShortcuts({
    onNewChat: () => {
      setModalPrefill(undefined);
      setModalOpen(true);
    },
    onSettings: onOpenSettings,
    onHelp: () => setHelpOpen((v) => !v),
    onEscape: () => {
      if (helpOpen) setHelpOpen(false);
      else if (modalOpen) setModalOpen(false);
      else if (settingsOpen) onCloseSettings();
    },
  });

  // Handle ?to=0x... deep link from agent directory
  useEffect(() => {
    const to = searchParams.get("to");
    if (to && client) {
      setModalPrefill(to);
      setModalOpen(true);
      router.replace("/");
    }
  }, [searchParams, client, router]);

  // One-time onboarding hint after XMTP is ready
  useEffect(() => {
    if (!client) return;
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem(ONBOARDING_KEY)) return;
      const agents = listAgents();
      const tipShortcut = shortcutLabel("K");
      const action =
        agents.length > 0
          ? {
              label: "Browse agents",
              onClick: () => router.push("/directory"),
            }
          : {
              label: "New chat",
              onClick: () => {
                setModalPrefill(undefined);
                setModalOpen(true);
              },
            };
      toast(
        agents.length > 0
          ? "You're in. Browse agents to start a chat."
          : "You're in. Start a chat with any wallet address.",
        {
          description: `Tip: press ${tipShortcut} anywhere to open the new-chat shortcut.`,
          duration: 8000,
          action,
        },
      );
      localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      // ignore
    }
  }, [client, router]);

  if (initStatus === "ready" && client) {
    return (
      <>
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
        </div>
        <NewChatModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          prefill={modalPrefill}
        />
        <SettingsPanel open={settingsOpen} onClose={onCloseSettings} />
        <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      </>
    );
  }

  return (
    <>
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
      <SettingsPanel open={settingsOpen} onClose={onCloseSettings} />
    </>
  );
}
