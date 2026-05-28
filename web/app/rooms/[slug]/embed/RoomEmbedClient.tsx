"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

/**
 * Embed-mode chat — same API surface as RoomChat but trimmed:
 *   - no left sidebar (rooms list)
 *   - no right sidebar (members + slash commands)
 *   - condensed header
 *   - condensed footer with "open full chat" deep link
 *
 * Behaviour: messages poll every 4s, gate preflight every 30s.
 */
interface RoomMessage {
  id: string;
  from_address: string;
  body: string;
  body_type: string;
  ts: number;
  in_reply_to: string | null;
}

interface RoomGate {
  tokenAddress: string;
  chain: string;
  symbol: string;
  decimals: number;
  minBalanceRaw: string;
}

interface Props {
  slug: string;
  roomName: string;
  roomDescription: string | null;
  roomCreator: string;
  gate: RoomGate | null;
}

const POLL_MS = 4_000;
const GATE_RECHECK_MS = 30_000;

function fmtAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr ?? "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function avatarGradient(addr: string): { from: string; to: string } {
  const a = addr.toLowerCase().replace(/^0x/, "");
  const h1 = parseInt(a.slice(0, 4), 16) % 360;
  const h2 = parseInt(a.slice(4, 8), 16) % 360;
  return {
    from: `hsl(${h1} 70% 55%)`,
    to: `hsl(${h2} 65% 45%)`,
  };
}

function fmtMin(raw: string, decimals: number): string {
  try {
    const r = BigInt(raw);
    const base = 10n ** BigInt(decimals);
    const whole = r / base;
    const frac = r % base;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole}.${fracStr.slice(0, 4)}`;
  } catch {
    return raw;
  }
}

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

export function RoomEmbedClient({
  slug,
  roomName,
  roomDescription,
  roomCreator,
  gate,
}: Props) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateStatus, setGateStatus] = useState<{
    checked: boolean;
    eligible: boolean;
    held: string | null;
  }>({ checked: false, eligible: !gate, held: null });
  const lastTsRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Polling
  useEffect(() => {
    let cancelled = false;
    async function load(initial = false) {
      try {
        const since = lastTsRef.current > 0 && !initial ? lastTsRef.current : "";
        const r = await fetch(
          `/api/rooms/${slug}/messages?limit=200${since ? `&since=${since}` : ""}`,
          { cache: "no-store" },
        );
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

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Gate preflight
  useEffect(() => {
    if (!gate || !address) {
      setGateStatus({ checked: !gate, eligible: !gate, held: null });
      return;
    }
    let cancelled = false;
    async function checkGate() {
      try {
        const r = await fetch(
          `/api/rooms/${slug}/gate-check?address=${address!.toLowerCase()}`,
          { cache: "no-store" },
        );
        const d = await r.json().catch(() => ({}));
        if (cancelled || !d?.ok) return;
        setGateStatus({
          checked: true,
          eligible: !!d.eligible,
          held: d.held ?? null,
        });
      } catch {}
    }
    checkGate();
    const id = setInterval(checkGate, GATE_RECHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug, address, gate]);

  async function sendMessage() {
    setError(null);
    const trimmed = body.trim();
    if (!trimmed) return;
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
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setBody("");
      setMessages((prev) => [...prev, { ...data.message }]);
      lastTsRef.current = data.message.ts;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const groups = useMemo(() => {
    const out: { from: string; ts: number; items: RoomMessage[] }[] = [];
    for (const m of messages) {
      const last = out[out.length - 1];
      const closeInTime = last && m.ts - last.ts < 5 * 60 * 1000;
      if (last && last.from.toLowerCase() === m.from_address.toLowerCase() && closeInTime) {
        last.items.push(m);
      } else {
        out.push({ from: m.from_address, ts: m.ts, items: [m] });
      }
    }
    return out;
  }, [messages]);

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0f]">
      <header className="border-b border-white/[0.06] px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-white/40">#</span>
          <span className="font-display text-[15px] font-medium tracking-[-0.01em] truncate">
            {roomName}
          </span>
          {gate && (
            <span
              title={`Hold ${fmtMin(gate.minBalanceRaw, gate.decimals)} $${gate.symbol} on ${gate.chain} to post`}
              className="text-[9px] uppercase tracking-[0.15em] px-1 py-0.5 rounded-sm border border-[var(--accent)]/40 text-[var(--accent)] font-mono shrink-0"
            >
              hold ${gate.symbol}
            </span>
          )}
        </div>
        <a
          href={`/rooms/${slug}`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-white/55 hover:text-white whitespace-nowrap"
        >
          open full chat ↗
        </a>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {groups.length === 0 && !error && (
          <div className="text-center text-white/40 text-[12.5px] mt-8">
            No messages yet. Be the first.
          </div>
        )}
        {error && (
          <div className="text-[12px] text-red-400 bg-red-500/[0.08] border border-red-500/30 rounded-sm px-3 py-2">
            {error}
          </div>
        )}
        {groups.map((g, i) => (
          <MessageGroup key={`${g.from}-${g.ts}-${i}`} group={g} />
        ))}
      </div>

      <div className="border-t border-white/[0.06] px-4 py-2.5 bg-black/20">
        {!address ? (
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] text-white/65 truncate">
              Wallet-signed. Connect to post.
            </div>
            <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
          </div>
        ) : gate && gateStatus.checked && !gateStatus.eligible ? (
          <div className="text-[12px] text-white/75 leading-relaxed">
            <span className="text-[var(--accent)] font-semibold">hold-to-chat:</span>{" "}
            need{" "}
            <span className="font-mono">
              {fmtMin(gate.minBalanceRaw, gate.decimals)} ${gate.symbol}
            </span>{" "}
            to post. you hold{" "}
            <span className="font-mono">{gateStatus.held ?? "0"}</span>.
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
              placeholder={`message #${slug}`}
              className="flex-1 text-[13px] bg-black/40 border border-white/10 rounded-sm px-3 py-1.5 text-white focus:outline-none focus:border-white/30"
              disabled={sending}
            />
            <button
              onClick={sendMessage}
              disabled={sending || !body.trim()}
              className="bg-[var(--accent)] text-black font-semibold rounded-sm px-3 py-1.5 text-[12px] hover:brightness-110 transition disabled:opacity-50 uppercase tracking-wide"
            >
              {sending ? "…" : "send"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageGroup({
  group,
}: {
  group: { from: string; ts: number; items: RoomMessage[] };
}) {
  const { from, to } = avatarGradient(group.from);
  return (
    <div className="flex gap-2.5">
      <div
        className="rounded-full flex-shrink-0 mt-0.5"
        style={{
          width: 26,
          height: 26,
          background: `linear-gradient(135deg, ${from}, ${to})`,
        }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="font-mono text-[11.5px] text-white/95">{fmtAddr(group.from)}</span>
          <span className="text-[10px] font-mono text-white/35">{fmtTime(group.ts)}</span>
        </div>
        {group.items.map((m) => (
          <div
            key={m.id}
            className="text-[12.5px] text-white/85 leading-relaxed whitespace-pre-wrap break-words"
          >
            {m.body}
          </div>
        ))}
      </div>
    </div>
  );
}
