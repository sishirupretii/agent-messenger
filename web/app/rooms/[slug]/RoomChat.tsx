"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAccount, useWalletClient } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { getRoomBadges, type RoomBadge } from "@/lib/room-badges";

interface RoomMessage {
  id: string;
  from_address: string;
  body: string;
  body_type: string;
  ts: number;
  signature?: string;
  in_reply_to: string | null;
  created_at?: string;
}

interface RoomLink {
  name: string;
  slug: string;
  description: string | null;
  gate_token_address?: string | null;
}

const TONE_STYLE: Record<RoomBadge["tone"], string> = {
  accent:
    "border-[var(--accent)]/40 text-[var(--accent)]",
  cyan: "border-cyan-300/40 text-cyan-300",
  magenta: "border-fuchsia-300/40 text-fuchsia-300",
  green: "border-emerald-300/40 text-emerald-300",
};

const ANCHOR_RECHECK_MS = 60_000;

interface RoomGate {
  tokenAddress: string;
  chain: string;
  symbol: string;
  decimals: number;
  minBalanceRaw: string;
}

interface RoomChatProps {
  slug: string;
  roomName: string;
  roomDescription: string | null;
  roomCreator: string;
  roomCreatedAt: string;
  rooms: RoomLink[];
  gate?: RoomGate | null;
}

const POLL_MS = 4_000;
const GATE_RECHECK_MS = 30_000;

function buyLinkFor(gate: RoomGate): string {
  // Default to Aerodrome on Base for now (where Bankr tokens settle).
  // Anyone on the chain can swap there. Future: per-chain router.
  if (gate.chain.toLowerCase() === "base") {
    return `https://aerodrome.finance/swap?to=${gate.tokenAddress}`;
  }
  if (gate.chain.toLowerCase() === "solana") {
    return `https://jup.ag/swap/SOL-${gate.tokenAddress}`;
  }
  return `https://www.geckoterminal.com/${gate.chain.toLowerCase()}/pools/${gate.tokenAddress}`;
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

// ───────────────────────── helpers ─────────────────────────

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

function fmtDay(ms: number): string {
  try {
    const d = new Date(ms);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);
    if (d.toDateString() === today.toDateString()) return "today";
    if (d.toDateString() === yesterday.toDateString()) return "yesterday";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
    });
  } catch {
    return "—";
  }
}

