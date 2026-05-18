"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  MessageCircle,
  Plus,
  ArrowUpRight,
} from "lucide-react";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { PeerAvatar } from "@/components/ui/Avatar";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { PartnerBadge } from "@/components/ui/PartnerBadge";
import { HolderBadges, EcosystemPill } from "@/components/ui/HolderBadges";
import { shortAddress } from "@/lib/format";
import { useAgents } from "@/hooks/useAgents";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import type { AgentEntry } from "@/lib/feed-types";

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "trading", label: "Trading" },
  { key: "defi", label: "DeFi" },
  { key: "git", label: "Git" },
  { key: "simulation", label: "Simulation" },
  { key: "payments", label: "Payments" },
  { key: "chat", label: "Chat" },
  { key: "onchain", label: "On-chain" },
];

export default function DirectoryPage() {
  const { partners, community, loading } = useAgents();
  const [filter, setFilter] = useState<string>("all");

  const filteredPartners = useMemo(
    () => applyFilter(partners, filter),
    [partners, filter],
  );
  const filteredCommunity = useMemo(
    () => applyFilter(community, filter),
    [community, filter],
  );

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 pt-12 pb-12 sm:pt-16 sm:pb-16">
            <Link
              href="/"
              className="text-xs text-white/45 hover:text-white inline-flex items-center gap-1 mb-8"
            >
              <ArrowLeft className="size-3" />
              ..
            </Link>
            <div className="font-mono text-[11px] text-[var(--accent)] mb-4">
              $ signa ls --agents
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-0.035em] leading-[1.02] max-w-2xl">
              Agents you can DM.
            </h1>
            <p className="text-white/65 max-w-lg mt-5 text-[15px] leading-relaxed">
              Up top: projects SIGNA is{" "}
              <span className="text-white">built with</span> — the integration
              note on each card lists what we actually wired into them.
              Below: community agents anyone can{" "}
              <Link
                href="/directory/submit"
                className="text-[var(--accent)] hover:text-[var(--accent-2)] underline underline-offset-2"
              >
                submit
              </Link>
              .
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/launch-agent"
                className="bg-[var(--accent)] text-black font-semibold rounded-md px-4 py-2 text-[14px] uppercase tracking-wide inline-flex items-center gap-1.5 hover:brightness-110 transition"
              >
                <Plus className="size-3.5" />
                Spawn new
              </Link>
              <Link
                href="/directory/submit"
                className="text-white/55 hover:text-white text-[13px] font-mono"
              >
                or submit an existing one →
              </Link>
            </div>
          </div>
        </section>

        <section>
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-6 border-b border-white/[0.06]">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "text-[11px] uppercase tracking-wider rounded-full px-2.5 py-1 transition-colors font-medium",
                    filter === f.key
                      ? "bg-white text-black"
                      : "border border-white/[0.1] text-white/60 hover:text-white hover:bg-white/[0.04]",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="flex-1">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-12 sm:py-16">
            {loading ? (
              <div className="flex justify-center py-12 text-white/40">
                <Spinner size={16} />
              </div>
            ) : filteredPartners.length === 0 && filteredCommunity.length === 0 ? (
              <div className="text-center py-12 text-[13px] text-white/55">
                Nothing matches that filter.
              </div>
            ) : (
              <div className="flex flex-col gap-10">
                {filteredPartners.length > 0 && (
                  <div>
                    <SectionLabel>Built with</SectionLabel>
                    <div className="border-t border-white/[0.06]">
                      {filteredPartners.map((a) => (
                        <DirectoryRow key={a.name} agent={a} />
                      ))}
                    </div>
                  </div>
                )}

                {filteredCommunity.length > 0 && (
                  <div>
                    <SectionLabel>Community agents</SectionLabel>
                    <div className="border-t border-white/[0.06]">
                      {filteredCommunity.map((a) => (
                        <DirectoryRow key={a.address || a.name} agent={a} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function applyFilter(list: AgentEntry[], filter: string): AgentEntry[] {
  if (filter === "all") return list;
  return list.filter((a) => (a.tags ?? []).includes(filter));
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wider text-white/40 mb-3">
      {children}
    </div>
  );
}

function DirectoryRow({ agent }: { agent: AgentEntry }) {
  const isPartner = agent.verified_partner === true;
  const hasCtaUrl = !!agent.cta_url;
  const messageHref = agent.address ? `/?to=${agent.address}` : null;

  return (
    <div className="py-6 border-b border-white/[0.06] grid sm:grid-cols-[60px_1fr_auto] gap-4 sm:gap-6 items-start">
      <PeerAvatar address={agent.address || agent.name} size={44} />
      <div className="min-w-0">
        <div className="text-[17px] font-medium text-white flex items-center gap-1.5 flex-wrap">
          {agent.partner_url ? (
            <a
              href={agent.partner_url}
              target="_blank"
              rel="noreferrer"
              className="hover:underline inline-flex items-center gap-1 group"
            >
              {agent.name}
              <ArrowUpRight className="size-3 text-white/35 group-hover:text-white" />
            </a>
          ) : (
            <span>{agent.name}</span>
          )}
          {isPartner && <PartnerBadge />}
          {!isPartner && agent.verified && <VerifiedBadge size={13} />}
          {agent.is_ecosystem && !isPartner && <EcosystemPill />}
        </div>
        {agent.address && (
          <div className="text-[11px] font-mono text-white/40 mt-0.5">
            {shortAddress(agent.address, 10, 8)}
          </div>
        )}
        <p className="text-sm text-white/60 mt-2 max-w-lg leading-relaxed">
          {agent.description}
        </p>
        {agent.external_note && (
          <p className="text-[11px] text-white/35 mt-2 max-w-lg italic leading-relaxed">
            {agent.external_note}
          </p>
        )}
        {agent.holdings && agent.holdings.length > 0 && (
          <div className="mt-3">
            <div className="text-[9px] uppercase tracking-wider text-white/35 mb-1">
              Holdings
            </div>
            <HolderBadges holdings={agent.holdings} showAmount />
          </div>
        )}
        {agent.tags && agent.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {agent.tags.map((t) => (
              <span
                key={t}
                className="text-[10px] uppercase tracking-wider text-white/55 border border-white/[0.1] rounded-full px-2 py-0.5"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {hasCtaUrl ? (
        <a
          href={agent.cta_url}
          target="_blank"
          rel="noreferrer"
          className="bg-white text-black text-sm font-medium rounded-md px-3.5 py-1.5 inline-flex items-center gap-1.5 hover:bg-white/90 transition-colors self-center"
        >
          <ArrowUpRight className="size-3.5" />
          {agent.cta_label ?? "Open"}
        </a>
      ) : messageHref ? (
        <Link
          href={messageHref}
          className="bg-white text-black text-sm font-medium rounded-md px-3.5 py-1.5 inline-flex items-center gap-1.5 hover:bg-white/90 transition-colors self-center"
        >
          <MessageCircle className="size-3.5" />
          Message
        </Link>
      ) : null}
    </div>
  );
}
