"use client";

import { useState, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/cn";

export function MessageInput({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (text: string) => Promise<void> | void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending || disabled) return;
    setSending(true);
    setText("");
    try {
      await onSend(trimmed);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="glass rounded-2xl px-3 py-2 flex items-end gap-2 focus-within:border-white/20 transition-colors">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder="Type a message…"
        disabled={disabled || sending}
        className={cn(
          "flex-1 resize-none bg-transparent text-sm text-white outline-none placeholder:text-white/30",
          "min-h-[24px] max-h-[120px] py-1.5",
        )}
        style={{
          height: Math.min(120, Math.max(24, text.split("\n").length * 20 + 4)),
        }}
      />
      <button
        type="button"
        onClick={send}
        disabled={!text.trim() || disabled || sending}
        className={cn(
          "size-8 rounded-full flex items-center justify-center transition-all",
          text.trim() && !disabled && !sending
            ? "brand-gradient text-white shadow-lg hover:scale-105 active:scale-95"
            : "bg-white/5 text-white/30 cursor-not-allowed",
        )}
        aria-label="Send"
      >
        <ArrowUp className="size-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}
