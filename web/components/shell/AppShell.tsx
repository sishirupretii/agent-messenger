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
import { OnboardingTour } from "@/components/chat/OnboardingTour";
import { SettingsPanel } from "./SettingsPanel";
import { HelpModal } from "./HelpModal";
import { useKeyboardShortcuts, shortcutLabel } from "@/hooks/useKeyboardShortcuts";
import { useAgents } from "@/hooks/useAgents";
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

  const { agents } = useAgents();

  // Keyboard-shortcut hint as a small inline toast once per session
  // (independent of the full OnboardingTour, which handles the 3-step
  // walk-through). Cleared via the same legacy localStorage key.
  useEffect(() => {
    if (!client) return;
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem(ONBOARDING_KEY)) return;
      const tipShortcut = shortcutLabel("K");
      toast(`Tip: press ${tipShortcut} to start a new chat anywhere.`, {
        duration: 5000,
      });
      localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      // ignore
    }
  }, [client]);

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
        <OnboardingTour active={!!client} />
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
          className="w-full max-w-md flex flex-col items-start gap-6"
        >
          <div className="font-mono text-[11px] text-[var(--accent)]">
            $ signa enable --xmtp
          </div>
          <div className="space-y-3">
            <h1 className="font-display text-[30px] sm:text-[36px] font-semibold tracking-[-0.035em] leading-tight">
              Sign once. Stay signed in forever.
            </h1>
            <p className="text-[14px] text-white/65 leading-relaxed">
              one signature derives your XMTP V3 identity from your wallet.
              no gas, no account, no password. ~10–30s the first time,
              instant after.
            </p>
          </div>
          <button
            onClick={initXmtp}
            disabled={initStatus === "loading"}
            className="bg-[var(--accent)] text-black font-semibold rounded-md px-5 py-2.5 text-[14px] uppercase tracking-wide disabled:opacity-60 inline-flex items-center gap-2 hover:brightness-110 transition"
          >
            {initStatus === "loading" && <Spinner size={12} className="text-black" />}
            {initStatus === "loading" ? "Signing… check wallet" : "Enable messaging"}
            {initStatus !== "loading" && (
              <span aria-hidden className="font-mono">→</span>
            )}
          </button>
          {initError && (
            <div className="card rounded-md px-3 py-2 text-xs text-[var(--error)] break-words w-full">
              {initError}
            </div>
          )}
          <div className="mt-2 border border-white/10 bg-black/30 font-mono text-[11px] leading-[1.85] px-3 py-2 text-white/65 w-full">
            <span className="text-[var(--accent)]">protocol</span>
            <span className="text-white/30"> = </span>
            <span>XMTP V3 (MLS) · end-to-end encrypted · on @base</span>
          </div>
        </motion.div>
      </main>
      <SettingsPanel open={settingsOpen} onClose={onCloseSettings} />
    </>
  );
}
