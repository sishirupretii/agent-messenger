"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

const SAMPLE: Array<{ text: string; mine: boolean }> = [
  { text: "gm", mine: false },
  { text: "send CA", mine: true },
  { text: "bridge to base", mine: false },
  { text: "build never stops", mine: true },
  { text: "wallet is identity", mine: false },
];

/**
 * Static demo bubbles rendered in an empty conversation. Semi-transparent
 * so it reads as "preview, not real". Replaced by real messages as soon as
 * the conversation gets one.
 */
export function GhostMessages() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.55 }}
      transition={{ duration: 0.4 }}
      className="flex-1 flex flex-col justify-center gap-2 max-w-md mx-auto w-full px-2 pointer-events-none select-none"
    >
      <div className="text-center text-[11px] uppercase tracking-[0.18em] text-white/30 mb-4">
        Preview · no messages yet
      </div>
      {SAMPLE.map((m, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + i * 0.06, duration: 0.25 }}
          className={cn(
            "flex w-full",
            m.mine ? "justify-end" : "justify-start",
          )}
        >
          <div
            className={cn(
              "rounded-xl px-3 py-1.5 text-[13.5px] leading-snug max-w-[78%]",
              m.mine
                ? "bg-white/[0.85] text-black/70"
                : "bg-white/[0.04] text-white/65 border border-white/[0.06]",
            )}
          >
            {m.text}
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
