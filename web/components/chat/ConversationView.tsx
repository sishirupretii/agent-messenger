"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Copy, Check, Users } from "lucide-react";
import type { DecodedMessage } from "@xmtp/browser-sdk";
import { toast } from "sonner";
import { useChat } from "@/context/ChatProvider";
import { PeerAvatar } from "@/components/ui/Avatar";
import { PeerName } from "@/components/ui/PeerName";
import { MessageBubble } from "./MessageBubble";
import { MessageInput, type ReplyTarget } from "./MessageInput";
import { TypingDots } from "./TypingDots";
import { DateSeparator, sameDay } from "./DateSeparator";
import { Fragment } from "react";
import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/format";
import { isGroup, getGroupName } from "@/lib/conversation";
import { isKnownAgentAddress, getKnownAgent } from "@/lib/agents";
import { AgentBadge } from "@/components/ui/AgentBadge";
import { GroupInfoPanel } from "./GroupInfoPanel";

export function ConversationView({ onBack }: { onBack: () => void }) {
  const {
    activeConversationId,
    activeConversation,
    messagesByConvId,
    peerInfoByConvId,
    expectingReplyByConvId,
    sendMessage,
    client,
    ownInboxId,
  } = useChat();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);

  const messages = activeConversationId
    ? messagesByConvId.get(activeConversationId) ?? []
    : [];
  const peer = activeConversationId
    ? peerInfoByConvId.get(activeConversationId)
    : undefined;
  const peerAddress = peer?.address ?? null;
  const expecting =
    !!activeConversationId && !!expectingReplyByConvId.get(activeConversationId);

  const isGroupConv = activeConversation ? isGroup(activeConversation) : false;
  const groupName = activeConversation && isGroupConv
    ? getGroupName(activeConversation)
    : undefined;
  const isAgent = !isGroupConv && isKnownAgentAddress(peerAddress);
  const knownAgent = isAgent ? getKnownAgent(peerAddress) : null;

  // load group member count
  useEffect(() => {
    if (!activeConversation || !isGroupConv) {
      setMemberCount(null);
      return;
    }
    let cancelled = false;
    activeConversation
      .members()
      .then((m) => {
        if (!cancelled) setMemberCount(m.length);
      })
      .catch(() => {
        if (!cancelled) setMemberCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeConversation, isGroupConv]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, expecting]);

  // clear reply target when switching conversations
  useEffect(() => {
    setReplyTarget(null);
  }, [activeConversationId]);

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

  function startReply(msg: DecodedMessage) {
    const preview = typeof msg.content === "string" ? msg.content : "message";
    const isMine = msg.senderInboxId === client?.inboxId;
    setReplyTarget({
      id: msg.id,
      preview: preview.slice(0, 80),
      authorLabel: isMine ? "yourself" : "them",
    });
  }

  if (!activeConversation) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <button
          onClick={onBack}
          className="lg:hidden text-white/60 hover:text-white p-1 -ml-1"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </button>
        {isGroupConv ? (
          <button
            onClick={() => setGroupInfoOpen(true)}
            className="size-9 rounded-full brand-gradient flex items-center justify-center flex-shrink-0 hover:scale-105 transition-transform"
            aria-label="Group info"
          >
            <Users className="size-4 text-white" />
          </button>
        ) : (
          <PeerAvatar address={peerAddress} size={36} />
        )}
        <div
          className={cn(
            "flex-1 min-w-0",
            isGroupConv && "cursor-pointer",
          )}
          onClick={isGroupConv ? () => setGroupInfoOpen(true) : undefined}
        >
          <div className="text-sm font-medium text-white truncate flex items-center gap-1.5">
            <span className="truncate">
              {isGroupConv ? (
                groupName ?? "Untitled group"
              ) : knownAgent ? (
                knownAgent.name
              ) : peerAddress ? (
                <PeerName address={peerAddress} />
              ) : (
                shortAddress(activeConversation.id, 4, 4)
              )}
            </span>
            {isAgent && <AgentBadge size="sm" />}
          </div>
          {isGroupConv ? (
            <div className="text-[11px] text-white/40 hover:text-white/60 transition-colors">
              {memberCount != null
                ? `${memberCount} ${memberCount === 1 ? "member" : "members"} · tap for info`
                : "loading members…"}
            </div>
          ) : (
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
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2 pr-14"
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

          // Date separator before the first message of a new day
          const myNs = (m as unknown as { sentAtNs?: bigint }).sentAtNs;
          const myDate = myNs ? new Date(Number(myNs / 1_000_000n)) : null;
          const prev = i > 0 ? messages[i - 1] : null;
          const prevNs = prev
            ? (prev as unknown as { sentAtNs?: bigint }).sentAtNs
            : null;
          const prevDate = prevNs ? new Date(Number(prevNs / 1_000_000n)) : null;
          const showSeparator =
            myDate && (!prevDate || !sameDay(prevDate, myDate));

          return (
            <Fragment key={m.id}>
              {showSeparator && myDate && <DateSeparator date={myDate} />}
              <MessageBubble
                message={m}
                isMine={isMine}
                showTime={isLastInRun}
                onReply={startReply}
              />
            </Fragment>
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

      <div className="px-4 pb-4 pt-2">
        <MessageInput
          onSend={sendMessage}
          replyTarget={replyTarget}
          onClearReply={() => setReplyTarget(null)}
        />
      </div>

      {isGroupConv && (
        <GroupInfoPanel
          open={groupInfoOpen}
          onClose={() => setGroupInfoOpen(false)}
          group={activeConversation}
          ownInboxId={ownInboxId}
        />
      )}
    </div>
  );
}
