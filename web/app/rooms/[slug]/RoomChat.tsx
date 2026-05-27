"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

interface RoomMessage {
  id: string;
  from_address: string;
  body: string;
  body_type: string;
  ts: number;
  signature?: string;
  signed_message?: string;
  in_reply_to: string | null;
  created_at: string;
}

const POLL_MS = 4_000;
const PROD_BASE = ""; // same origin; client fetches relative URLs

function buildRoomMessagePreimage(args: {
  ts: number;
  address: string;
  room_slug: string;
  body: string;
}) {
  return [
    "SIGNA room message v1",
    `ts:${args.ts}`,
    `from:${args.address.toLowerCase()}`,
    `room:${args.room_slug.toLowerCase()}`,
    `body:${args.body}`,
  ].join("\n");
}

function fmtAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr ?? "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtTime(ms: number): string {
  try {
    const d = new Date(ms);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export function RoomChat({ slug }: { slug: string }) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTsRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Initial load + poll
  useEffect(() => {
    let cancelled = false;

    async function load(initial = false) {
      try {
        const since = lastTsRef.current > 0 && !initial ? lastTsRef.current : "";
        const url = `${PROD_BASE}/api/rooms/${slug}/messages?limit=100${since ? `&since=${since}` : ""}`;
        const r = await fetch(url, { cache: "no-store" });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok || !data?.ok) {
          if (initial) setError(data?.error ?? `HTTP ${r.status}`);
          return;
        }
        const incoming = (data.messages ?? []) as RoomMessage[];
        if (incoming.length === 0) return;
        setMessages((prev) => {
          if (initial) {
            lastTsRef.current = incoming[incoming.length - 1]?.ts ?? 0;
            return incoming;
          }
          const seen = new Set(prev.map((m) => m.id));
          const fresh = incoming.filter((m) => !seen.has(m.id));
          if (fresh.length === 0) return prev;
          const next = [...prev, ...fresh];
          lastTsRef.current = next[next.length - 1]?.ts ?? lastTsRef.current;
          return next;
        });
      } catch (e) {
        if (initial) setError(e instanceof Error ? e.message : String(e));
      }
    }

    load(true);
    const id = setInterval(() => load(false), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function sendMessage() {
    setError(null);
    const trimmed = body.trim();
    if (!trimmed) return;
    if (trimmed.length > 8000) {
      setError("Message too long. Max 8000 chars.");
      return;
    }
    if (!address || !walletClient) {
      setError("Connect your wallet to post.");
      return;
    }
    setSending(true);
    try {
      const ts = Date.now();
      const message = buildRoomMessagePreimage({
        ts,
        address,
        room_slug: slug,
        body: trimmed,
      });
      const signature = await walletClient.signMessage({ message });
      const r = await fetch(`/api/rooms/${slug}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: address.toLowerCase(),
          body: trimmed,
          ts,
          signature,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error ?? `HTTP ${r.status}`);
      }
      setBody("");
      // Optimistically append; the poll will dedupe by id
      setMessages((prev) => [...prev, { ...data.message }]);
      lastTsRef.current = data.message.ts;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border border-white/10 rounded-sm bg-white/[0.02] overflow-hidden flex flex-col h-[600px]">
      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !error && (
          <div className="text-center text-white/40 text-[13.5px] mt-12">
            No messages yet. Be the first.
          </div>
        )}
        {error && (
          <div className="text-[12.5px] text-red-400 bg-red-500/[0.08] border border-red-500/30 rounded-sm px-3 py-2">
            {error}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="group">
            <div className="flex items-baseline gap-3 mb-0.5">
              <span className="font-mono text-[12px] text-cyan-300/85">
                {fmtAddress(m.from_address)}
              </span>
              <span className="text-[10.5px] text-white/35 font-mono">
                {fmtTime(m.ts)}
              </span>
              {m.signature && (
                <a
                  href={`/api/dm/${m.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10.5px] text-white/30 hover:text-white/55 opacity-0 group-hover:opacity-100 transition"
                  title="re-verify on prod"
                >
                  verify ↗
                </a>
              )}
            </div>
            <div className="text-[14px] text-white/90 leading-relaxed whitespace-pre-wrap break-words pl-0">
              {m.body}
            </div>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="border-t border-white/[0.06] p-3 bg-black/30">
        {!address ? (
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12.5px] text-white/60">
              Connect a wallet to post wallet-signed messages.
            </div>
            <ConnectButton showBalance={false} chainStatus="none" />
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !sending) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={`Post as ${fmtAddress(address)} ...`}
              className="flex-1 text-[14px] bg-black/40 border border-white/10 rounded-sm px-3 py-2 text-white focus:outline-none focus:border-white/30"
              disabled={sending}
            />
            <button
              onClick={sendMessage}
              disabled={sending || !body.trim()}
              className="bg-[var(--accent)] text-black font-semibold rounded-sm px-4 py-2 text-[13px] hover:brightness-110 transition disabled:opacity-50 uppercase tracking-wide"
            >
              {sending ? "signing..." : "send"}
            </button>
          </div>
        )}
        <div className="mt-2 text-[10.5px] text-white/30">
          your wallet EIP-191 signs the canonical preimage locally · receiving node re-verifies · message persists wallet-signed
        </div>
      </div>
    </div>
  );
}
