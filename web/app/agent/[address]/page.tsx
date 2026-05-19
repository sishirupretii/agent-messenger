import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MessageCircle,
  Twitter,
} from "lucide-react";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { PeerAvatar } from "@/components/ui/Avatar";
import { HolderBadges } from "@/components/ui/HolderBadges";
import { shortAddress } from "@/lib/format";
import { headers } from "next/headers";
import { getHolderStatus } from "@/lib/holder-status";
import { AgentRespondWidget } from "@/components/agent/AgentRespondWidget";

export const dynamic = "force-dynamic";

type Agent = {
  address: string;
  name: string;
  description: string;
  tags: string[] | null;
  verified: boolean;
  submitted_at: string;
  system_prompt: string | null;
  avatar_seed: string | null;
  launched_at: string | null;
  launched_by: string | null;
  gitlawb_did: string | null;
  erc8004_token_id: string | null;
  bankr_token_address: string | null;
  miroshark_sim_id: string | null;
  runtime_enabled?: boolean;
  runtime_enabled_at?: string | null;
  runtime_last_seen_at?: string | null;
  encrypted_key?: string | null;
};

async function getAgent(address: string): Promise<Agent | null> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("host") || "www.signaagent.xyz";
  const url = `${proto}://${host}/api/agents/${address}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j.agent ?? null;
  } catch {
    return null;
  }
}

/** Compose a viral share-tweet URL pre-filled for this agent. */
function shareTweetUrl(agent: Agent): string {
  const url = `https://www.signaagent.xyz/agent/${agent.address}`;
  const text =
    `just spawned ${agent.name} on @signa_agent — wallet-native AI agent on @base.\n\n` +
    `wallet + XMTP DM + one-click tokenize via @bankrbot.\n\n` +
    url;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) notFound();

  const agent = await getAgent(address);
  if (!agent) notFound();

  const launched = !!agent.launched_at;

  // Live on-chain read of the agent wallet's partner-token + USDC holdings.
  // Cached 5 min in-process by getHolderStatus.
  let holdings: { symbol: string; project: string | null; amount: string }[] = [];
  try {
    const status = await getHolderStatus(agent.address);
    holdings = status.holdings;
  } catch {
    // best-effort; chip just doesn't render on RPC failure
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-12 pb-10">
            <Link
              href="/launchpad"
              className="text-xs text-white/45 hover:text-white inline-flex items-center gap-1 mb-8"
            >
              <ArrowLeft className="size-3" />
              ../launchpad
            </Link>

            <div className="flex items-start gap-4">
              <PeerAvatar
                address={agent.avatar_seed || agent.address}
                size={64}
              />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] text-[var(--accent)] mb-1 flex items-center gap-1.5">
                  {launched ? (
                    <>
                      <span className="size-1.5 rounded-full bg-[var(--accent)]" />
                      $ signa agent ls --address {agent.address.slice(0, 10)}…
                    </>
                  ) : (
                    <span>agent</span>
                  )}
                </div>
                <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-[-0.035em] leading-tight">
                  {agent.name}
                </h1>
                <div className="text-[11px] font-mono text-white/40 mt-1 break-all">
                  {shortAddress(agent.address, 10, 8)}
                </div>
                <p className="text-white/65 mt-4 text-[15px] leading-relaxed max-w-2xl">
                  {agent.description}
                </p>
                {holdings.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">
                      Holds
                    </div>
                    <HolderBadges holdings={holdings} showAmount />
                  </div>
                )}
                {agent.tags && agent.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-4">
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
              <div className="flex flex-col gap-2 flex-shrink-0">
                <Link
                  href={`/?to=${agent.address}`}
                  className="bg-[var(--accent)] text-black text-sm font-semibold rounded-md px-3.5 py-2 inline-flex items-center gap-1.5 hover:brightness-110 transition uppercase tracking-wide"
                >
                  <MessageCircle className="size-3.5" />
                  DM
                </Link>
                {agent.bankr_token_address ? (
                  <Link
                    href={`/tokens/${agent.bankr_token_address}`}
                    className="border border-violet-400/40 text-violet-200 text-sm font-semibold rounded-md px-3.5 py-2 inline-flex items-center gap-1.5 hover:bg-violet-400/[0.06] transition uppercase tracking-wide"
                    title="Open this agent's token page on SIGNA"
                  >
                    Trade
                  </Link>
                ) : (
                  <a
                    href={`https://bankr.bot/agents/${agent.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="border border-violet-400/30 text-violet-300/80 text-sm rounded-md px-3.5 py-2 inline-flex items-center gap-1.5 hover:bg-violet-400/[0.04] transition"
                    title="Tokenize on Bankr"
                  >
                    Tokenize
                  </a>
                )}
                <a
                  href={shareTweetUrl(agent)}
                  target="_blank"
                  rel="noreferrer"
                  className="border border-white/15 text-white text-sm rounded-md px-3.5 py-2 inline-flex items-center gap-1.5 hover:bg-white/[0.04] transition"
                >
                  <Twitter className="size-3.5" />
                  Share
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Stack as terminal block, not card grid */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 py-10">
            <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
              $ signa stack ls
            </div>
            <div className="border border-white/10 bg-black/30 font-mono text-[12px] leading-[1.85]">
              <div className="px-3 py-1.5 border-b border-white/10 flex items-center justify-between">
                <span className="text-white/40 text-[10px] uppercase tracking-wider">
                  stack.toml
                </span>
                <span className="text-white/30 text-[10px]">
                  {agent.address.slice(0, 6)}…{agent.address.slice(-4)}
                </span>
              </div>
              <div className="px-3 py-2 space-y-0.5">
                <StackLine
                  slot="dm"
                  status="live"
                  value="XMTP V3 · MLS · e2e encrypted"
                  href={`/?to=${agent.address}`}
                  cta="open"
                />
                <StackLine
                  slot="token"
                  status={agent.bankr_token_address ? "live" : "pending"}
                  value={
                    agent.bankr_token_address
                      ? `via @bankrbot · ${shortAddress(agent.bankr_token_address)}`
                      : "tokenize via @bankrbot — one click"
                  }
                  href={
                    agent.bankr_token_address
                      ? `https://bankr.bot/agents/${agent.bankr_token_address}`
                      : `https://bankr.bot/agents/${agent.address}`
                  }
                  cta={
                    agent.bankr_token_address ? "trade ↗" : "tokenize ↗"
                  }
                />
                <StackLine
                  slot="code"
                  status={agent.gitlawb_did ? "live" : "pending"}
                  value={
                    agent.gitlawb_did
                      ? `${agent.gitlawb_did.slice(0, 28)}…`
                      : "push prompt → @gitlawb (decentralized git)"
                  }
                  href={
                    agent.gitlawb_did
                      ? `https://gitlawb.com/agents/${encodeURIComponent(agent.gitlawb_did)}`
                      : "https://gitlawb.com/start"
                  }
                  cta={agent.gitlawb_did ? "view ↗" : "set up ↗"}
                />
                <StackLine
                  slot="id"
                  status={agent.erc8004_token_id ? "live" : "pending"}
                  value={
                    agent.erc8004_token_id
                      ? `ERC-8004 #${agent.erc8004_token_id}`
                      : "ERC-8004 · trustless agent identity (roadmap)"
                  }
                  href={
                    agent.erc8004_token_id
                      ? `https://basescan.org/address/${agent.address}`
                      : "https://eips.ethereum.org/EIPS/eip-8004"
                  }
                  cta={agent.erc8004_token_id ? "on-chain ↗" : "read EIP ↗"}
                />
                <StackLine
                  slot="sim"
                  status={agent.miroshark_sim_id ? "live" : "pending"}
                  value={
                    agent.miroshark_sim_id
                      ? `MiroShark sim #${agent.miroshark_sim_id}`
                      : "demand pre-test via @miroshark_ (optional)"
                  }
                  href={
                    agent.miroshark_sim_id
                      ? `https://github.com/aaronjmars/MiroShark`
                      : "https://github.com/aaronjmars/MiroShark"
                  }
                  cta={agent.miroshark_sim_id ? "view ↗" : "run ↗"}
                />
              </div>
            </div>

            {agent.launched_by && (
              <div className="mt-6 font-mono text-[11px] text-white/40">
                <span className="text-white/30">launched_by</span>{" "}
                <Link
                  href={`/feed/${agent.launched_by}`}
                  className="text-white/70 hover:text-white underline underline-offset-4"
                >
                  {shortAddress(agent.launched_by)}
                </Link>
                {agent.launched_at && (
                  <span className="text-white/30">
                    {" "}
                    @ {new Date(agent.launched_at).toISOString().slice(0, 10)}
                  </span>
                )}
              </div>
            )}

            {/* Runtime status row */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {agent.runtime_enabled ? (
                <Link
                  href={`/agent/${agent.address}/runtime`}
                  className="inline-flex items-center gap-1.5 border border-emerald-300/30 bg-emerald-300/[0.04] px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-300/[0.08] transition rounded-sm"
                >
                  <span className="size-1 rounded-full bg-emerald-300 animate-pulse" />
                  runtime live{agent.runtime_last_seen_at ? ` · last DM ${new Date(agent.runtime_last_seen_at).toISOString().slice(11, 16)} UTC` : ""}
                </Link>
              ) : (
                <Link
                  href={`/agent/${agent.address}/runtime`}
                  className="inline-flex items-center gap-1.5 border border-white/15 px-2 py-1 text-[11px] text-white/55 hover:text-white hover:bg-white/[0.04] transition rounded-sm font-mono"
                >
                  $ signa runtime enable →
                </Link>
              )}
            </div>
          </div>
        </section>

        <AgentRespondWidget address={agent.address} agentName={agent.name} />

        {agent.system_prompt && (
          <section className="border-b border-white/[0.06]">
            <div className="max-w-3xl mx-auto px-6 lg:px-10 py-10">
              <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
                $ cat system_prompt.txt
              </div>
              <pre className="border border-white/10 bg-black/30 p-4 text-[12px] text-white/80 font-mono whitespace-pre-wrap leading-relaxed">
                {agent.system_prompt}
              </pre>
              <p className="text-[11px] text-white/35 mt-2 font-mono">
                # the launch tx commits to sha256(prompt). edits invalidate the hash.
              </p>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}

function StackLine({
  slot,
  status,
  value,
  href,
  cta,
}: {
  slot: string;
  status: "live" | "pending";
  value: string;
  href: string;
  cta: string;
}) {
  const live = status === "live";
  return (
    <div className="grid grid-cols-[58px_1fr_auto] gap-3 items-baseline group">
      <span className="text-[var(--accent)]">{slot.padEnd(6, " ")}</span>
      <span className="text-white/80 truncate">
        <span
          className={
            live
              ? "text-emerald-300/90 mr-2"
              : "text-white/30 mr-2"
          }
        >
          {live ? "[live]" : "[pending]"}
        </span>
        {value}
      </span>
      <a
        href={href}
        target={href.startsWith("http") ? "_blank" : undefined}
        rel="noreferrer"
        className="text-[var(--accent)] hover:brightness-125 underline underline-offset-4 opacity-70 group-hover:opacity-100 transition"
      >
        {cta}
      </a>
    </div>
  );
}
