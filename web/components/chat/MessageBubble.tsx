"use client";

import { motion } from "framer-motion";
import type { DecodedMessage } from "@xmtp/browser-sdk";
import { cn } from "@/lib/cn";
import { formatTime, nsToDate } from "@/lib/format";

export function MessageBubble({
  message,
  isMine,
  showTime,
}: {
  message: DecodedMessage;
  isMine: boolean;
  showTime: boolean;
}) {
  const content = typeof message.content === "string" ? message.content : "";
  if (!content) return null;

  const sentAt = (() => {
    try {
      const ns = (message as unknown as { sentAtNs?: bigint }).sentAtNs;
      if (ns) return nsToDate(ns);
    } catch {
      // ignore
    }
    return null;
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "flex w-full",
        isMine ? "justify-end" : "justify-start",
      )}
    >
      <div className={cn("flex max-w-[80%] flex-col gap-1", isMine && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-sm leading-snug break-words shadow-sm",
            isMine
              ? "bg-white text-black"
              : "bg-white/[0.06] text-white/95 border border-white/10",
          )}
        >
          {content}
        </div>
        {showTime && sentAt && (
          <span className="text-[10px] text-white/30 px-1">
            {formatTime(sentAt)}
          </span>
        )}
      </div>
    </motion.div>
  );
}
