"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface DirectoryEntry {
  tokenId: number;
  owner: string;
  uri: string;
  name: string | null;
  description: string | null;
  image: string | null;
  serviceCount: number;
  x402Support: boolean;
  active: boolean;
}

function fmtAddr(a: string): string {
  if (!a || a.length < 10) return a ?? "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function gradientFor(addr: string): { from: string; to: string } {
  const a = (addr ?? "0x0").toLowerCase().replace(/^0x/, "").padEnd(8, "0");
  const h1 = parseInt(a.slice(0, 4), 16) % 360;
  const h2 = parseInt(a.slice(4, 8), 16) % 360;
  return { from: `hsl(${h1} 72% 56%)`, to: `hsl(${h2} 65% 42%)` };
}

export function AeonDirectoryGrid({ agents }: { agents: DirectoryEntry[] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (agents.length === 0) {
    return (
      <div className="border border-white/10 rounded-sm bg-white/[0.02] p-10 text-center text-white/55">
        No Aeon agents indexed yet. Cache will refresh in a minute.
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4" data-tick={tick}>
      {agents.map((a) => {
        const grad = gradientFor(a.owner);
        const displayName = a.name || `Agent #${a.tokenId}`;
        return (
          <div
            key={a.tokenId}
            className="border border-white/10 rounded-sm bg-white/[0.02] p-4 hover:border-white/25 transition-colors flex flex-col"
          >
            <div className="flex items-start gap-3 mb-3">
              <div
                className="rounded-full flex-shrink-0 mt-0.5"
                style={{
                  width: 36,
                  height: 36,
                  background: a.image
                    ? `center/cover no-repeat url(${a.image})`
                    : `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[16px] font-medium tracking-[-0.01em] truncate">
                  {displayName}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-white/45 mt-0.5">
                  erc-8004 · id {a.tokenId}
                </div>
              </div>
              {a.x402Support && (
                <span
                  title="Accepts x402 paid services"
                  className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-[var(--accent)]/40 text-[var(--accent)] font-mono"
                >
                  x402
                </span>
              )}
            </div>
            <div className="text-[12.5px] text-white/65 leading-relaxed mb-3 line-clamp-3 flex-1">
              {a.description || "No description set on-chain."}
            </div>
            <div className="text-[11px] font-mono text-white/40 space-y-0.5 mb-3">
              <div>owner: {fmtAddr(a.owner)}</div>
              <div>services: {a.serviceCount}</div>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/agent/${a.owner}`}
                className="flex-1 bg-[var(--accent)] text-black font-semibold rounded-sm py-2 text-[12px] text-center hover:brightness-110 transition uppercase tracking-wide"
              >
                ping →
              </Link>
              <a
                href={`https://etherscan.io/nft/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/${a.tokenId}`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-2 text-[11.5px] text-white/55 hover:text-white border border-white/10 hover:border-white/25 rounded-sm transition"
                title="View on Etherscan"
              >
                ↗
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
