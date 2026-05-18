"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { SmilePlus, Reply, CornerUpLeft, Copy } from "lucide-react";
import { toast } from "sonner";
import type { DecodedMessage } from "@xmtp/browser-sdk";
import { cn } from "@/lib/cn";
import { formatTime, nsToDate } from "@/lib/format";
import { renderTextWithLinks } from "@/lib/text";
import { normalizeMessageContent } from "@/lib/message";
import { ReactionPicker } from "./ReactionPicker";
import { ReactionRow } from "./ReactionRow";
import { useChat } from "@/context/ChatProvider";

export function MessageBubble({
  message,
  isMine,
  showTime,
  onReply,
}: {
  message: DecodedMessage;
  isMine: boolean;
  showTime: boolean;
  onReply: (msg: DecodedMessage) => void;
}) {
  const { sendReaction, ownInboxId } = useChat();
  const [pickerOpen, setPickerOpen] = useState(false);

  const { text, replyTo, isReply } = normalizeMessageContent(message);
  if (!text) return null;

  const sentAt = (() => {
    try {
      const ns = (message as unknown as { sentAtNs?: bigint }).sentAtNs;
      if (ns) return nsToDate(ns);
    } catch {
      // ignore
    }
    return null;
  })();

  const replyPreview = (() => {
    if (!isReply || !replyTo) return null;
    const inner = normalizeMessageContent(replyTo);
    return inner.text ? inner.text.slice(0, 120) : "message";
  })();

  function handlePick(emoji: string) {
    setPickerOpen(false);
    void sendReaction(message.id, emoji, "add");
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn("group flex w-full", isMine ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "flex max-w-[80%] flex-col gap-1 relative",
          isMine && "items-end",
        )}
      >
        <div className="relative">
          <div
            className={cn(
              "rounded-2xl px-3.5 py-2 text-sm leading-snug break-words shadow-sm",
              isMine
                ? "bg-white text-black"
                : "bg-white/[0.06] text-white/95 border border-white/10",
            )}
          >
            {replyPreview && (
              <div
                className={cn(
                  "rounded-lg px-2 py-1 mb-1 flex items-start gap-1.5 text-[11px] leading-snug border-l-2",
                  isMine
                    ? "bg-black/5 border-black/30 text-black/60"
                    : "bg-white/[0.05] border-violet-400/50 text-white/55",
                )}
              >
                <CornerUpLeft className="size-3 mt-0.5 flex-shrink-0 opacity-60" />
                <span className="truncate">{replyPreview}</span>
              </div>
            )}
            <div>{renderTextWithLinks(text, isMine)}</div>
          </div>

          <div
            className={cn(
              "absolute top-0 hidden group-hover:flex items-center gap-0.5 -translate-y-1/2 z-10",
              isMine ? "-left-20" : "-right-20",
            )}
          >
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className="size-6 rounded-full glass-strong flex items-center justify-center text-white/70 hover:text-white transition-colors"
              aria-label="React"
            >
              <SmilePlus className="size-3" />
            </button>
            <button
              onClick={() => onReply(message)}
              className="size-6 rounded-full glass-strong flex items-center justify-center text-white/70 hover:text-white transition-colors"
              aria-label="Reply"
            >
              <Reply className="size-3" />
            </button>
            <button
              onClick={copyText}
              className="size-6 rounded-full glass-strong flex items-center justify-center text-white/70 hover:text-white transition-colors"
              aria-label="Copy"
            >
              <Copy className="size-3" />
            </button>
          </div>

          <ReactionPicker
            open={pickerOpen}
            onPick={handlePick}
            align={isMine ? "right" : "left"}
          />
        </div>

        <ReactionRow
          message={message}
          ownInboxId={ownInboxId}
          align={isMine ? "right" : "left"}
          onToggle={(emoji, action) => sendReaction(message.id, emoji, action)}
        />

        {showTime && sentAt && (
          <span className="text-[10px] text-white/30 px-1">
            {formatTime(sentAt)}
          </span>
        )}
      </div>
    </motion.div>
  );
}
