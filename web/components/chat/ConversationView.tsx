"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Copy, Check, Users, ArrowDown, Zap } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { PaymentModal } from "./PaymentModal";
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
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInitial, setPaymentInitial] = useState<string | undefined>();
  const [atBottom, setAtBottom] = useState(true);
  const [memberAddresses, setMemberAddresses] = useState<Map<string, string>>(
    new Map(),
  );

  function scrollToBottom(smooth = true) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  // Track whether user is scrolled to the bottom (within 80px tolerance)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      setAtBottom(dist < 80);
    }
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeConversationId]);

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

  // load group member count + inbox→address map
  useEffect(() => {
    if (!activeConversation || !isGroupConv) {
      setMemberCount(null);
      setMemberAddresses(new Map());
      return;
    }
    let cancelled = false;
    activeConversation
      .members()
      .then((members) => {
        if (cancelled) return;
        setMemberCount(members.length);
        const map = new Map<string, string>();
        for (const m of members) {
          const identifiers = (
            m as unknown as {
              accountIdentifiers?: Array<{ identifier: string }>;
            }
          ).accountIdentifiers;
          const addr = identifiers?.[0]?.identifier;
          if (addr) map.set(m.inboxId, addr.toLowerCase());
        }
        setMemberAddresses(map);
      })
      .catch(() => {
        if (!cancelled) setMemberCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeConversation, isGroupConv]);

  // Auto-scroll on new messages only if user is already at the bottom
  // (so reading older messages isn't disrupted)
  useEffect(() => {
    if (atBottom) scrollToBottom(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, expecting]);

  // Always snap to bottom when switching conversations
  useEffect(() => {
    scrollToBottom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

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
      <header className="flex items-center gap-2.5 px-4 h-[57px] border-b border-white/[0.06] flex-shrink-0">
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
            className="size-8 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0 hover:bg-white/[0.08] transition-colors"
            aria-label="Group info"
          >
            <Users className="size-3.5 text-white/65" />
          </button>
        ) : (
          <PeerAvatar address={peerAddress} size={32} />
        )}
        <div
          className={cn(
            "flex-1 min-w-0",
            isGroupConv && "cursor-pointer",
          )}
          onClick={isGroupConv ? () => setGroupInfoOpen(true) : undefined}
        >
          <div className="text-[13px] font-medium text-white truncate flex items-center gap-1.5">
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
            {isAgent && <AgentBadge size="xs" />}
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
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-12 gap-3">
            {isGroupConv ? (
              <div className="size-12 rounded-2xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
                <Users className="size-5 text-white/70" />
              </div>
            ) : (
              <PeerAvatar address={peerAddress} size={48} />
            )}
            <div className="space-y-1">
              <div className="text-white font-medium text-sm">
                {isGroupConv
                  ? `This is the start of ${groupName ?? "your group"}`
                  : knownAgent
                    ? `Say hi to ${knownAgent.name}`
                    : "Start the conversation"}
              </div>
              <div className="text-white/40 text-xs max-w-xs">
                {isAgent
                  ? `Try asking: "what's my balance?" or "what's the gas price?"`
                  : "Messages are end-to-end encrypted via XMTP."}
              </div>
            </div>
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

          // In groups, show sender label above the first message of a run
          // from a non-self sender so you know who said what.
          const isFirstInRun =
            !prev ||
            prev.senderInboxId !== m.senderInboxId ||
            (prevDate && myDate && !sameDay(prevDate, myDate));
          let senderLabel: string | undefined;
          let senderAddress: string | undefined;
          if (isGroupConv && !isMine && isFirstInRun) {
            senderAddress = memberAddresses.get(m.senderInboxId);
            senderLabel = senderAddress
              ? `${senderAddress.slice(0, 6)}…${senderAddress.slice(-4)}`
              : `${m.senderInboxId.slice(0, 6)}…${m.senderInboxId.slice(-4)}`;
          }

          return (
            <Fragment key={m.id}>
              {showSeparator && myDate && <DateSeparator date={myDate} />}
              <MessageBubble
                message={m}
                isMine={isMine}
                showTime={isLastInRun}
                senderLabel={senderLabel}
                senderAddress={senderAddress}
                onReply={startReply}
                onTip={
                  !isGroupConv && peerAddress
                    ? (amount) => {
                        setPaymentInitial(amount);
                        setPaymentOpen(true);
                      }
                    : undefined
                }
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

      <div className="relative px-4 pb-4 pt-2">
        <AnimatePresence>
          {!atBottom && messages.length > 0 && (
            <motion.button
              type="button"
              onClick={() => scrollToBottom(true)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className="absolute -top-12 right-4 size-9 rounded-full card-raised flex items-center justify-center text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors z-10"
              aria-label="Scroll to bottom"
              title="Scroll to bottom"
            >
              <ArrowDown className="size-4" />
            </motion.button>
          )}
        </AnimatePresence>
        <div className="flex items-end gap-2">
          {!isGroupConv && peerAddress && (
            <button
              onClick={() => setPaymentOpen(true)}
              className="size-9 flex-shrink-0 rounded-md border border-white/[0.1] bg-white/[0.02] hover:bg-white/[0.06] text-white/60 hover:text-[var(--accent)] transition-colors flex items-center justify-center"
              aria-label="Send ETH"
              title="Send ETH on Base Sepolia"
            >
              <Zap className="size-4" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <MessageInput
              onSend={sendMessage}
              replyTarget={replyTarget}
              onClearReply={() => setReplyTarget(null)}
            />
          </div>
        </div>
      </div>

      {isGroupConv && (
        <GroupInfoPanel
          open={groupInfoOpen}
          onClose={() => setGroupInfoOpen(false)}
          group={activeConversation}
          ownInboxId={ownInboxId}
        />
      )}
      {!isGroupConv && peerAddress && (
        <PaymentModal
          open={paymentOpen}
          onClose={() => {
            setPaymentOpen(false);
            setPaymentInitial(undefined);
          }}
          toAddress={peerAddress}
          peerLabel={knownAgent ? knownAgent.name : undefined}
          initialAmount={paymentInitial}
        />
      )}
    </div>
  );
}
