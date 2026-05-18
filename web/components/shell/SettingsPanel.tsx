"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Github, ExternalLink, Trash2, LogOut, Volume2, BellRing, UserPen, Droplets } from "lucide-react";
import { useState } from "react";
import { useDisconnect } from "wagmi";
import { toast } from "sonner";
import { useChat } from "@/context/ChatProvider";
import { shortAddress } from "@/lib/format";
import { ding, requestNotificationPermission } from "@/lib/notifications";
import { useDisplayName } from "@/hooks/useDisplayName";

export function SettingsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { ownAddress, ownInboxId, client } = useChat();
  const { disconnect } = useDisconnect();
  const [clearingDb, setClearingDb] = useState(false);
  const [displayName, setDisplayName] = useDisplayName();
  const [draftName, setDraftName] = useState<string | null>(null);

  async function clearLocalDb() {
    if (clearingDb) return;
    if (!confirm("Clear local XMTP data? You'll need to re-enable messaging.")) {
      return;
    }
    setClearingDb(true);
    try {
      // Wipe IndexedDB databases used by XMTP (OPFS storage too if any)
      if ("indexedDB" in window && indexedDB.databases) {
        const dbs = await indexedDB.databases();
        await Promise.all(
          dbs.map(
            (db) =>
              new Promise<void>((resolve) => {
                if (!db.name) return resolve();
                const req = indexedDB.deleteDatabase(db.name);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              }),
          ),
        );
      }
      // also clear localStorage entries from wagmi/wc
      try {
        localStorage.clear();
      } catch {
        // ignore
      }
      toast.success("Local data cleared", {
        description: "Reloading…",
      });
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Couldn't clear data", { description: msg });
      setClearingDb(false);
    }
  }

  async function testNotifications() {
    const granted = await requestNotificationPermission();
    if (!granted) {
      toast.error("Notifications blocked", {
        description: "Enable in your browser settings.",
      });
      return;
    }
    try {
      new Notification("Test notification", {
        body: "You'll see something like this when a message arrives while this tab is hidden.",
        icon: "/favicon.ico",
      });
      toast.success("Sent test notification");
    } catch {
      toast.error("Couldn't show notification");
    }
  }

  function testSound() {
    ding();
    toast.success("That's the new-message sound");
  }

  function handleDisconnect() {
    disconnect();
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="w-full max-w-md glass-strong rounded-lg p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Settings</h2>
              <button
                onClick={onClose}
                className="text-white/50 hover:text-white p-1 -mr-1 -mt-1"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <Section label="Profile">
              <div className="px-3 py-2.5 flex items-center gap-2.5">
                <UserPen className="size-3.5 text-white/50 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white">Display name</div>
                  <div className="text-[11px] text-white/40">
                    Shown locally in your sidebar (not visible to others).
                  </div>
                </div>
              </div>
              <div className="px-3 pb-2.5 flex gap-1.5">
                <input
                  type="text"
                  value={draftName ?? displayName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="e.g. me"
                  className="flex-1 rounded-md bg-white/[0.04] border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/25 transition-colors"
                />
                <button
                  onClick={() => {
                    if (draftName !== null) {
                      setDisplayName(draftName);
                      setDraftName(null);
                      toast.success("Saved");
                    }
                  }}
                  disabled={draftName === null || draftName === displayName}
                  className="bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-xs rounded-md px-2 py-1 transition-colors"
                >
                  Save
                </button>
              </div>
            </Section>

            <Section label="Identity">
              <Row label="Wallet">
                <span className="font-mono text-white">
                  {ownAddress ? shortAddress(ownAddress, 8, 6) : "—"}
                </span>
              </Row>
              <Row label="Inbox ID">
                <span className="font-mono text-white/80 text-[11px]">
                  {ownInboxId ? `${ownInboxId.slice(0, 12)}…` : "—"}
                </span>
              </Row>
              <Row label="XMTP env">
                <span className="text-white">
                  {process.env.NEXT_PUBLIC_XMTP_ENV ?? "dev"}
                </span>
              </Row>
              <Row label="Installation ID">
                <span className="font-mono text-white/60 text-[11px]">
                  {client?.installationId
                    ? `${client.installationId.slice(0, 12)}…`
                    : "—"}
                </span>
              </Row>
            </Section>

            <Section label="Base Sepolia">
              <a
                href="https://docs.base.org/chain/network-faucets"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors group"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <Droplets className="size-3.5 text-white/50 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-white truncate">
                      Get testnet ETH
                    </div>
                    <div className="text-[11px] text-white/40 truncate">
                      Base&apos;s curated faucet list — needed to send payments.
                    </div>
                  </div>
                </div>
                <ExternalLink className="size-3 text-white/40 group-hover:text-white flex-shrink-0" />
              </a>
            </Section>

            <Section label="Notifications">
              <ActionRow
                icon={BellRing}
                label="Browser notifications"
                hint="Pop-up when a DM arrives & tab is hidden."
                actionLabel="Test"
                onAction={testNotifications}
              />
              <ActionRow
                icon={Volume2}
                label="Sound"
                hint="Soft ding on new messages."
                actionLabel="Test"
                onAction={testSound}
              />
            </Section>

            <Section label="Data">
              <ActionRow
                icon={Trash2}
                label="Clear local data"
                hint="Wipes XMTP DB + wallet cache. You'll re-sign next time."
                actionLabel={clearingDb ? "…" : "Clear"}
                onAction={clearLocalDb}
                danger
              />
              <ActionRow
                icon={LogOut}
                label="Disconnect wallet"
                hint="Sign out of the dApp (XMTP identity stays)."
                actionLabel="Disconnect"
                onAction={handleDisconnect}
              />
            </Section>

            <div className="border-t border-white/[0.06] pt-3 mt-2">
              <a
                href="https://github.com/sishirupretii/agent-messenger"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-xs text-white/60 hover:text-white transition-colors"
              >
                <Github className="size-3.5" />
                View source on GitHub
                <ExternalLink className="size-3 opacity-50" />
              </a>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 px-1">
        {label}
      </div>
      <div className="glass rounded-md divide-y divide-white/[0.05]">{children}</div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
      <span className="text-white/50">{label}</span>
      <div className="truncate min-w-0">{children}</div>
    </div>
  );
}

function ActionRow({
  icon: Icon,
  label,
  hint,
  actionLabel,
  onAction,
  danger,
}: {
  icon: typeof X;
  label: string;
  hint: string;
  actionLabel: string;
  onAction: () => void;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon className="size-3.5 text-white/50 mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-xs text-white truncate">{label}</div>
          <div className="text-[11px] text-white/40 truncate">{hint}</div>
        </div>
      </div>
      <button
        onClick={onAction}
        className={`text-xs rounded-md px-2 py-1 flex-shrink-0 transition-colors ${
          danger
            ? "bg-red-500/15 text-red-300 hover:bg-red-500/25"
            : "bg-white/10 text-white hover:bg-white/20"
        }`}
      >
        {actionLabel}
      </button>
    </div>
  );
}
