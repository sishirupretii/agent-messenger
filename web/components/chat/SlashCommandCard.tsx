"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import type { SlashRoute } from "@/lib/slash-commands";

export function SlashCommandCard({
  match,
}: {
  match: { route: SlashRoute; rest: string } | null;
}) {
  return (
    <AnimatePresence>
      {match && (
        <motion.a
          key={match.route.key}
          href={match.route.build(match.rest)}
          target="_blank"
          rel="noreferrer"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
          className="card rounded-md px-3 py-2 flex items-center gap-2.5 text-xs hover:bg-white/[0.04] transition-colors group"
        >
          <div className="size-7 rounded-md bg-[var(--accent-dim)] border border-[var(--accent)]/25 flex items-center justify-center text-[10px] uppercase tracking-wider font-semibold text-[var(--accent)] flex-shrink-0">
            /{match.route.key}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] text-white font-medium truncate">
              {match.route.label}
            </div>
            <div className="text-[11px] text-white/45 truncate">
              {match.route.hint}
              {match.rest ? ` · "${match.rest}"` : ""}
            </div>
          </div>
          <ArrowUpRight className="size-3.5 text-white/40 group-hover:text-[var(--accent)] flex-shrink-0" />
        </motion.a>
      )}
    </AnimatePresence>
  );
}
