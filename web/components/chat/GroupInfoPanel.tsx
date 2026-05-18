"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { X, Users, LogOut } from "lucide-react";
import type { Conversation } from "@xmtp/browser-sdk";
import { PeerAvatar } from "@/components/ui/Avatar";
import { PeerName } from "@/components/ui/PeerName";
import { shortAddress } from "@/lib/format";
import { getGroupName } from "@/lib/conversation";
import { Spinner } from "@/components/ui/Spinner";
import { useChat } from "@/context/ChatProvider";

type MemberEntry = {
  inboxId: string;
  address: string | null;
  isSelf: boolean;
};

export function GroupInfoPanel({
  open,
  onClose,
  group,
  ownInboxId,
}: {
  open: boolean;
  onClose: () => void;
  group: Conversation;
  ownInboxId: string | null;
}) {
  const { leaveGroup } = useChat();
  const [members, setMembers] = useState<MemberEntry[] | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMembers(null);
    (async () => {
      try {
        const ms = await group.members();
        if (cancelled) return;
        const entries: MemberEntry[] = ms.map((m) => {
          const identifiers = (
            m as unknown as {
              accountIdentifiers?: Array<{ identifier: string }>;
            }
          ).accountIdentifiers;
          const addr = identifiers?.[0]?.identifier ?? null;
          return {
            inboxId: m.inboxId,
            address: addr ? addr.toLowerCase() : null,
            isSelf: m.inboxId === ownInboxId,
          };
        });
        setMembers(entries);
      } catch (e) {
        console.error("group.members failed", e);
        if (!cancelled) setMembers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, group, ownInboxId]);

  const groupName = getGroupName(group);

  async function handleLeave() {
    if (leaving) return;
    if (!confirm(`Leave "${groupName ?? "this group"}"?`)) return;
    setLeaving(true);
    const ok = await leaveGroup(group.id);
    setLeaving(false);
    if (ok) onClose();
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
            className="w-full max-w-md glass-strong rounded-2xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="size-10 rounded-full brand-gradient flex items-center justify-center flex-shrink-0">
                  <Users className="size-5 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold text-white truncate">
                    {groupName ?? "Untitled group"}
                  </div>
                  <div className="text-xs text-white/40">
                    {members ? `${members.length} members` : "loading members…"}
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-white/50 hover:text-white p-1"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 px-1">
              Members
            </div>

            <div className="glass rounded-xl flex flex-col divide-y divide-white/[0.05] max-h-80 overflow-y-auto">
              {members === null ? (
                <div className="flex items-center justify-center py-6">
                  <Spinner size={16} className="text-white/40" />
                </div>
              ) : members.length === 0 ? (
                <div className="text-center text-xs text-white/40 py-4">
                  No members to show
                </div>
              ) : (
                members.map((m) => (
                  <div
                    key={m.inboxId}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <PeerAvatar address={m.address} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">
                        {m.address ? (
                          <PeerName address={m.address} />
                        ) : (
                          shortAddress(m.inboxId, 6, 4)
                        )}
                        {m.isSelf && (
                          <span className="ml-1.5 text-[10px] text-white/40">
                            (you)
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-white/40 truncate">
                        {m.address ?? `inbox: ${m.inboxId.slice(0, 16)}…`}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-white/[0.06] pt-3 mt-4">
              <button
                onClick={handleLeave}
                disabled={leaving}
                className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-300 text-sm font-medium rounded-xl px-3 py-2 flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {leaving ? <Spinner size={12} /> : <LogOut className="size-3.5" />}
                {leaving ? "Leaving…" : "Leave group"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