// Deterministic gradient per address: pick two HSL hues from the address bytes.
function avatarGradient(addr: string): { from: string; to: string } {
  const a = addr.toLowerCase().replace(/^0x/, "");
  const h1 = parseInt(a.slice(0, 4), 16) % 360;
  const h2 = parseInt(a.slice(4, 8), 16) % 360;
  return {
    from: `hsl(${h1} 70% 55%)`,
    to: `hsl(${h2} 65% 45%)`,
  };
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

// ─────────────────── slash command engine ───────────────────

interface SlashCommand {
  name: string;
  syntax: string;
  desc: string;
  run: (args: string) => Promise<string>;
}

const SLASH: SlashCommand[] = [
  {
    name: "bankr",
    syntax: "/bankr <handle>",
    desc: "Resolve any ENS / Twitter / Farcaster / 0x handle to a wallet via Bankr.",
    async run(args) {
      if (!args.trim()) return "/bankr — usage: /bankr <handle>";
      const r = await fetch(`/api/partners/bankr/resolve?value=${encodeURIComponent(args.trim())}`);
      const d = await r.json().catch(() => ({}));
      if (!d?.ok) return `/bankr ${args}\n  ↳ ${d?.error ?? "could not resolve"}`;
      const res = d.resolution ?? {};
      const extra = res.type ? ` (${res.type})` : "";
      return `/bankr ${args}\n  ↳ ${res.address}${extra}`;
    },
  },
  {
    name: "launches",
    syntax: "/launches [N]",
    desc: "Show the last N recent Bankr token launches on Base + Solana.",
    async run(args) {
      const n = Math.min(Math.max(Number(args.trim() || 5), 1), 10);
      const r = await fetch(`/api/partners/bankr/launches?limit=${n}`);
      const d = await r.json().catch(() => ({}));
      if (!d?.ok) return `/launches\n  ↳ failed: ${d?.error ?? "unknown"}`;
      const lines = [`/launches\n  ↳ ${d.count} recent launches`];
      for (const l of d.launches ?? []) {
        const sym = l.tokenSymbol ?? l.symbol ?? "?";
        const name = l.tokenName ?? l.name ?? "";
        const dep = l.feeRecipient?.xUsername
          ? `@${l.feeRecipient.xUsername}`
          : l.deployer?.walletAddress
            ? l.deployer.walletAddress.slice(0, 6) + "…" + l.deployer.walletAddress.slice(-4)
            : "";
        lines.push(`    [${l.chain ?? "?"}] $${sym} — ${name}${dep ? "  by " + dep : ""}`);
      }
      return lines.join("\n");
    },
  },
  {
    name: "aeon",
    syntax: "/aeon <token_id>",
    desc: "Look up an Aeon / ERC-8004 agent registration on Ethereum mainnet.",
    async run(args) {
      const id = args.trim();
      if (!/^\d+$/.test(id)) return "/aeon — usage: /aeon <numeric_token_id>";
      const r = await fetch(`/api/partners/aeon/${id}`);
      const d = await r.json().catch(() => ({}));
      if (!d?.ok) return `/aeon ${id}\n  ↳ ${d?.error ?? "lookup failed"} (try sepolia if mainnet returns no result)`;
      const reg = d.registration ?? {};
      const bits = [`/aeon ${id}`, `  ↳ owner: ${d.owner}`, `  ↳ uri: ${d.uri}`];
      if (reg.name) bits.push(`  ↳ name: ${reg.name}`);
      if (Array.isArray(reg.services)) bits.push(`  ↳ services: ${reg.services.length}`);
      return bits.join("\n");
    },
  },
  {
    name: "gitlawb",
    syntax: "/gitlawb <0x address>",
    desc: "Pull repos / commits / bounty totals for an agent bound to a gitlawb DID.",
    async run(args) {
      const addr = args.trim().toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(addr)) return "/gitlawb — usage: /gitlawb <0x address>";
      const r = await fetch(`/api/agents/${addr}/gitlawb-stats`);
      if (r.status === 404) {
        return `/gitlawb ${addr}\n  ↳ no gitlawb DID bound to this wallet`;
      }
      const d = await r.json().catch(() => ({}));
      if (!d?.ok) return `/gitlawb ${addr}\n  ↳ ${d?.error ?? "lookup failed"}`;
      return [
        `/gitlawb ${addr}`,
        `  ↳ DID: ${d.gitlawb_did ?? "(none)"}`,
        `  ↳ repos: ${d.repo_count ?? 0} · commits: ${d.total_commits ?? 0} · open tasks: ${d.open_tasks ?? 0}`,
      ].join("\n");
    },
  },
  {
    name: "miroshark",
    syntax: "/miroshark <0x address>",
    desc: "MiroShark sim activity for any SIGNA wallet (sims fired + verdicts).",
    async run(args) {
      const addr = args.trim().toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(addr)) return "/miroshark — usage: /miroshark <0x address>";
      const r = await fetch(`/api/agents/${addr}/miroshark-stats`);
      const d = await r.json().catch(() => ({}));
      if (!d?.ok) return `/miroshark ${addr}\n  ↳ ${d?.error ?? "lookup failed"}`;
      return `/miroshark ${addr}\n  ↳ sims fired: ${d.sims_fired ?? 0} · verdicts: ${d.verdicts_received ?? 0}`;
    },
  },
  {
    name: "help",
    syntax: "/help",
    desc: "Show the list of slash commands in this room.",
    async run() {
      return [
        "/help",
        "  ↳ available slash commands in this room:",
        ...SLASH.filter((c) => c.name !== "help").map((c) => `    ${c.syntax}  — ${c.desc}`),
      ].join("\n");
    },
  },
];

