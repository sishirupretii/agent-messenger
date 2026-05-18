"use client";

import { useState, type KeyboardEvent } from "react";
import { ArrowUp, X, CornerDownRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { parseSlash } from "@/lib/slash-commands";
import { SlashCommandCard } from "./SlashCommandCard";

export type ReplyTarget = {
  id: string;
  preview: string;
  authorLabel: string;
};

export function MessageInput({
  disabled,
  replyTarget,
  onClearReply,
  onSend,
}: {
  disabled?: boolean;
  replyTarget: ReplyTarget | null;
  onClearReply: () => void;
  onSend: (text: string, replyToId?: string) => Promise<void> | void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const slashMatch = parseSlash(text);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending || disabled) return;
    setSending(true);
    setText("");
    try {
      await onSend(trimmed, replyTarget?.id);
      onClearReply();
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
    if (e.key === "Escape" && replyTarget) {
      onClearReply();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {replyTarget && (
        <div className="card rounded-md px-2.5 py-1.5 flex items-center gap-2 text-xs">
          <CornerDownRight className="size-3 text-[var(--accent)] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[var(--accent)] font-medium text-[11px]">
              Replying to {replyTarget.authorLabel}
            </div>
            <div className="text-white/50 truncate">{replyTarget.preview}</div>
          </div>
          <button
            onClick={onClearReply}
            className="text-white/40 hover:text-white p-1 flex-shrink-0"
            aria-label="Cancel reply"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      <SlashCommandCard match={slashMatch} />
      <div className="card rounded-md px-2.5 py-1.5 flex items-end gap-2 focus-within:border-white/20 transition-colors">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={replyTarget ? "Reply…" : "Send encrypted message…"}
          disabled={disabled || sending}
          className={cn(
            "flex-1 resize-none bg-transparent text-[14px] text-white outline-none placeholder:text-white/30",
            "min-h-[22px] max-h-[120px] py-1",
          )}
          style={{
            height: Math.min(120, Math.max(22, text.split("\n").length * 20 + 2)),
          }}
        />
        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || disabled || sending}
          className={cn(
            "size-7 rounded-md flex items-center justify-center transition-colors",
            text.trim() && !disabled && !sending
              ? "bg-white text-black hover:bg-white/90"
              : "bg-white/[0.04] text-white/25 cursor-not-allowed",
          )}
          aria-label="Send"
        >
          <ArrowUp className="size-3.5" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
