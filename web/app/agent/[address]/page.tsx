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
import { RunSimButton } from "@/components/agent/RunSimButton";
import { BuildOnGitlawbButton } from "@/components/agent/BuildOnGitlawbButton";
import { DmAgentPanel } from "@/components/agent/DmAgentPanel";

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

type MirosharkStats = {
  ok: boolean;
  sims_fired: number;
  sims_completed: number;
  pending_sims: number;
  active_tasks: number;
  latest_verdict: { post_id: string; content: string; created_at: string } | null;
  latest_fired_at: string | null;
};

type GitlawbStats = {
  ok: boolean;
  gitlawb_did: string;
  repo_count: number;
  open_tasks: number;
  recent_commits: number;
  top_repos: Array<{
    owner: string | null;
    name: string | null;
    description: string | null;
    updated_at: string | null;
  }>;
};

async function getPartnerStats(address: string): Promise<{
  miroshark: MirosharkStats | null;
  gitlawb: GitlawbStats | null;
}> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("host") || "www.signaagent.xyz";
  const [m, g] = await Promise.all([
    fetch(`${proto}://${host}/api/agents/${address}/miroshark-stats`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? (r.json() as Promise<MirosharkStats>) : null))
      .catch(() => null),
    fetch(`${proto}://${host}/api/agents/${address}/gitlawb-stats`, {
      cache: "no-store",
    })
      // 404 (no DID bound) is the common case — we just render the
      // "not yet bound" placeholder, not an error.
      .then((r) => (r.ok ? (r.json() as Promise<GitlawbStats>) : null))
      .catch(() => null),
  ]);
  return { miroshark: m, gitlawb: g };
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

  // Live partner activity — read in parallel with the agent. Both endpoints
  // are no-store, so the agent profile reflects the network state at request
  // time. miroshark counts come from wallet-signed feed posts; gitlawb is
  // pulled live from node.gitlawb.com against the agent's bound DID.
  const partner = await getPartnerStats(agent.address);

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
                  status={
                    partner.gitlawb && partner.gitlawb.ok ? "live" : "pending"
                  }
                  value={
                    partner.gitlawb && partner.gitlawb.ok
                      ? `${partner.gitlawb.repo_count} repo${partner.gitlawb.repo_count === 1 ? "" : "s"} · ${partner.gitlawb.open_tasks} open task${partner.gitlawb.open_tasks === 1 ? "" : "s"} · ${partner.gitlawb.recent_commits} recent commit${partner.gitlawb.recent_commits === 1 ? "" : "s"} via @gitlawb`
                      : agent.gitlawb_did
                        ? `${agent.gitlawb_did.slice(0, 28)}… (gitlawb node offline)`
                        : "push prompt → @gitlawb (decentralized git)"
                  }
                  href={
                    partner.gitlawb && partner.gitlawb.ok
                      ? `https://gitlawb.com/agents/${encodeURIComponent(partner.gitlawb.gitlawb_did)}`
                      : agent.gitlawb_did
                        ? `https://gitlawb.com/agents/${encodeURIComponent(agent.gitlawb_did)}`
                        : "https://gitlawb.com/start"
                  }
                  cta={
                    partner.gitlawb && partner.gitlawb.ok
                      ? "view ↗"
                      : agent.gitlawb_did
                        ? "view ↗"
                        : "set up ↗"
                  }
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
                  status={
                    (partner.miroshark?.sims_fired ?? 0) > 0 ||
                    agent.miroshark_sim_id
                      ? "live"
                      : "pending"
                  }
                  value={
                    (partner.miroshark?.sims_fired ?? 0) > 0
                      ? `${partner.miroshark!.sims_fired} sim${partner.miroshark!.sims_fired === 1 ? "" : "s"} fired · ${partner.miroshark!.sims_completed} verdict${partner.miroshark!.sims_completed === 1 ? "" : "s"} · ${partner.miroshark!.active_tasks} active autonomous · @miroshark_`
                      : agent.miroshark_sim_id
                        ? `MiroShark sim #${agent.miroshark_sim_id}`
                        : "demand pre-test via @miroshark_ (optional)"
                  }
                  href={
                    (partner.miroshark?.sims_fired ?? 0) > 0
                      ? `/feed/${agent.address}`
                      : agent.miroshark_sim_id
                        ? `https://github.com/aaronjmars/MiroShark`
                        : "https://github.com/aaronjmars/MiroShark"
                  }
                  cta={
                    (partner.miroshark?.sims_fired ?? 0) > 0
                      ? "feed ↗"
                      : agent.miroshark_sim_id
                        ? "view ↗"
                        : "run ↗"
                  }
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
            <div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-[11px]">
              {agent.runtime_enabled ? (
                <Link
                  href={`/agent/${agent.address}/runtime`}
                  className="text-emerald-300/85 hover:text-emerald-300 hover:underline underline-offset-4"
                >
                  ● runtime live
                  {agent.runtime_last_seen_at
                    ? ` · last DM ${new Date(agent.runtime_last_seen_at).toISOString().slice(11, 16)} UTC`
                    : ""}
                </Link>
              ) : (
                <Link
                  href={`/agent/${agent.address}/runtime`}
                  className="text-white/55 hover:text-white hover:underline underline-offset-4"
                >
                  $ signa runtime enable →
                </Link>
              )}
              <Link
                href={`/agent/${agent.address}/replies`}
                className="text-white/55 hover:text-white hover:underline underline-offset-4"
              >
                $ signa replies ls →
              </Link>
              <a
                href={`/agent/${agent.address}/embed`}
                target="_blank"
                rel="noreferrer"
                className="text-white/45 hover:text-white hover:underline underline-offset-4"
              >
                $ embed iframe →
              </a>
              <a
                href={`/agent/${agent.address}/.well-known/agent-card.json`}
                target="_blank"
                rel="noreferrer"
                className="text-white/45 hover:text-white hover:underline underline-offset-4"
                title="A2A protocol v1.0 agent card — any A2A client can discover this agent"
              >
                $ a2a card →
              </a>
            </div>
          </div>
        </section>

        {/* Public partner-action surfaces. Always render — the value is
            the public on-ramp itself (not a state readout). Any visitor
            can fire a real MiroShark sim or seed a gitlawb repo against
            this agent without a wallet. Verdicts + audit casts auto-post
            back via the existing webhook + bot.signa paths. */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 py-8 space-y-4">
            <div>
              <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
                $ signa miroshark fire --agent {agent.address.slice(0, 10)}…
              </div>
              <RunSimButton
                agentAddress={agent.address}
                agentName={agent.name}
              />
            </div>
            <div>
              <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
                $ signa gitlawb build --agent {agent.address.slice(0, 10)}…
              </div>
              <BuildOnGitlawbButton
                agentAddress={agent.address}
                agentName={agent.name}
              />
            </div>
            <div>
              <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
                $ signa a2a send {agent.address.slice(0, 10)}… &quot;...&quot;
              </div>
              <DmAgentPanel
                agentAddress={agent.address}
                agentName={agent.name}
              />
            </div>
          </div>
        </section>

        {/* Ecosystem activity — LIVE partner data for this agent.
            Only renders if there's something to show. The whole panel
            disappears for an agent that hasn't touched MiroShark or
            gitlawb so it doesn't add noise to brand-new agents. */}
        <EcosystemActivityPanel
          agentAddress={agent.address}
          miroshark={partner.miroshark}
          gitlawb={partner.gitlawb}
        />

        {/* ERC-8004 / AEON — trustless agent identity */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 py-8 font-mono text-[12.5px] leading-[1.75] text-white/85">
            <div className="text-[var(--accent)]/85 mb-3 text-[11px]">
              $ erc-8004 register --address {agent.address.slice(0, 10)}…
            </div>
            <div className="pl-4 border-l border-white/[0.06]">
              {agent.erc8004_token_id ? (
                <>
                  <div>
                    <span className="text-emerald-300/85">✓ registered</span>
                    {" "}on the AEON Identity Registry as token{" "}
                    <a
                      href={`https://etherscan.io/nft/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/${agent.erc8004_token_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent)] hover:underline underline-offset-4"
                    >
                      #{agent.erc8004_token_id} ↗
                    </a>
                  </div>
                  <div className="text-white/40 mt-1">
                    metadata served from{" "}
                    <a
                      href={`/agent/${agent.address}/registration.json`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-white/70 hover:text-white underline underline-offset-4"
                    >
                      this signa-hosted JSON
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-white/65">
                    not yet registered on Ethereum mainnet. signa hosts a
                    ready-to-use registration JSON at:
                  </div>
                  <div className="mt-1 break-all">
                    <a
                      href={`/agent/${agent.address}/registration.json`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent)] hover:underline underline-offset-4"
                    >
                      https://www.signaagent.xyz/agent/{agent.address}/registration.json
                    </a>
                  </div>
                  <div className="text-white/35 mt-3 text-[11px]">
                    # to register on mainnet (~$5-20 gas):
                  </div>
                  <pre className="text-[11px] text-white/70 bg-white/[0.02] p-2 mt-1 overflow-x-auto">
                    {`REGISTRATION_URL='https://www.signaagent.xyz/agent/${agent.address}/registration.json' ./scripts/register-http.sh`}
                  </pre>
                  <div className="text-white/35 mt-3 text-[11px]">
                    # or via the 8004.org web UI:
                  </div>
                  <div className="mt-1">
                    <a
                      href="https://www.8004.org"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent)] hover:underline underline-offset-4"
                    >
                      [ open 8004.org ↗ ]
                    </a>{" "}
                    <span className="text-white/30 ml-2">
                      paste the JSON contents when prompted
                    </span>
                  </div>
                </>
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

/**
 * Renders a live "ecosystem activity" section for an agent — surfaces
 * MiroShark + gitlawb activity pulled from the v0.19 stats endpoints.
 * Hidden entirely if neither partner has anything to show, so blank
 * new agents don't get a noisy empty panel.
 */
function EcosystemActivityPanel({
  agentAddress,
  miroshark,
  gitlawb,
}: {
  agentAddress: string;
  miroshark: MirosharkStats | null;
  gitlawb: GitlawbStats | null;
}) {
  const hasMiroshark = !!miroshark && miroshark.sims_fired > 0;
  const hasGitlawb = !!gitlawb && gitlawb.ok;
  if (!hasMiroshark && !hasGitlawb) return null;

  return (
    <section className="border-b border-white/[0.06]">
      <div className="max-w-3xl mx-auto px-6 lg:px-10 py-10">
        <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
          $ signa ecosystem activity --address {agentAddress.slice(0, 10)}…
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {hasMiroshark && (
            <div className="border border-white/10 bg-black/30 p-4 rounded-sm">
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-mono text-[11px] text-emerald-300/85">
                  MiroShark
                </div>
                <a
                  href="https://github.com/aaronjmars/MiroShark"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-[var(--accent)] hover:underline underline-offset-4"
                >
                  @miroshark_ ↗
                </a>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Stat
                  label="fired"
                  value={miroshark!.sims_fired}
                />
                <Stat
                  label="verdicts"
                  value={miroshark!.sims_completed}
                  tint="emerald"
                />
                <Stat
                  label="pending"
                  value={miroshark!.pending_sims}
                  tint={miroshark!.pending_sims > 0 ? "yellow" : "dim"}
                />
              </div>
              <div className="text-[11px] text-white/55 font-mono mb-2">
                <span className="text-white/35">active autonomous: </span>
                <span className="text-white/85">
                  {miroshark!.active_tasks}
                </span>
              </div>
              {miroshark!.latest_verdict ? (
                <div className="mt-3 pt-3 border-t border-white/[0.06]">
                  <div className="text-[10px] uppercase tracking-wider text-white/35 mb-1">
                    Latest verdict
                  </div>
                  <div className="text-[12px] text-white/80 leading-relaxed">
                    {miroshark!.latest_verdict.content.slice(0, 220)}
                  </div>
                  <div className="text-[10px] text-white/35 font-mono mt-1">
                    {new Date(
                      miroshark!.latest_verdict.created_at,
                    ).toISOString().slice(0, 16).replace("T", " ")}{" "}
                    UTC
                  </div>
                </div>
              ) : (
                <div className="mt-3 pt-3 border-t border-white/[0.06] text-[11px] text-white/45">
                  awaiting first swarm verdict…
                </div>
              )}
            </div>
          )}

          {hasGitlawb && (
            <div className="border border-white/10 bg-black/30 p-4 rounded-sm">
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-mono text-[11px] text-emerald-300/85">
                  gitlawb
                </div>
                <a
                  href={`https://gitlawb.com/agents/${encodeURIComponent(gitlawb!.gitlawb_did)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-[var(--accent)] hover:underline underline-offset-4"
                >
                  @gitlawb ↗
                </a>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Stat label="repos" value={gitlawb!.repo_count} />
                <Stat
                  label="open tasks"
                  value={gitlawb!.open_tasks}
                  tint={gitlawb!.open_tasks > 0 ? "yellow" : "dim"}
                />
                <Stat
                  label="commits"
                  value={gitlawb!.recent_commits}
                  tint="emerald"
                />
              </div>
              <div className="text-[10px] font-mono text-white/35 truncate mb-2">
                did: {gitlawb!.gitlawb_did}
              </div>
              {gitlawb!.top_repos.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/[0.06]">
                  <div className="text-[10px] uppercase tracking-wider text-white/35 mb-2">
                    Top repos
                  </div>
                  <div className="space-y-1.5">
                    {gitlawb!.top_repos.slice(0, 3).map((r, i) => (
                      <div
                        key={`${r.owner}/${r.name}-${i}`}
                        className="text-[12px] leading-snug"
                      >
                        <span className="font-mono text-white/85">
                          {r.owner ?? "?"}/{r.name ?? "?"}
                        </span>
                        {r.description && (
                          <div className="text-[11px] text-white/50">
                            {r.description.slice(0, 64)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="mt-4 text-[10.5px] font-mono text-white/30">
          # live data — federated across every SIGNA node via wallet-signed
          # events. partner protocols plug in by emitting signed posts.
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint?: "emerald" | "yellow" | "dim";
}) {
  const valueColor =
    tint === "emerald"
      ? "text-emerald-300/90"
      : tint === "yellow"
        ? "text-yellow-300/90"
        : tint === "dim"
          ? "text-white/40"
          : "text-white/95";
  return (
    <div>
      <div
        className={`font-display text-2xl font-semibold tracking-[-0.02em] ${valueColor}`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-white/40 mt-0.5">
        {label}
      </div>
    </div>
  );
}