async function executeSlash(input: string): Promise<string | null> {
  const m = input.match(/^\/(\w+)(?:\s+(.+))?$/s);
  if (!m) return null;
  const cmd = SLASH.find((c) => c.name === m[1].toLowerCase());
  if (!cmd) return null;
  try {
    return await cmd.run(m[2] ?? "");
  } catch (e) {
    return `/${m[1]}\n  ↳ command failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ────────────────────── component ──────────────────────

export function RoomChat({
  slug,
  roomName,
  roomDescription,
  roomCreator,
  roomCreatedAt,
  rooms,
  gate,
}: RoomChatProps) {
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
  const [anchor, setAnchor] = useState<{
    anchored: boolean;
    match: boolean;
    contract: string | null;
  }>({ anchored: false, match: false, contract: null });
  const lastTsRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Slash autocomplete state
  const slashOpen = body.startsWith("/") && !body.includes("\n");
  const slashFilter = slashOpen ? body.slice(1).split(/\s/)[0].toLowerCase() : "";
  const slashHits = useMemo(
    () => (slashOpen ? SLASH.filter((c) => c.name.startsWith(slashFilter)) : []),
    [slashOpen, slashFilter],
  );

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

  // On-chain anchor preflight (v0.51). Polls the registry every 60s so a
  // freshly-anchored room flips the badge without a refresh. Read-only.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch(`/api/rooms/${slug}/anchor`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (cancelled || !d?.ok) return;
        setAnchor({
          anchored: !!d.anchored,
          match: !!d.match,
          contract: d.contract ?? null,
        });
      } catch {
        // swallow
      }
    }
    poll();
    const id = setInterval(poll, ANCHOR_RECHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug]);

  // Gate preflight (v0.43). Re-runs whenever the connected wallet changes
  // and every 30s after that so freshly-bought holders can post without
  // refreshing the page.
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
      } catch {
        // leave previous state
      }
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
      let bodyToSend = trimmed;
      // Run slash command and use its output as the message body
      const slashResult = await executeSlash(trimmed);
      if (slashResult !== null) {
        bodyToSend = slashResult;
      }
      if (bodyToSend.length > 8000) bodyToSend = bodyToSend.slice(0, 8000);

      const ts = Date.now();
      const message = buildRoomMessagePreimage({
        ts,
        address,
        room_slug: slug,
        body: bodyToSend,
      });
      const signature = await walletClient.signMessage({ message });
      const r = await fetch(`/api/rooms/${slug}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: address.toLowerCase(),
          body: bodyToSend,
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

  // Members panel — derived from recent posters (last 100 messages)
  const members = useMemo(() => {
    const map = new Map<string, { lastTs: number; count: number }>();
    for (const m of messages.slice(-100)) {
      const a = m.from_address.toLowerCase();
      const prev = map.get(a);
      map.set(a, {
        lastTs: Math.max(prev?.lastTs ?? 0, m.ts),
        count: (prev?.count ?? 0) + 1,
      });
    }
    return Array.from(map.entries())
      .map(([address, info]) => ({ address, ...info }))
      .sort((a, b) => b.lastTs - a.lastTs);
  }, [messages]);

  // Group consecutive messages by sender + within 5 min
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
    <div className="h-full grid grid-cols-[240px_1fr_260px] gap-px bg-white/[0.04]">
      {/* Left: room list */}
      <aside className="bg-[#0a0a0f] overflow-y-auto">
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40 mb-3">rooms</div>
          <div className="space-y-0.5">
            {rooms.map((r) => {
              const badges = getRoomBadges({
                slug: r.slug,
                gate_token_address: r.gate_token_address ?? null,
              });
              const b = badges[0] ?? null;
              return (
                <Link
                  key={r.slug}
                  href={`/rooms/${r.slug}`}
                  className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[13.5px] ${
                    r.slug === slug
                      ? "bg-white/[0.08] text-white"
                      : "text-white/65 hover:text-white hover:bg-white/[0.03]"
                  }`}
                  title={b?.title ?? r.description ?? r.name}
                >
                  <span className="text-white/40">#</span>
                  <span className="truncate flex-1">{r.slug}</span>
                  {b && (
                    <span
                      className={`text-[8.5px] uppercase tracking-wider font-mono px-1 rounded-sm border ${TONE_STYLE[b.tone]} opacity-70 group-hover:opacity-100`}
                    >
                      {b.shortLabel}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-white/[0.06]">
            <Link
              href="/rooms"
              className="block text-[12px] text-[var(--accent)] hover:brightness-110 px-2.5 py-1.5"
            >
              + create new room
            </Link>
          </div>
        </div>
      </aside>

      {/* Center: chat */}
      <div className="bg-[#0a0a0f] flex flex-col min-h-0">
        <header className="border-b border-white/[0.06] px-5 py-3 flex items-baseline gap-2 flex-wrap">
          <div className="text-white/40 text-[16px]">#</div>
          <div className="font-display text-[19px] font-medium tracking-[-0.015em]">{roomName}</div>
          {getRoomBadges({ slug, gate_token_address: gate?.tokenAddress ?? null }).map((b) => (
            <span
              key={b.key}
              title={b.title}
              className={`text-[10px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded-sm border font-mono ${TONE_STYLE[b.tone]}`}
            >
              {b.label}
            </span>
          ))}
          {gate && (
            <span
              title={`Hold-to-chat · ${fmtMin(gate.minBalanceRaw, gate.decimals)} $${gate.symbol} on ${gate.chain}`}
              className="text-[10px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded-sm border border-[var(--accent)]/40 text-[var(--accent)] font-mono"
            >
              hold ${gate.symbol} to chat
            </span>
          )}
          {anchor.anchored && anchor.match && (
            <span
              title="Room manifest hash is anchored on Base mainnet and matches what this node serves. Federation can verify this room without trusting our server."
              className={`text-[10px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded-sm border font-mono ${TONE_STYLE.green}`}
            >
              anchored on base
            </span>
          )}
          {anchor.anchored && !anchor.match && (
            <span
              title="Room is anchored on-chain but this node's signed manifest hash does NOT match. Treat with caution — could be a fork or a node serving stale data."
              className="text-[10px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded-sm border border-red-400/40 text-red-300 font-mono"
            >
              anchor mismatch
            </span>
          )}
          {roomDescription && (
            <div className="text-[12.5px] text-white/45 truncate hidden md:block">
              {roomDescription}
            </div>
          )}
          <button
            onClick={() => {
              const code = `<iframe src="https://www.signaagent.xyz/rooms/${slug}/embed" style="width:100%;height:560px;border:0;border-radius:8px" allow="clipboard-write" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"></iframe>`;
              navigator.clipboard.writeText(code).then(() => {
                alert("embed code copied — paste into any HTML page");
              }).catch(() => {
                window.prompt("copy this embed code:", code);
              });
            }}
            title="Copy iframe embed code"
            className="ml-auto text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 rounded-sm border border-white/15 hover:border-white/30 text-white/55 hover:text-white font-mono transition"
          >
            ⧉ embed
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {groups.length === 0 && !error && (
            <div className="text-center text-white/40 text-[13.5px] mt-12">
              No messages yet. Be the first.
            </div>
          )}
          {error && (
            <div className="text-[12.5px] text-red-400 bg-red-500/[0.08] border border-red-500/30 rounded-sm px-3 py-2">
              {error}
            </div>
          )}
          {groups.map((g, i) => (
            <MessageGroup key={`${g.from}-${g.ts}-${i}`} group={g} prevDayMs={i > 0 ? groups[i - 1].ts : null} />
          ))}
        </div>

        {/* Slash autocomplete */}
        {slashOpen && slashHits.length > 0 && (
          <div className="border-t border-white/[0.06] bg-black/40 max-h-44 overflow-y-auto">
            {slashHits.map((c) => (
              <button
                key={c.name}
                onClick={() => setBody(`/${c.name} `)}
                className="w-full text-left px-5 py-2 hover:bg-white/[0.04] block"
              >
                <span className="font-mono text-[12.5px] text-[var(--accent)]">{c.syntax}</span>
                <span className="text-[12px] text-white/55 ml-3">{c.desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-white/[0.06] px-5 py-3 bg-black/20">
          {!address ? (
            <div className="flex items-center justify-between gap-3">
              <div className="text-[12.5px] text-white/65">
                Connect a wallet to post. Every message is wallet-signed locally.
              </div>
              <ConnectButton showBalance={false} chainStatus="none" />
            </div>
          ) : gate && gateStatus.checked && !gateStatus.eligible ? (
            <div className="flex items-center justify-between gap-3 border border-[var(--accent)]/30 bg-[var(--accent)]/[0.04] rounded-sm px-3 py-2.5">
              <div className="text-[12.5px] text-white/80 leading-relaxed">
                <span className="text-[var(--accent)] font-semibold">hold-to-chat:</span>{" "}
                this room requires at least{" "}
                <span className="font-mono">
                  {fmtMin(gate.minBalanceRaw, gate.decimals)} ${gate.symbol}
                </span>{" "}
                on {gate.chain} to post. you hold{" "}
                <span className="font-mono">{gateStatus.held ?? "0"}</span>. reading stays open.
              </div>
              <a
                href={buyLinkFor(gate)}
                target="_blank"
                rel="noreferrer"
                className="bg-[var(--accent)] text-black font-semibold rounded-sm px-3 py-1.5 text-[12px] hover:brightness-110 transition uppercase tracking-wide whitespace-nowrap"
              >
                buy ${gate.symbol} →
              </a>
            </div>
          ) : (
            <>
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
                  placeholder={`message #${slug}  ·  type /  for slash commands`}
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
              <div className="mt-1.5 text-[10.5px] text-white/30">
                posting as {fmtAddr(address)} · wallet-signed end to end
                {gate && gateStatus.eligible && gateStatus.held
                  ? ` · holding ${gateStatus.held} $${gate.symbol}`
                  : ""}
                {" "}· / for slash commands
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right: members + room info */}
      <aside className="bg-[#0a0a0f] overflow-y-auto">
        <div className="p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40 mb-3">about</div>
          <div className="text-[12.5px] text-white/75 leading-relaxed mb-2">
            {roomDescription || "No description set."}
          </div>
          <div className="text-[11px] font-mono text-white/40 leading-relaxed">
            created by {fmtAddr(roomCreator)}
            <br />
            on {fmtDay(new Date(roomCreatedAt).getTime())}
          </div>
          {gate && (
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/40 mb-1.5">
                hold-to-chat
              </div>
              <div className="text-[12px] text-white/80">
                <span className="font-mono">{fmtMin(gate.minBalanceRaw, gate.decimals)} ${gate.symbol}</span>
                <span className="text-white/45"> on {gate.chain}</span>
              </div>
              <div className="text-[10.5px] font-mono text-white/35 truncate mt-1">
                {gate.tokenAddress.slice(0, 10)}…{gate.tokenAddress.slice(-6)}
              </div>
              <a
                href={buyLinkFor(gate)}
                target="_blank"
                rel="noreferrer"
                className="inline-block mt-2 text-[11px] text-[var(--accent)] hover:brightness-110"
              >
                buy ${gate.symbol} →
              </a>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/[0.06]">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40 mb-3">
            members · {members.length}
          </div>
          {members.length === 0 ? (
            <div className="text-[12px] text-white/40">No posters yet.</div>
          ) : (
            <div className="space-y-1.5">
              {members.map((m) => (
                <div key={m.address} className="flex items-center gap-2.5 text-[12.5px]">
                  <Avatar address={m.address} size={20} />
                  <span className="font-mono text-white/75 truncate">{fmtAddr(m.address)}</span>
                  <span className="text-white/30 text-[11px] ml-auto">{m.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/[0.06]">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40 mb-3">
            slash commands
          </div>
          <div className="space-y-1.5">
            {SLASH.filter((c) => c.name !== "help").map((c) => (
              <button
                key={c.name}
                onClick={() => setBody(`/${c.name} `)}
                className="block w-full text-left text-[11.5px] hover:bg-white/[0.03] rounded-sm px-1.5 py-1 -mx-1.5"
              >
                <div className="font-mono text-[var(--accent)]">{c.syntax}</div>
                <div className="text-white/45 text-[11px] mt-0.5">{c.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function MessageGroup({
  group,
  prevDayMs,
}: {
  group: { from: string; ts: number; items: RoomMessage[] };
  prevDayMs: number | null;
}) {
  const showDay =
    prevDayMs == null ||
    new Date(prevDayMs).toDateString() !== new Date(group.ts).toDateString();

  return (
    <>
      {showDay && (
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-white/40 py-1">
          <div className="h-px bg-white/[0.06] flex-1" />
          <span>{fmtDay(group.ts)}</span>
          <div className="h-px bg-white/[0.06] flex-1" />
        </div>
      )}
      <div className="flex gap-3">
        <Avatar address={group.from} size={36} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2.5 mb-0.5">
            <span className="font-mono text-[13px] text-white/95">{fmtAddr(group.from)}</span>
            <span className="text-[10.5px] font-mono text-white/35">{fmtTime(group.ts)}</span>
          </div>
          {group.items.map((m) => (
            <div key={m.id} className="group flex items-start gap-2">
              <div className="text-[14px] text-white/85 leading-relaxed whitespace-pre-wrap break-words flex-1">
                {m.body}
              </div>
              <a
                href={`/api/dm/${m.id}`}
                target="_blank"
                rel="noreferrer"
                title="re-verify this message on prod"
                className="text-[10px] text-white/25 hover:text-white/55 opacity-0 group-hover:opacity-100 transition mt-1"
              >
                verify
              </a>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Avatar({ address, size }: { address: string; size: number }) {
  const { from, to } = avatarGradient(address);
  return (
    <div
      className="rounded-full flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${from}, ${to})`,
      }}
      aria-label={`avatar for ${address}`}
    />
  );
}
