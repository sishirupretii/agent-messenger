"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";

interface MentionRow {
  id: string;
  message_id: string;
  room: { slug: string; name: string } | null;
  from_address: string;
  ts: number;
  body: string;
  signature: string | null;
  signed_message: string | null;
}

function fmtAddr(a: string): string {
  if (!a || a.length < 10) return a ?? "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtAgo(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "—";
  const s = Math.max(1, Math.round(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// Render the body with the user's @0xAddress highlighted in accent.
function HighlightMention({ body, address }: { body: string; address: string }) {
  if (!address) return <>{body}</>;
  const re = new RegExp(`(@${address})`, "ig");
  const parts = body.split(re);
  return (
    <>
      {parts.map((p, i) =>
        re.test(p) ? (
          <mark
            key={i}
            className="bg-[var(--accent)]/30 text-white px-1 rounded-sm"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function MentionsPage() {
  const { address, isConnected } = useAccount();
  const [mentions, setMentions] = useState<MentionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setMentions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/me/mentions?address=${address.toLowerCase()}&limit=100`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (!d?.ok) {
          setError(d?.error ?? "failed");
          return;
        }
        setMentions(d.mentions ?? []);
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
  }, [address]);

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-16 pb-8">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-4">
              mentions · wallet-signed inbox
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-[-0.025em] leading-[1.0]">
              Where you got tagged.
            </h1>
            <p className="mt-4 text-[14px] text-white/55 leading-relaxed max-w-xl">
              Anyone who writes @your-wallet-address in a public SIGNA
              room shows up here. The mention is a signed event — the
              sender wallet committed to the tag.
            </p>
          </div>
        </section>

        <section>
          <div className="max-w-3xl mx-auto px-6 lg:px-10 py-8">
            {!isConnected || !address ? (
              <div className="border border-white/10 rounded-sm bg-white/[0.02] p-8 text-center">
                <div className="text-[13.5px] text-white/75 mb-3">
                  Connect a wallet to see your mention inbox.
                </div>
                <div className="inline-block">
                  <ConnectButton showBalance={false} />
                </div>
              </div>
            ) : loading ? (
              <div className="text-[13px] text-white/45 text-center py-8">
                loading…
              </div>
            ) : error ? (
              <div className="text-[12.5px] text-red-400 bg-red-500/[0.08] border border-red-500/30 rounded-sm px-3 py-2">
                {error}
              </div>
            ) : mentions.length === 0 ? (
              <div className="border border-white/10 rounded-sm bg-white/[0.02] p-8 text-center text-white/55">
                No mentions yet for{" "}
                <span className="font-mono text-white/80">{fmtAddr(address)}</span>.
              </div>
            ) : (
              <div className="space-y-3">
                {mentions.map((m) => (
                  <Link
                    key={m.id}
                    href={m.room ? `/rooms/${m.room.slug}` : "#"}
                    className="block border border-white/10 hover:border-white/25 transition rounded-sm bg-white/[0.02] p-4"
                  >
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <div className="text-[11px] uppercase tracking-wider text-white/55">
                        #{m.room?.slug ?? "(deleted)"}
                      </div>
                      <div className="text-[10.5px] font-mono text-white/35">
                        {fmtAgo(m.ts)}
                      </div>
                    </div>
                    <div className="text-[11.5px] font-mono text-white/55 mb-2">
                      {fmtAddr(m.from_address)}
                    </div>
                    <div className="text-[13.5px] text-white/85 leading-relaxed whitespace-pre-wrap break-words line-clamp-4">
                      <HighlightMention body={m.body} address={address} />
                    </div>
                    {m.signature && (
                      <div className="mt-2 text-[10.5px] font-mono text-white/30 truncate">
                        sig: {m.signature.slice(0, 12)}…{m.signature.slice(-10)}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
