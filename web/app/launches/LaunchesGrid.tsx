"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Launch {
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenName?: string;
  chain?: string;
  timestamp?: number | string;
  deployer?: { walletAddress?: string };
  feeRecipient?: { xUsername?: string };
}

function fmtAgo(ts: number | string | undefined): string {
  if (!ts) return "—";
  try {
    const ms = typeof ts === "number" ? ts : Number(ts);
    if (!Number.isFinite(ms)) return "—";
    const diff = Date.now() - ms;
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

function fmtAddr(a: string | undefined): string {
  if (!a || a.length < 10) return a ?? "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function gradientFor(addr: string): { from: string; to: string } {
  const a = (addr ?? "0x0").toLowerCase().replace(/^0x/, "").padEnd(8, "0");
  const h1 = parseInt(a.slice(0, 4), 16) % 360;
  const h2 = parseInt(a.slice(4, 8), 16) % 360;
  return { from: `hsl(${h1} 72% 56%)`, to: `hsl(${h2} 65% 42%)` };
}

export function LaunchesGrid({ launches }: { launches: Launch[] }) {
  const router = useRouter();
  const [loadingAddr, setLoadingAddr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Refresh "X ago" labels every 10s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  async function openChat(addr: string) {
    setLoadingAddr(addr);
    try {
      const r = await fetch(`/api/launches/${addr}/room`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        alert(`could not open chat: ${data?.error ?? r.status}`);
        return;
      }
      router.push(`/rooms/${data.slug}`);
    } catch (e) {
      alert(`error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingAddr(null);
    }
  }

  if (launches.length === 0) {
    return (
      <div className="border border-white/10 rounded-sm bg-white/[0.02] p-10 text-center text-white/55">
        Bankr feed temporarily empty. Refresh in a minute.
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4" data-tick={tick}>
      {launches.map((l, i) => {
        const addr = l.tokenAddress ?? "";
        const symbol = l.tokenSymbol ?? "?";
        const name = l.tokenName ?? "";
        const chain = l.chain ?? "?";
        const deployerAddr = l.deployer?.walletAddress;
        const deployerHandle = l.feeRecipient?.xUsername;
        const grad = gradientFor(addr || `${symbol}-${i}`);
        return (
          <div
            key={`${addr || symbol}-${i}`}
            className="border border-white/10 rounded-sm bg-white/[0.02] p-4 hover:border-white/25 transition-colors flex flex-col"
          >
            <div className="flex items-start gap-3 mb-3">
              <div
                className="rounded-full flex-shrink-0 mt-0.5"
                style={{
                  width: 36,
                  height: 36,
                  background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[18px] font-medium tracking-[-0.01em] truncate">
                  ${symbol}
                </div>
                <div className="text-[12.5px] text-white/55 truncate">{name}</div>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-white/40 mt-1">
                {chain}
              </div>
            </div>
            <div className="text-[11.5px] font-mono text-white/45 space-y-0.5 mb-3 flex-1">
              <div>address: {fmtAddr(addr)}</div>
              {deployerHandle ? (
                <div>deployer: @{deployerHandle}</div>
              ) : deployerAddr ? (
                <div>deployer: {fmtAddr(deployerAddr)}</div>
              ) : null}
              <div>launched: {fmtAgo(l.timestamp)}</div>
            </div>
            <button
              onClick={() => addr && openChat(addr)}
              disabled={!addr || loadingAddr === addr}
              className="bg-[var(--accent)] text-black font-semibold rounded-sm py-2 text-[12.5px] hover:brightness-110 transition disabled:opacity-50 uppercase tracking-wide"
            >
              {loadingAddr === addr ? "opening..." : "open chat →"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
