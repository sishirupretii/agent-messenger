"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Bounty {
  id?: string;
  title?: string;
  status?: string;
  assignee?: string;
  bounty?: { amount?: string; token?: string };
  created_at?: string;
  [k: string]: unknown;
}

function fmtAgo(ts: string | undefined): string {
  if (!ts) return "—";
  try {
    const diff = Date.now() - Date.parse(ts);
    if (!Number.isFinite(diff) || diff < 0) return "—";
    const s = Math.max(1, Math.round(diff / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  } catch {
    return "—";
  }
}

function gradientForId(id: string): { from: string; to: string } {
  const a = (id || "0").replace(/[^a-z0-9]/gi, "").padEnd(8, "0");
  const h1 = (parseInt(a.slice(0, 4), 36) || 0) % 360;
  const h2 = (parseInt(a.slice(4, 8), 36) || 180) % 360;
  return { from: `hsl(${h1} 72% 56%)`, to: `hsl(${h2} 65% 42%)` };
}

export function BountiesGrid({ bounties }: { bounties: Bounty[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  async function openRoom(id: string) {
    setLoadingId(id);
    try {
      const r = await fetch(`/api/bounties/${encodeURIComponent(id)}/room`, {
        method: "POST",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        alert(`could not open thread: ${data?.error ?? r.status}`);
        return;
      }
      router.push(`/rooms/${data.slug}`);
    } catch (e) {
      alert(`error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingId(null);
    }
  }

  if (bounties.length === 0) {
    return (
      <div className="border border-white/10 rounded-sm bg-white/[0.02] p-10 text-center text-white/55">
        No open bounties with a payout right now. Refresh in a minute.
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4" data-tick={tick}>
      {bounties.map((b, i) => {
        const id = String(b.id ?? `${i}`);
        const title = String(b.title ?? "untitled bounty");
        const amount = String(b.bounty?.amount ?? "0");
        const token = String(b.bounty?.token ?? "?");
        const assignee = b.assignee ? String(b.assignee) : null;
        const grad = gradientForId(id);
        return (
          <div
            key={id}
            className="border border-white/10 rounded-sm bg-white/[0.02] p-4 hover:border-white/25 transition-colors flex flex-col"
          >
            <div className="flex items-start gap-3 mb-3">
              <div
                className="rounded-sm flex-shrink-0 mt-0.5"
                style={{
                  width: 36,
                  height: 36,
                  background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[16px] font-medium tracking-[-0.01em] leading-tight line-clamp-2">
                  {title}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--accent)] mt-1.5">
                  {amount} {token}
                </div>
              </div>
            </div>
            <div className="text-[11.5px] font-mono text-white/45 space-y-0.5 mb-3 flex-1">
              <div>bounty id: {id.slice(0, 10)}{id.length > 10 ? "…" : ""}</div>
              {assignee ? <div>assignee: {assignee.slice(0, 16)}{assignee.length > 16 ? "…" : ""}</div> : null}
              <div>opened: {fmtAgo(b.created_at)}</div>
            </div>
            <button
              onClick={() => id && openRoom(id)}
              disabled={!id || loadingId === id}
              className="bg-[var(--accent)] text-black font-semibold rounded-sm py-2 text-[12.5px] hover:brightness-110 transition disabled:opacity-50 uppercase tracking-wide"
            >
              {loadingId === id ? "opening..." : "open bounty thread →"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
