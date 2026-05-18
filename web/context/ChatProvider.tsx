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
  type DecodedMessage,
  type Dm,
} from "@xmtp/browser-sdk";
import { buildXmtpSigner, ethIdentifier, XMTP_ENV } from "@/lib/xmtp";
import { getPeerAddressFromDm } from "@/lib/peer";
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

  // conversations
  conversations: Dm[];
  conversationsLoading: boolean;
  refreshConversations: () => Promise<void>;

  // active
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  activeConversation: Dm | null;

  // messages
  messagesByConvId: Map<string, DecodedMessage[]>;
  loadMessagesFor: (convId: string) => Promise<void>;

  // peers
  peerInfoByConvId: Map<string, PeerInfo>;

  // unread + typing
  unreadByConvId: Map<string, number>;
  expectingReplyByConvId: Map<string, boolean>;

  // actions
  openOrCreateDmWith: (address: string) => Promise<Dm | null>;
  sendMessage: (text: string) => Promise<void>;
};

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

  const [conversations, setConversations] = useState<Dm[]>([]);
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

  // ---------------- conversation list ----------------
  const refreshConversations = useCallback(async () => {
    if (!client) return;
    setConversationsLoading(true);
    try {
      await client.conversations.sync();
      const dms = await client.conversations.listDms();
      setConversations(dms);
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

  // ---------------- peer info resolution ----------------
  useEffect(() => {
    if (!client || conversations.length === 0) return;
    const ownId = client.inboxId;
    if (!ownId) return;
    let cancelled = false;
    (async () => {
      for (const dm of conversations) {
        if (cancelled) return;
        if (peerInfoByConvId.has(dm.id)) continue;
        const peerAddress = await getPeerAddressFromDm(dm, ownId);
        if (cancelled) return;
        setPeerInfoByConvId((prev) => {
          if (prev.has(dm.id)) return prev;
          const next = new Map(prev);
          next.set(dm.id, { address: peerAddress });
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

            // append to map
            setMessagesByConvId((prev) => {
              const next = new Map(prev);
              const existing = next.get(convId) ?? [];
              if (existing.some((m) => m.id === msg.id)) return prev;
              next.set(convId, [...existing, msg]);
              return next;
            });

            const isFromMe = msg.senderInboxId === client.inboxId;
            if (!isFromMe) {
              // mark typing-indicator off for this conv
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
                // browser notif + sound
                const peer = peerInfoByConvId.get(convId);
                const title = peer?.address ? `${peer.address.slice(0, 6)}…${peer.address.slice(-4)}` : "New message";
                const body =
                  typeof msg.content === "string"
                    ? msg.content.slice(0, 140)
                    : "New message";
                notify(title, body);
                ding();
              }

              // ensure new convo from peer shows up in sidebar
              setConversations((prev) => {
                if (prev.some((c) => c.id === convId)) return prev;
                return prev;
              });
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

  // ---------------- conversation stream (new DMs) ----------------
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let stopStream: (() => void) | null = null;
    (async () => {
      try {
        const stream = await client.conversations.streamDms({
          onValue: (conv) => {
            if (cancelled || !conv) return;
            setConversations((prev) => {
              if (prev.some((c) => c.id === conv.id)) return prev;
              return [conv as Dm, ...prev];
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
      const dm = conversations.find((c) => c.id === convId);
      if (!dm) return;
      try {
        await dm.sync();
        const msgs = await dm.messages();
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
        // load fresh messages for the active conv
        void loadMessagesFor(id);
      }
    },
    [loadMessagesFor],
  );

  // when tab regains focus while a conv is active, clear unread
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
        // ensure it shows in our list
        setConversations((prev) => {
          if (prev.some((c) => c.id === dm.id)) return prev;
          return [dm, ...prev];
        });
        // pre-cache peer info
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

  // ---------------- send message ----------------
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const id = activeConversationId;
      if (!id) return;
      const dm = conversations.find((c) => c.id === id);
      if (!dm) return;
      try {
        await dm.sendText(trimmed);
        // mark expecting reply
        setExpectingReplyByConvId((prev) => {
          const next = new Map(prev);
          next.set(id, true);
          return next;
        });
        // auto-clear after 60s
        setTimeout(() => {
          setExpectingReplyByConvId((prev) => {
            if (!prev.get(id)) return prev;
            const next = new Map(prev);
            next.set(id, false);
            return next;
          });
        }, 60_000);
        // refresh messages
        await loadMessagesFor(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Send failed", { description: msg });
      }
    },
    [activeConversationId, conversations, loadMessagesFor],
  );

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
    sendMessage,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
