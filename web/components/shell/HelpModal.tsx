"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Keyboard } from "lucide-react";
import { shortcutLabel } from "@/hooks/useKeyboardShortcuts";

const shortcuts: Array<{ keys: string[]; label: string }> = [
  { keys: [shortcutLabel("K")], label: "New chat" },
  { keys: [shortcutLabel(",")], label: "Open settings" },
  { keys: ["?"], label: "Show this help" },
  { keys: ["Esc"], label: "Close modal / clear reply" },
  { keys: ["Enter"], label: "Send message" },
  { keys: ["Shift", "Enter"], label: "New line in message" },
];

export function HelpModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
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
            className="w-full max-w-sm glass-strong rounded-2xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <Keyboard className="size-4 text-white/60" />
                <h2 className="text-lg font-semibold text-white">
                  Keyboard shortcuts
                </h2>
              </div>
              <button
                onClick={onClose}
                className="text-white/50 hover:text-white p-1 -mr-1 -mt-1"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="glass rounded-xl divide-y divide-white/[0.05]">
              {shortcuts.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="text-xs text-white/80">{s.label}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        className="text-[10px] font-mono bg-white/[0.06] border border-white/10 rounded px-1.5 py-0.5 text-white/90"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
