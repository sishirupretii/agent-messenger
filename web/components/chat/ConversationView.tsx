"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Copy, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useChat } from "@/context/ChatProvider";
import { PeerAvatar } from "@/components/ui/Avatar";
import { PeerName } from "@/components/ui/PeerName";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { TypingDots } from "./TypingDots";
import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/format";

export function ConversationView({ onBack }: { onBack: () => void }) {
  const {
    activeConversationId,
    activeConversation,
    messagesByConvId,
    peerInfoByConvId,
    expectingReplyByConvId,
    sendMessage,
    client,
  } = useChat();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const messages = activeConversationId
    ? messagesByConvId.get(activeConversationId) ?? []
    : [];
  const peer = activeConversationId
    ? peerInfoByConvId.get(activeConversationId)
    : undefined;
  const peerAddress = peer?.address ?? null;
  const expecting =
    !!activeConversationId && !!expectingReplyByConvId.get(activeConversationId);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, expecting]);

  async function copyAddress() {
    if (!peerAddress) return;
    try {
      await navigator.clipboard.writeText(peerAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  if (!activeConversation) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <button
          onClick={onBack}
          className="lg:hidden text-white/60 hover:text-white p-1 -ml-1"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </button>
        <PeerAvatar address={peerAddress} size={36} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">
            {peerAddress ? (
              <PeerName address={peerAddress} />
            ) : (
              shortAddress(activeConversation.id, 4, 4)
            )}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-white/40 font-mono">
            <span className="truncate">{peerAddress ?? "unknown"}</span>
            {peerAddress && (
              <button
                onClick={copyAddress}
                className="hover:text-white/80 transition-colors p-0.5"
                aria-label="Copy address"
              >
                {copied ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2"
      >
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-white/30 text-sm py-12">
            No messages yet. Say hi.
          </div>
        )}
        {messages.map((m, i) => {
          const isMine = m.senderInboxId === client?.inboxId;
          const next = messages[i + 1];
          const nextIsMine = next ? next.senderInboxId === client?.inboxId : false;
          const isLastInRun = !next || nextIsMine !== isMine;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              isMine={isMine}
              showTime={isLastInRun}
            />
          );
        })}
        {expecting && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "self-start rounded-2xl px-3.5 py-2 bg-white/[0.06] border border-white/10 text-white/60 mt-1",
            )}
          >
            <TypingDots />
          </motion.div>
        )}
      </div>

      {/* Composer */}
      <div className="px-4 pb-4 pt-2">
        <MessageInput onSend={sendMessage} />
      </div>
    </div>
  );
}
