"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface RoomHit {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  creator_address: string;
  gate_token_symbol: string | null;
  created_at: string;
}

interface MessageHit {
  id: string;
  room_id: string;
  room_slug: string;
  from_address: string;
  body: string;
  ts: number;
}

function fmtAddr(a: string): string {
  if (!a || a.length < 10) return a ?? "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtTime(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q || q.length < 2) return <>{text}</>;
  try {
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    const parts = text.split(re);
    return (
      <>
        {parts.map((p, i) =>
          re.test(p) ? (
            <mark
              key={i}
              className="bg-[var(--accent)]/30 text-white px-0.5 rounded-sm"
            >
              {p}
            </mark>
          ) : (
            <span key={i}>{p}</span>
          ),
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}

export function SearchClient() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [rooms, setRooms] = useState<RoomHit[]>([]);
  const [messages, setMessages] = useState<MessageHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Debounce
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    if (debounced.length < 2) {
      setRooms([]);
      setMessages([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/search?q=${encodeURIComponent(debounced)}&limit=20`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (!d?.ok) {
          setError(d?.error ?? "search_failed");
          setRooms([]);
          setMessages([]);
          return;
        }
        setRooms(d.rooms ?? []);
        setMessages(d.messages ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <div>
      <div className="border border-white/15 rounded-md bg-black/40 flex items-center gap-3 px-4 py-3">
        <span className="text-white/35 font-mono">/</span>
        <input
          autoFocus
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="token symbol, room slug, 0x address, or any phrase…"
          className="flex-1 bg-transparent text-[14.5px] text-white focus:outline-none placeholder:text-white/30"
          spellCheck={false}
        />
        {loading && <span className="text-[11px] text-white/45">searching…</span>}
      </div>

      {error && (
        <div className="mt-4 text-[12.5px] text-red-400 bg-red-500/[0.08] border border-red-500/30 rounded-sm px-3 py-2">
          {error}
        </div>
      )}

      {debounced.length >= 2 && !loading && rooms.length === 0 && messages.length === 0 && !error && (
        <div className="mt-8 text-center text-[13px] text-white/45">
          No matches for{" "}
          <span className="font-mono text-white/70">&quot;{debounced}&quot;</span>.
        </div>
      )}

      {rooms.length > 0 && (
        <div className="mt-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45 mb-3">
            rooms · {rooms.length}
          </div>
          <div className="space-y-2">
            {rooms.map((r) => (
              <Link
                key={r.id}
                href={`/rooms/${r.slug}`}
                className="block border border-white/10 hover:border-white/25 transition rounded-sm bg-white/[0.02] p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-display text-[15.5px] font-medium tracking-[-0.01em] truncate">
                    <Highlight text={r.name} q={debounced} />
                  </div>
                  <div className="text-[10.5px] font-mono text-white/40 shrink-0">
                    #{r.slug}
                  </div>
                </div>
                {r.description && (
                  <div className="text-[12.5px] text-white/55 line-clamp-1 mt-1">
                    <Highlight text={r.description} q={debounced} />
                  </div>
                )}
                <div className="flex items-center gap-3 mt-1 text-[10.5px] font-mono text-white/35">
                  <span>by {fmtAddr(r.creator_address)}</span>
                  {r.gate_token_symbol && (
                    <span className="text-[var(--accent)]">
                      ${r.gate_token_symbol}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {messages.length > 0 && (
        <div className="mt-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45 mb-3">
            signed messages · {messages.length}
          </div>
          <div className="space-y-2">
            {messages.map((m) => (
              <Link
                key={m.id}
                href={`/rooms/${m.room_slug}`}
                className="block border border-white/10 hover:border-white/25 transition rounded-sm bg-white/[0.02] p-3"
              >
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <div className="text-[11px] uppercase tracking-wider text-white/55 truncate">
                    #{m.room_slug}
                  </div>
                  <div className="text-[10.5px] font-mono text-white/35 shrink-0">
                    {fmtTime(m.ts)}
                  </div>
                </div>
                <div className="text-[10.5px] font-mono text-white/45 mb-1">
                  {fmtAddr(m.from_address)}
                </div>
                <div className="text-[13px] text-white/80 leading-relaxed line-clamp-3 whitespace-pre-wrap break-words">
                  <Highlight text={m.body} q={debounced} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {debounced.length < 2 && (
        <div className="mt-8 text-[12.5px] text-white/45 leading-relaxed">
          <div className="uppercase tracking-[0.18em] text-[10.5px] text-white/35 mb-2">
            try
          </div>
          <ul className="space-y-1 text-white/55 font-mono">
            <li>vorxis</li>
            <li>0x9994bb1e0873d63747d6e2570086cd5c39fbb97b</li>
            <li>swarm</li>
            <li>bankr</li>
          </ul>
        </div>
      )}
    </div>
  );
}
