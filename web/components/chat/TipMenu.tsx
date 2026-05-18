"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Zap } from "lucide-react";
import { cn } from "@/lib/cn";

const TIP_AMOUNTS = ["0.0005", "0.001", "0.005"];

export function TipMenu({
  open,
  align,
  onPick,
}: {
  open: boolean;
  align: "left" | "right";
  onPick: (amount: string) => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 4 }}
          transition={{ duration: 0.14 }}
          className={cn(
            "absolute -top-9 z-10 card-raised rounded-md px-1 py-1 flex gap-0.5 shadow-xl",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {TIP_AMOUNTS.map((amount) => (
            <button
              key={amount}
              onClick={() => onPick(amount)}
              className="text-[10px] rounded-sm px-1.5 py-1 text-white/85 hover:bg-white/10 hover:text-[var(--accent)] transition-colors flex items-center gap-0.5 font-mono"
            >
              <Zap className="size-2.5" />
              {amount}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
