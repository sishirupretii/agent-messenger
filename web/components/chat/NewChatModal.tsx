"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useChat } from "@/context/ChatProvider";
import { Spinner } from "@/components/ui/Spinner";

export function NewChatModal({
  open,
  onClose,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  prefill?: string;
}) {
  const { openOrCreateDmWith, setActiveConversationId } = useChat();
  const [address, setAddress] = useState("");
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (open) setAddress(prefill ?? "");
  }, [open, prefill]);

  async function go() {
    if (opening) return;
    setOpening(true);
    const dm = await openOrCreateDmWith(address);
    setOpening(false);
    if (dm) {
      setActiveConversationId(dm.id);
      onClose();
    }
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
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold text-white">New chat</h2>
                <p className="text-xs text-white/50 mt-0.5">
                  Enter a wallet address. They must have XMTP enabled.
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-white/50 hover:text-white p-1 -mr-1 -mt-1"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void go();
              }}
              placeholder="0x…"
              className="w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2.5 text-sm font-mono text-white outline-none focus:border-white/25 transition-colors"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={onClose}
                className="text-sm text-white/60 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={go}
                disabled={opening || !address.trim()}
                className="brand-gradient text-white text-sm font-medium rounded-lg px-4 py-1.5 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity"
              >
                {opening && <Spinner size={12} />}
                {opening ? "Opening…" : "Open chat"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
