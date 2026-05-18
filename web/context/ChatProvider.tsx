"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAccount, useWalletClient } from "wagmi";
import { toast } from "sonner";
import {
  Client,
  ReactionAction,
  ReactionSchema,
  encodeText,
  type Conversation,
  type DecodedMessage,
  type Dm,
  type Group,
} from "@xmtp/browser-sdk";
import { buildXmtpSigner, ethIdentifier, XMTP_ENV } from "@/lib/xmtp";
import { getPeerAddressFromDm } from "@/lib/peer";
import { isDm } from "@/lib/conversation";
import { ding, notify, requestNotificationPermission } from "@/lib/notifications";

type XmtpClient = Awaited<ReturnType<typeof Client.create>>;
export type InitStatus = "idle" | "loading" | "ready" | "error";

export type PeerInfo = {
  address: string | null;
};

type ChatContextValue = {
  // identity
  ownAddress: `0x${string}` | undefined;
  ownInboxId: string | null;

  // XMTP client lifecycle
  client: XmtpClient | null;
  initStatus: InitStatus;
  initError: string | null;
  initXmtp: () => Promise<void>;

  // conversations (DMs + groups)
  conversations: Conversation[];
  conversationsLoading: boolean;
  refreshConversations: () => Promise<void>;

  // active
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  activeConversation: Conversation | null;

  // messages
  messagesByConvId: Map<string, DecodedMessage[]>;
  loadMessagesFor: (convId: string) => Promise<void>;

  // peers (per DM)
  peerInfoByConvId: Map<string, PeerInfo>;

  // unread + typing
  unreadByConvId: Map<string, number>;
  expectingReplyByConvId: Map<string, boolean>;

  // pins
  pinnedIds: Set<string>;
  togglePin: (convId: string) => void;

  // actions
  openOrCreateDmWith: (address: string) => Promise<Dm | null>;
  createGroupWith: (
    addresses: string[],
    options?: { name?: string; description?: string },
  ) => Promise<Group | null>;
  sendMessage: (text: string, replyToId?: string) => Promise<void>;
  sendReaction: (messageId: string, emoji: string, action?: "add" | "remove") => Promise<void>;
  leaveGroup: (convId: string) => Promise<boolean>;
  markRead: () => Promise<void>;

  // search
  searchQuery: string;
  setSearchQuery: (q: string) => void;
};

