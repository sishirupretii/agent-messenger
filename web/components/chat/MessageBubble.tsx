"use client";

import { useState } from "react";
import { SmilePlus, Reply, CornerUpLeft, Copy, Zap } from "lucide-react";
import { toast } from "sonner";
import type { DecodedMessage } from "@xmtp/browser-sdk";
import { cn } from "@/lib/cn";
import { formatTime, nsToDate } from "@/lib/format";
import { renderTextWithLinks } from "@/lib/text";
import { normalizeMessageContent } from "@/lib/message";
import { ReactionPicker } from "./ReactionPicker";
import { ReactionRow } from "./ReactionRow";
import { PaymentCard } from "./PaymentCard";
import { TipMenu } from "./TipMenu";
import { PeerName } from "@/components/ui/PeerName";
import { useChat } from "@/context/ChatProvider";

export function MessageBubble({
  message,
  isMine,
  showTime,
  senderLabel,
  senderAddress,
  onReply,
  onTip,
}: {
  message: DecodedMessage;
  isMine: boolean;
  showTime: boolean;
  senderLabel?: string;
  senderAddress?: string;
  onReply: (msg: DecodedMessage) => void;
  /** Called with an ETH amount string (e.g. "0.001") when the user picks a tip. */
  onTip?: (amount: string) => void;
}) {
  const { sendReaction, ownInboxId } = useChat();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);

  const { text, replyTo, isReply, isTransactionRef, transactionRef } =
    normalizeMessageContent(message);
  if (!text && !isTransactionRef) return null;

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
      const toCopy = isTransactionRef
        ? transactionRef?.reference ?? ""
        : text;
      if (!toCopy) return;
      await navigator.clipboard.writeText(toCopy);
      toast.success(isTransactionRef ? "Tx hash copied" : "Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <div
      className={cn("group flex w-full", isMine ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "flex max-w-[78%] flex-col gap-0.5 relative",
          isMine && "items-end",
        )}
      >
        {senderLabel && !isMine && (
          <span className="text-[10px] text-white/45 pl-2.5 font-medium mb-0.5">
            {senderAddress ? (
              <PeerName address={senderAddress} fallback={senderLabel} />
            ) : (
              <span className="font-mono">{senderLabel}</span>
            )}
          </span>
        )}
        <div className="relative">
          {isTransactionRef && transactionRef ? (
            <PaymentCard
              content={transactionRef}
              isMine={isMine}
              onChain
            />
          ) : (
            <div
              className={cn(
                "rounded-lg px-3 py-1.5 text-[14px] leading-[1.45] break-words",
                isMine
                  ? "bg-white text-black"
                  : "bg-white/[0.04] text-white border border-white/[0.07]",
              )}
            >
              {replyPreview && (
                <div
                  className={cn(
                    "rounded-md px-2 py-1 mb-1 flex items-start gap-1.5 text-[11.5px] leading-snug border-l-2",
                    isMine
                      ? "bg-black/5 border-black/30 text-black/60"
                      : "bg-white/[0.03] border-[var(--accent)]/40 text-white/55",
                  )}
                >
                  <CornerUpLeft className="size-3 mt-0.5 flex-shrink-0 opacity-60" />
                  <span className="truncate">{replyPreview}</span>
                </div>
              )}
              <div>{renderTextWithLinks(text, isMine)}</div>
            </div>
          )}

          <div
            className={cn(
              "absolute top-0 hidden group-hover:flex items-center gap-0.5 -translate-y-1/2 z-10",
              isMine ? "-left-[68px]" : "-right-[68px]",
            )}
          >
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className="size-6 rounded-md bg-[#16161a] border border-white/10 flex items-center justify-center text-white/65 hover:text-white hover:bg-[#1c1c20] transition-colors"
              aria-label="React"
            >
              <SmilePlus className="size-3" />
            </button>
            <button
              onClick={() => onReply(message)}
              className="size-6 rounded-md bg-[#16161a] border border-white/10 flex items-center justify-center text-white/65 hover:text-white hover:bg-[#1c1c20] transition-colors"
              aria-label="Reply"
            >
              <Reply className="size-3" />
            </button>
            <button
              onClick={copyText}
              className="size-6 rounded-md bg-[#16161a] border border-white/10 flex items-center justify-center text-white/65 hover:text-white hover:bg-[#1c1c20] transition-colors"
              aria-label="Copy"
            >
              <Copy className="size-3" />
            </button>
            {!isMine && onTip && (
              <button
                onClick={() => {
                  setTipOpen((v) => !v);
                  setPickerOpen(false);
                }}
                className="size-6 rounded-md bg-[#16161a] border border-white/10 flex items-center justify-center text-white/65 hover:text-[var(--accent)] hover:bg-[#1c1c20] transition-colors"
                aria-label="Tip"
                title="Send a tip"
              >
                <Zap className="size-3" />
              </button>
            )}
          </div>

          <ReactionPicker
            open={pickerOpen}
            onPick={handlePick}
            align={isMine ? "right" : "left"}
          />
          <TipMenu
            open={tipOpen}
            align={isMine ? "right" : "left"}
            onPick={(amount) => {
              setTipOpen(false);
              onTip?.(amount);
            }}
          />
        </div>

        <ReactionRow
          message={message}
          ownInboxId={ownInboxId}
          align={isMine ? "right" : "left"}
          onToggle={(emoji, action) => sendReaction(message.id, emoji, action)}
        />

        {showTime && sentAt && (
          <span className="text-[10px] text-white/30 px-1 mt-0.5">
            {formatTime(sentAt)}
          </span>
        )}
      </div>
    </div>
  );
}
