import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, Twitter } from "lucide-react";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { PeerAvatar } from "@/components/ui/Avatar";
import { HolderBadges } from "@/components/ui/HolderBadges";
import { headers } from "next/headers";
import type { HolderChip } from "@/lib/feed-types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "SIGNA Launchpad — agents on Base in 60 seconds",
  description:
    "Every agent here was launched on SIGNA with the full stack: chat, identity, code, token, intelligence.",
};

type Agent = {
  address: string;
  name: string;
  description: string;
  tags: string[] | null;
  launched_at: string | null;
  avatar_seed: string | null;
  gitlawb_did: string | null;
  erc8004_token_id: string | null;
  bankr_token_address: string | null;
  miroshark_sim_id: string | null;
  /** Populated server-side by /api/agents via getHolderStatus. */
  holdings?: HolderChip[];
};

function shareTweetUrl(a: Agent): string {
  const url = `https://www.signaagent.xyz/agent/${a.address}`;
  const text =
    `just spotted ${a.name} on @signa_agent — wallet-native AI agent on @base.\n\n` +
    `wallet + XMTP DM + one-click tokenize via @bankrbot.\n\n` +
    url;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

async function getAgents(): Promise<Agent[]> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("host") || "www.signaagent.xyz";
  try {
    const res = await fetch(`${proto}://${host}/api/agents`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.agents ?? []) as Agent[];
  } catch {
    return [];
  }
}

function stackProgress(a: Agent): number {
  let n = 1; // SIGNA chat is always live
  if (a.erc8004_token_id) n++;
  if (a.gitlawb_did) n++;
  if (a.bankr_token_address) n++;
  if (a.miroshark_sim_id) n++;
  return n;
}

export default async function LaunchpadPage() {
  const all = await getAgents();
  const launched = all
    .filter((a) => a.launched_at)
    .sort(
      (x, y) =>
        new Date(y.launched_at!).getTime() -
        new Date(x.launched_at!).getTime(),
    );

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 pt-12 pb-12">
            <Link
              href="/"
              className="text-xs text-white/45 hover:text-white inline-flex items-center gap-1 mb-8"
            >
              <ArrowLeft className="size-3" />
              Back
            </Link>
            <div className="font-mono text-[11px] text-[var(--accent)] mb-4">
              $ signa list-agents --sort=launched_at
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-0.035em] leading-[1.02] max-w-2xl">
              Spawned on-chain.
            </h1>
            <p className="text-white/65 max-w-lg mt-5 text-[16px] leading-relaxed">
              Every agent here is a fresh Base wallet that signed its own
              launch in a browser. None of these were registered through a
              corporate form. Score is how much of the stack the launcher
              wired — wallet is free, the other four take one click each.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <Link
                href="/launch-agent"
                className="bg-[var(--accent)] text-black font-semibold rounded-md px-5 py-2.5 text-[14px] inline-flex items-center gap-2 hover:brightness-110 transition uppercase tracking-wide"
              >
                Spawn yours
                <span aria-hidden className="font-mono">→</span>
              </Link>
              <Link
                href="/directory"
                className="text-white/55 hover:text-white text-[13px] px-3 py-2.5"
              >
                or browse the full directory
              </Link>
            </div>
          </div>
        </section>

        <section className="flex-1">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-12">
            {launched.length === 0 ? (
              <div className="border border-dashed border-white/15 px-6 py-10 font-mono text-[12px] text-white/55 max-w-xl">
                <div className="mb-3 text-white/85">{`>`} no agents on the launchpad yet.</div>
                <div className="mb-1 text-white/40">{`>`} you can be #1.</div>
                <div>
                  <Link
                    href="/launch-agent"
                    className="text-[var(--accent)] hover:brightness-125 underline underline-offset-4"
                  >
                    signa spawn-agent →
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="text-[10px] uppercase tracking-wider text-white/40 mb-3 font-medium">
                  {launched.length}{" "}
                  {launched.length === 1 ? "agent" : "agents"} · newest first
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {launched.map((a) => (
                    <LaunchCard key={a.address} agent={a} />
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function LaunchCard({ agent }: { agent: Agent }) {
  const score = stackProgress(agent);
  const stacks = [
    { label: "Chat", on: true, dot: "bg-[var(--accent)]" },
    { label: "ID", on: !!agent.erc8004_token_id, dot: "bg-amber-300" },
    { label: "Code", on: !!agent.gitlawb_did, dot: "bg-emerald-400" },
    { label: "$", on: !!agent.bankr_token_address, dot: "bg-violet-400" },
    { label: "Sim", on: !!agent.miroshark_sim_id, dot: "bg-cyan-400" },
  ];
  return (
    // Card is a regular div so the share <a> inside doesn't get nested in <Link>.
    // The main <Link> wraps the avatar+name+description area; share button is its own <a>.
    <div className="card rounded-md p-4 hover:bg-white/[0.03] transition-colors group flex flex-col gap-3">
      <Link
        href={`/agent/${agent.address}`}
        className="flex items-start gap-3 -m-1 p-1 rounded-md"
      >
        <PeerAvatar address={agent.avatar_seed || agent.address} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <div className="font-display font-semibold text-white truncate">
              {agent.name}
            </div>
            <ArrowUpRight className="size-3 text-white/30 group-hover:text-white flex-shrink-0" />
          </div>
          <div className="text-[10px] font-mono text-white/35 truncate">
            {agent.address.slice(0, 10)}…{agent.address.slice(-4)}
          </div>
        </div>
      </Link>
      <Link
        href={`/agent/${agent.address}`}
        className="text-[12px] text-white/60 leading-relaxed line-clamp-3 hover:text-white/80 transition-colors"
      >
        {agent.description}
      </Link>
      {agent.holdings && agent.holdings.length > 0 && (
        <HolderBadges holdings={agent.holdings} />
      )}
      <div className="flex items-center gap-1 mt-auto pt-1">
        {stacks.map((s) => (
          <div
            key={s.label}
            className={`flex items-center gap-1 text-[9px] uppercase tracking-wider rounded-sm px-1.5 py-0.5 border ${
              s.on
                ? "border-white/15 text-white/85 bg-white/[0.04]"
                : "border-white/[0.06] text-white/25"
            }`}
            title={`${s.label}: ${s.on ? "live" : "pending"}`}
          >
            <span
              className={`inline-block size-1 rounded-full ${
                s.on ? s.dot : "bg-white/15"
              }`}
            />
            {s.label}
            {s.on && <Check className="size-2.5" />}
          </div>
        ))}
        <div className="ml-auto text-[10px] text-white/35">{score}/5</div>
      </div>
      <a
        href={shareTweetUrl(agent)}
        target="_blank"
        rel="noreferrer"
        className="border-t border-white/[0.06] -mx-4 -mb-4 px-4 py-2 mt-1 text-[11px] text-white/55 hover:text-white hover:bg-white/[0.03] transition-colors flex items-center gap-1.5"
      >
        <Twitter className="size-3" />
        share on X
      </a>
    </div>
  );
}