const PINS_KEY = "agent-messenger:pinned";

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [client, setClient] = useState<XmtpClient | null>(null);
  const [initStatus, setInitStatus] = useState<InitStatus>("idle");
  const [initError, setInitError] = useState<string | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  const [activeConversationId, _setActiveConversationId] = useState<string | null>(null);
  const [messagesByConvId, setMessagesByConvId] = useState<Map<string, DecodedMessage[]>>(
    new Map(),
  );
  const [peerInfoByConvId, setPeerInfoByConvId] = useState<Map<string, PeerInfo>>(new Map());
  const [unreadByConvId, setUnreadByConvId] = useState<Map<string, number>>(new Map());
  const [expectingReplyByConvId, setExpectingReplyByConvId] = useState<Map<string, boolean>>(
    new Map(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem(PINS_KEY);
      if (!raw) return new Set();
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === "string"));
      return new Set();
    } catch {
      return new Set();
    }
  });

  const togglePin = useCallback((convId: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(convId)) next.delete(convId);
      else next.add(convId);
      try {
        localStorage.setItem(PINS_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const ownInboxId = client?.inboxId ?? null;

  // ---------------- init ----------------
  const initXmtp = useCallback(async () => {
    if (!address || !walletClient) return;
    setInitStatus("loading");
    setInitError(null);
    try {
      const signer = buildXmtpSigner(walletClient, address);
      const opts = { env: XMTP_ENV } as Parameters<typeof Client.create>[1];
      const xmtp = await Client.create(signer, opts);
      await xmtp.conversations.sync();
      setClient(xmtp);
      setInitStatus("ready");
      void requestNotificationPermission();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInitStatus("error");
      setInitError(msg);
      toast.error("XMTP setup failed", { description: msg });
    }
  }, [address, walletClient]);

  // ---------------- conversation list (DMs + groups) ----------------
  const refreshConversations = useCallback(async () => {
    if (!client) return;
    setConversationsLoading(true);
    try {
      await client.conversations.sync();
      const all = await client.conversations.list();
      setConversations(all);
    } catch (e) {
      console.error("Failed to load conversations", e);
    } finally {
      setConversationsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    void refreshConversations();
  }, [client, refreshConversations]);

  // ---------------- peer info resolution (DMs only) ----------------
  useEffect(() => {
    if (!client || conversations.length === 0) return;
    const ownId = client.inboxId;
    if (!ownId) return;
    let cancelled = false;
    (async () => {
      for (const conv of conversations) {
        if (cancelled) return;
        if (peerInfoByConvId.has(conv.id)) continue;
        if (!isDm(conv)) continue;
        const peerAddress = await getPeerAddressFromDm(conv, ownId);
        if (cancelled) return;
        setPeerInfoByConvId((prev) => {
          if (prev.has(conv.id)) return prev;
          const next = new Map(prev);
          next.set(conv.id, { address: peerAddress });
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, conversations, peerInfoByConvId]);

  // ---------------- message stream ----------------
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let stopStream: (() => void) | null = null;

    (async () => {
      try {
        const stream = await client.conversations.streamAllMessages({
          onValue: async (msg) => {
            if (cancelled || !msg) return;
            const convId = msg.conversationId;

            setMessagesByConvId((prev) => {
              const next = new Map(prev);
              const existing = next.get(convId) ?? [];
              if (existing.some((m) => m.id === msg.id)) return prev;
              next.set(convId, [...existing, msg]);
              return next;
            });

            const isFromMe = msg.senderInboxId === client.inboxId;
            if (!isFromMe) {
              setExpectingReplyByConvId((prev) => {
                if (!prev.get(convId)) return prev;
                const next = new Map(prev);
                next.set(convId, false);
                return next;
              });

              const isActiveAndFocused =
                activeIdRef.current === convId &&
                typeof document !== "undefined" &&
                !document.hidden;

              if (!isActiveAndFocused) {
                setUnreadByConvId((prev) => {
                  const next = new Map(prev);
                  next.set(convId, (prev.get(convId) ?? 0) + 1);
                  return next;
                });
                const peer = peerInfoByConvId.get(convId);
                const title = peer?.address
                  ? `${peer.address.slice(0, 6)}…${peer.address.slice(-4)}`
                  : "New message";
                const body =
                  typeof msg.content === "string"
                    ? msg.content.slice(0, 140)
                    : "New message";
                notify(title, body);
                ding();
              }
              void refreshConversations();
            }
          },
          onError: (err) => {
            console.error("XMTP stream error", err);
          },
        });
        stopStream = () => {
          stream.end().catch(() => {});
        };
      } catch (e) {
        console.error("Failed to start XMTP stream", e);
      }
    })();

    return () => {
      cancelled = true;
      stopStream?.();
    };
  }, [client, peerInfoByConvId, refreshConversations]);

  // ---------------- conversation stream (new DMs + groups) ----------------
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let stopStream: (() => void) | null = null;
    (async () => {
      try {
        const stream = await client.conversations.stream({
          onValue: (conv) => {
            if (cancelled || !conv) return;
            setConversations((prev) => {
              if (prev.some((c) => c.id === conv.id)) return prev;
              return [conv, ...prev];
            });
          },
          onError: (err) => {
            console.error("XMTP conv stream error", err);
          },
        });
        stopStream = () => {
          stream.end().catch(() => {});
        };
      } catch (e) {
        console.error("Failed to start conversation stream", e);
      }
    })();
    return () => {
      cancelled = true;
      stopStream?.();
    };
  }, [client]);

  // ---------------- load messages for a conv ----------------
  const loadMessagesFor = useCallback(
    async (convId: string) => {
      const conv = conversations.find((c) => c.id === convId);
      if (!conv) return;
      try {
        await conv.sync();
        const msgs = await conv.messages();
        setMessagesByConvId((prev) => {
          const next = new Map(prev);
          next.set(convId, msgs);
          return next;
        });
      } catch (e) {
        console.error("Failed to load messages", e);
      }
    },
    [conversations],
  );

  // ---------------- set active + clear unread ----------------
  const setActiveConversationId = useCallback(
    (id: string | null) => {
      _setActiveConversationId(id);
      if (id) {
        setUnreadByConvId((prev) => {
          if (!prev.get(id)) return prev;
          const next = new Map(prev);
          next.set(id, 0);
          return next;
        });
        void loadMessagesFor(id);
        // fire read receipt (best-effort)
        const conv = conversations.find((c) => c.id === id);
        if (conv) {
          conv.sendReadReceipt().catch(() => {});
        }
      }
    },
    [loadMessagesFor, conversations],
  );

  useEffect(() => {
    function onFocus() {
      const id = activeIdRef.current;
      if (id) {
        setUnreadByConvId((prev) => {
          if (!prev.get(id)) return prev;
          const next = new Map(prev);
          next.set(id, 0);
          return next;
        });
      }
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // ---------------- open or create DM ----------------
  const openOrCreateDmWith = useCallback(
    async (rawAddress: string): Promise<Dm | null> => {
      if (!client) return null;
      const trimmed = rawAddress.trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
        toast.error("Invalid address", {
          description: "Enter a valid 0x… 40-hex address.",
        });
        return null;
      }
      if (trimmed.toLowerCase() === address?.toLowerCase()) {
        toast.error("That's you", {
          description: "Can't message yourself from the same wallet.",
        });
        return null;
      }
      try {
        const peerId = ethIdentifier(trimmed);
        const reach = await Client.canMessage([peerId], XMTP_ENV);
        const ok = reach.get(trimmed.toLowerCase()) ?? false;
        if (!ok) {
          toast.error("Peer hasn't enabled XMTP", {
            description:
              "Ask them to open this app and click \"Enable XMTP messaging\" first.",
          });
          return null;
        }
        const dm = await client.conversations.createDmWithIdentifier(peerId);
        await dm.sync();
        setConversations((prev) => {
          if (prev.some((c) => c.id === dm.id)) return prev;
          return [dm, ...prev];
        });
        setPeerInfoByConvId((prev) => {
          if (prev.has(dm.id)) return prev;
          const next = new Map(prev);
          next.set(dm.id, { address: trimmed.toLowerCase() });
          return next;
        });
        return dm;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Couldn't open chat", { description: msg });
        return null;
      }
    },
    [client, address],
  );

  // ---------------- create group ----------------
  const createGroupWith = useCallback(
    async (
      addresses: string[],
      options?: { name?: string; description?: string },
    ): Promise<Group | null> => {
      if (!client) return null;
      const cleaned: string[] = [];
      for (const raw of addresses) {
        const t = raw.trim();
        if (!t) continue;
        if (!/^0x[a-fA-F0-9]{40}$/.test(t)) {
          toast.error("Invalid address", { description: t });
          return null;
        }
        if (t.toLowerCase() === address?.toLowerCase()) continue;
        cleaned.push(t.toLowerCase());
      }
      if (cleaned.length === 0) {
        toast.error("Need at least one other member");
        return null;
      }
      try {
        const ids = cleaned.map(ethIdentifier);
        const reach = await Client.canMessage(ids, XMTP_ENV);
        const unreachable = cleaned.filter((a) => !reach.get(a));
        if (unreachable.length > 0) {
          toast.error("Some addresses haven't enabled XMTP", {
            description: unreachable.join(", "),
          });
          return null;
        }
        const group = await client.conversations.createGroupWithIdentifiers(ids, {
          groupName: options?.name,
          groupDescription: options?.description,
        });
        await group.sync();
        setConversations((prev) => {
          if (prev.some((c) => c.id === group.id)) return prev;
          return [group, ...prev];
        });
        toast.success("Group created");
        return group;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Couldn't create group", { description: msg });
        return null;
      }
    },
    [client, address],
  );

  // ---------------- send message (with optional reply ref) ----------------
  const sendMessage = useCallback(
    async (text: string, replyToId?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const id = activeConversationId;
      if (!id) return;
      const conv = conversations.find((c) => c.id === id);
      if (!conv) return;
      try {
        if (replyToId) {
          const encoded = await encodeText(trimmed);
          await conv.sendReply({
            reference: replyToId,
            content: encoded,
          });
        } else {
          await conv.sendText(trimmed);
        }
        setExpectingReplyByConvId((prev) => {
          const next = new Map(prev);
          next.set(id, true);
          return next;
        });
        setTimeout(() => {
          setExpectingReplyByConvId((prev) => {
            if (!prev.get(id)) return prev;
            const next = new Map(prev);
            next.set(id, false);
            return next;
          });
        }, 60_000);
        await loadMessagesFor(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Send failed", { description: msg });
      }
    },
    [activeConversationId, conversations, loadMessagesFor],
  );

  // ---------------- reactions ----------------
  const sendReaction = useCallback(
    async (messageId: string, emoji: string, action: "add" | "remove" = "add") => {
      const id = activeConversationId;
      if (!id) return;
      const conv = conversations.find((c) => c.id === id);
      if (!conv) return;
      const msgs = messagesByConvId.get(id) ?? [];
      const target = msgs.find((m) => m.id === messageId);
      if (!target) return;
      try {
        await conv.sendReaction({
          reference: messageId,
          referenceInboxId: target.senderInboxId,
          action: action === "add" ? ReactionAction.Added : ReactionAction.Removed,
          content: emoji,
          schema: ReactionSchema.Unicode,
        });
        await loadMessagesFor(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Couldn't react", { description: msg });
      }
    },
    [activeConversationId, conversations, messagesByConvId, loadMessagesFor],
  );

  // ---------------- leave group ----------------
  const leaveGroup = useCallback(
    async (convId: string): Promise<boolean> => {
      const conv = conversations.find((c) => c.id === convId);
      if (!conv) return false;
      try {
        const reqRemoval = (conv as unknown as { requestRemoval?: () => Promise<void> })
          .requestRemoval;
        if (typeof reqRemoval !== "function") {
          toast.error("This conversation can't be left");
          return false;
        }
        await reqRemoval.call(conv);
        setConversations((prev) => prev.filter((c) => c.id !== convId));
        if (activeIdRef.current === convId) {
          _setActiveConversationId(null);
        }
        toast.success("Left group");
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Couldn't leave group", { description: msg });
        return false;
      }
    },
    [conversations],
  );

  // ---------------- explicit mark-read (used by ConversationView) ----------------
  const markRead = useCallback(async () => {
    const id = activeConversationId;
    if (!id) return;
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    try {
      await conv.sendReadReceipt();
    } catch {
      // ignore
    }
  }, [activeConversationId, conversations]);

  const activeConversation = useMemo(
    () =>
      activeConversationId
        ? conversations.find((c) => c.id === activeConversationId) ?? null
        : null,
    [activeConversationId, conversations],
  );

  const value: ChatContextValue = {
    ownAddress: address,
    ownInboxId,
    client,
    initStatus,
    initError,
    initXmtp,
    conversations,
    conversationsLoading,
    refreshConversations,
    activeConversationId,
    setActiveConversationId,
    activeConversation,
    messagesByConvId,
    loadMessagesFor,
    peerInfoByConvId,
    unreadByConvId,
    expectingReplyByConvId,
    openOrCreateDmWith,
    createGroupWith,
    sendMessage,
    sendReaction,
    leaveGroup,
    markRead,
    pinnedIds,
    togglePin,
    searchQuery,
    setSearchQuery,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
