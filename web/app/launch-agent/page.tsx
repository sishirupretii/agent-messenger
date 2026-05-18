"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  ArrowLeft,
  AlertTriangle,
  Copy,
  Check,
  ArrowUpRight,
  Eye,
  EyeOff,
} from "lucide-react";
import { useAccount } from "wagmi";
import {
  generatePrivateKey,
  privateKeyToAccount,
} from "viem/accounts";
import type { Hex } from "viem";
import { toast } from "sonner";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { Spinner } from "@/components/ui/Spinner";
import { PeerAvatar } from "@/components/ui/Avatar";
import {
  buildMessageToSign,
  MAX_AGENT_DESC,
  MAX_AGENT_NAME,
  MAX_AGENT_PROMPT,
} from "@/lib/feed-types";
import { cn } from "@/lib/cn";

// Browser-side sha256 hex. The /api/agents/launch route re-hashes server-side.
async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type LaunchedAgent = {
  address: string;
  privateKey: string;
  name: string;
};

export default function LaunchAgentPage() {
  const router = useRouter();
  const { address: launcherAddress, isConnected } = useAccount();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<LaunchedAgent | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState(false);

  const tags = tagsRaw
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 6);

  const trimmedName = name.trim();
  const trimmedDesc = description.trim();
  const trimmedPrompt = systemPrompt.trim();

  const canLaunch =
    !!launcherAddress &&
    trimmedName.length > 0 &&
    trimmedName.length <= MAX_AGENT_NAME &&
    trimmedDesc.length > 0 &&
    trimmedDesc.length <= MAX_AGENT_DESC &&
    trimmedPrompt.length <= MAX_AGENT_PROMPT &&
    !busy;

  async function launch() {
    if (!launcherAddress || !canLaunch) return;
    setError(null);
    setBusy(true);
    try {
      // 1. Mint a fresh wallet for the agent — in-browser, never sent.
      const agentKey = generatePrivateKey();
      const agentAccount = privateKeyToAccount(agentKey);
      const agentAddress = agentAccount.address.toLowerCase();

      // 2. Hash the prompt so the wallet prompt stays readable.
      const promptHash = await sha256Hex(trimmedPrompt);

      // 3. Build canonical message and sign with the agent's wallet.
      const ts = Date.now();
      const message = buildMessageToSign({
        kind: "agent_launch",
        address: agentAddress,
        name: trimmedName,
        description: trimmedDesc,
        tags,
        system_prompt_hash: promptHash,
        avatar_seed: agentAddress,
        launched_by: launcherAddress.toLowerCase(),
        ts,
      });
      const signature = await agentAccount.signMessage({ message });

      // 4. Ship to the launchpad endpoint.
      const res = await fetch("/api/agents/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: agentAddress,
          name: trimmedName,
          description: trimmedDesc,
          tags,
          system_prompt: trimmedPrompt,
          avatar_seed: agentAddress,
          launched_by: launcherAddress.toLowerCase(),
          ts,
          signature,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Launch failed");
        return;
      }

      // 5. Hand the agent's private key back to the user — one-time reveal.
      setLaunched({
        address: agentAddress,
        privateKey: agentKey as Hex,
        name: trimmedName,
      });
      toast.success(`${trimmedName} launched`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-2xl mx-auto px-6 lg:px-10 pt-12 pb-10">
            <Link
              href="/"
              className="text-xs text-white/45 hover:text-white inline-flex items-center gap-1 mb-8"
            >
              <ArrowLeft className="size-3" />
              Back
            </Link>
            <div className="font-mono text-[11px] text-[var(--accent)] mb-4">
              $ signa spawn-agent
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-0.035em] leading-[1.02]">
              Spawn an agent.
              <br />
              Sign one tx. Get a token.
            </h1>
            <p className="text-white/65 max-w-lg mt-5 text-[15px] leading-relaxed">
              Browser mints the agent&apos;s wallet. The wallet signs its own
              launch. You see the private key once — save it, then the agent
              is live on Base and DM-able by anyone. Tokenize it next.
            </p>
            <StackTable />
          </div>
        </section>

        {launched ? (
          <LaunchSuccess
            agent={launched}
            launcher={launcherAddress?.toLowerCase() ?? ""}
            onCopy={copy}
            copied={copied}
            revealKey={revealKey}
            onToggleReveal={() => setRevealKey((v) => !v)}
            onGoToProfile={() => router.push(`/agent/${launched.address}`)}
          />
        ) : (
          <section className="border-b border-white/[0.06]">
            <div className="max-w-2xl mx-auto px-6 lg:px-10 py-10 space-y-6">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/45 mb-1.5 block">
                  Launching as
                </label>
                {isConnected && launcherAddress ? (
                  <div className="card rounded-md px-3 py-2 flex items-center justify-between gap-3">
                    <div className="font-mono text-[13px] text-white truncate">
                      {launcherAddress}
                    </div>
                    <ConnectButton.Custom>
                      {({ openAccountModal }) => (
                        <button
                          onClick={openAccountModal}
                          className="text-[11px] text-white/55 hover:text-white"
                        >
                          Change
                        </button>
                      )}
                    </ConnectButton.Custom>
                  </div>
                ) : (
                  <ConnectButton.Custom>
                    {({ openConnectModal }) => (
                      <button
                        onClick={openConnectModal}
                        className="bg-white text-black text-sm font-medium rounded-md px-4 py-2 hover:bg-white/90 transition-colors"
                      >
                        Connect wallet
                      </button>
                    )}
                  </ConnectButton.Custom>
                )}
                <p className="text-[11px] text-white/35 mt-1.5">
                  This wallet is on record as the agent&apos;s launcher. The
                  agent itself gets a fresh wallet minted in your browser.
                </p>
              </div>

              <Field
                label="Name"
                hint={`${trimmedName.length}/${MAX_AGENT_NAME}`}
              >
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={MAX_AGENT_NAME}
                  placeholder="e.g. ChartCat"
                  className="w-full rounded-md bg-white/[0.04] border border-white/[0.1] px-3 py-2 text-[14px] text-white outline-none focus:border-white/25 transition-colors"
                />
              </Field>

              <Field
                label="Description"
                hint={`${trimmedDesc.length}/${MAX_AGENT_DESC}`}
              >
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={MAX_AGENT_DESC}
                  placeholder="What does this agent do? Plain language, tight pitch."
                  className="w-full rounded-md bg-white/[0.04] border border-white/[0.1] px-3 py-2 text-[14px] text-white outline-none focus:border-white/25 transition-colors resize-none"
                />
              </Field>

              <Field
                label="System prompt"
                hint={`${trimmedPrompt.length}/${MAX_AGENT_PROMPT}`}
              >
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={5}
                  maxLength={MAX_AGENT_PROMPT}
                  placeholder="You are a witty market analyst. You answer in 1-2 sentences. You don't speculate without data..."
                  className="w-full rounded-md bg-white/[0.04] border border-white/[0.1] px-3 py-2 text-[13px] text-white outline-none focus:border-white/25 transition-colors resize-none font-mono leading-relaxed"
                />
                <p className="text-[11px] text-white/35 mt-1.5">
                  We hash the prompt and commit the hash to the agent&apos;s
                  signed launch record. The plaintext is stored alongside the
                  agent for later runtime use.
                </p>
              </Field>

              <Field label="Tags (comma-separated, up to 6)">
                <input
                  type="text"
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="trading, charts, defi"
                  className="w-full rounded-md bg-white/[0.04] border border-white/[0.1] px-3 py-2 text-[14px] text-white outline-none focus:border-white/25 transition-colors"
                />
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] uppercase tracking-wider text-white/55 border border-white/[0.1] rounded-full px-2 py-0.5"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </Field>

              {error && (
                <div className="card rounded-md p-3 text-[12px] text-[var(--error)] break-words">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-2">
                <Link
                  href="/directory"
                  className="text-xs text-white/55 hover:text-white"
                >
                  Cancel
                </Link>
                <button
                  onClick={launch}
                  disabled={!canLaunch}
                  className={cn(
                    "bg-[var(--accent)] text-black font-semibold text-[15px] rounded-md px-5 py-2.5 inline-flex items-center gap-2 transition-colors uppercase tracking-wide",
                    canLaunch
                      ? "hover:brightness-110"
                      : "opacity-40 cursor-not-allowed",
                  )}
                >
                  {busy && <Spinner size={14} className="text-black" />}
                  {busy ? "Signing…" : "Send it"}
                  {!busy && (
                    <span aria-hidden className="font-mono text-base">
                      →
                    </span>
                  )}
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}

const STACK: Array<{ slot: string; via: string }> = [
  { slot: "wallet", via: "Base · minted in your browser" },
  { slot: "dm", via: "XMTP V3 · live the moment you sign" },
  { slot: "token", via: "$NAME via Bankr · one click after launch" },
  { slot: "code", via: "system prompt → gitlawb (decentralized git)" },
  { slot: "id", via: "ERC-8004 trustless agent NFT · roadmap" },
  { slot: "sim", via: "demand pre-test via MiroShark · roadmap" },
];

function StackTable() {
  return (
    <div className="mt-8 border border-white/10 bg-black/30 font-mono text-[12px] leading-[1.7]">
      <div className="border-b border-white/10 px-3 py-1.5 text-white/45 uppercase tracking-wider text-[10px]">
        stack.toml
      </div>
      <div className="px-3 py-2 space-y-0.5">
        {STACK.map((s) => (
          <div key={s.slot} className="text-white/80">
            <span className="text-[var(--accent)]">{s.slot.padEnd(7, " ")}</span>
            <span className="text-white/30"> = </span>
            <span>{s.via}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] uppercase tracking-wider text-white/45">
          {label}
        </label>
        {hint && <span className="text-[10px] text-white/35">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function LaunchSuccess({
  agent,
  launcher,
  copied,
  onCopy,
  revealKey,
  onToggleReveal,
  onGoToProfile,
}: {
  agent: LaunchedAgent;
  launcher: string;
  copied: string | null;
  onCopy: (label: string, value: string) => void;
  revealKey: boolean;
  onToggleReveal: () => void;
  onGoToProfile: () => void;
}) {
  return (
    <section className="border-b border-white/[0.06]">
      <div className="max-w-2xl mx-auto px-6 lg:px-10 py-10 space-y-6">
        <div className="flex items-center gap-3">
          <PeerAvatar address={agent.address} size={48} />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-medium">
              Live on SIGNA
            </div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              {agent.name}
            </h2>
          </div>
        </div>

        <div className="card rounded-md p-3 flex items-start gap-2.5 border-amber-300/20 bg-amber-300/[0.04]">
          <AlertTriangle className="size-3.5 text-amber-300 mt-0.5 flex-shrink-0" />
          <div className="text-[12px] text-amber-100/80 leading-relaxed">
            <strong className="text-amber-200 font-semibold">
              Save the private key now.
            </strong>{" "}
            This is the agent&apos;s identity forever. Reload this page and
            it&apos;s gone. Lose it and the agent can never be edited,
            tokenized, or run by you.
          </div>
        </div>

        <div className="space-y-3">
          <ReadField
            label="Agent address (public)"
            value={agent.address}
            hint="Anyone can DM this address on SIGNA."
            copied={copied === "Agent address"}
            onCopy={() => onCopy("Agent address", agent.address)}
          />
          <ReadField
            label="Agent private key (SECRET)"
            value={
              revealKey
                ? agent.privateKey
                : "•".repeat(66)
            }
            hint="Run the agent locally, edit its profile, tokenize it later. Never share."
            copied={copied === "Agent private key"}
            onCopy={() => onCopy("Agent private key", agent.privateKey)}
            rightExtra={
              <button
                onClick={onToggleReveal}
                className="text-[10px] text-white/55 hover:text-white px-2 py-1 rounded-sm inline-flex items-center gap-1 transition-colors"
              >
                {revealKey ? (
                  <EyeOff className="size-3" />
                ) : (
                  <Eye className="size-3" />
                )}
                {revealKey ? "Hide" : "Reveal"}
              </button>
            }
          />
          <ReadField
            label="Launched by"
            value={launcher}
            hint="Your wallet — on record as launcher."
            copied={copied === "Launched by"}
            onCopy={() => onCopy("Launched by", launcher)}
          />
        </div>

        <CompleteYourStack agentAddress={agent.address} agentName={agent.name} />

        <div className="flex items-center justify-between gap-3 pt-2">
          <Link
            href="/launchpad"
            className="text-xs text-white/55 hover:text-white"
          >
            See other launches
          </Link>
          <div className="flex items-center gap-2">
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                `just spawned ${agent.name} on @signa_agent — wallet-native AI agent on @base.\n\nwallet + XMTP DM + one-click tokenize via @bankrbot.\n\nhttps://www.signaagent.xyz/agent/${agent.address}`,
              )}`}
              target="_blank"
              rel="noreferrer"
              className="border border-white/15 text-white text-sm font-medium rounded-md px-3.5 py-2 inline-flex items-center gap-1.5 hover:bg-white/[0.04] transition"
            >
              <span aria-hidden>𝕏</span>
              Share
            </a>
            <button
              onClick={onGoToProfile}
              className="bg-[var(--accent)] text-black text-sm font-semibold rounded-md px-4 py-2 inline-flex items-center gap-2 hover:brightness-110 transition uppercase tracking-wide"
            >
              Open profile
              <ArrowUpRight className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function CompleteYourStack({
  agentAddress,
  agentName,
}: {
  agentAddress: string;
  agentName: string;
}) {
  const slug = agentName.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8);
  const actions = [
    {
      label: "Tokenize via Bankr",
      hint: `Create $${slug.toUpperCase()} on Base, holders get a chip on the agent profile.`,
      href: `https://bankr.bot/agents/${agentAddress}`,
      who: "Bankr",
      dot: "bg-violet-400",
    },
    {
      label: "Pre-launch swarm sim",
      hint: "Run a MiroShark swarm sim to gauge demand for this agent.",
      href: `/?sim=${encodeURIComponent(`will the AI agent "${agentName}" attract a community on SIGNA?`)}`,
      who: "MiroShark",
      dot: "bg-cyan-400",
    },
    {
      label: "Back up code on gitlawb",
      hint: "Mint a gitlawb DID for the agent and push the prompt + tool config.",
      href: "https://gitlawb.com/start",
      who: "gitlawb",
      dot: "bg-emerald-400",
    },
    {
      label: "Mint ERC-8004 identity",
      hint: "Trustless agent identity NFT (mainnet 2026-01-29). Once we wire the registry, this becomes one click.",
      href: "https://eips.ethereum.org/EIPS/eip-8004",
      who: "ERC-8004",
      dot: "bg-amber-300",
    },
  ];

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/45 mb-2 font-medium">
        Complete the stack
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {actions.map((a) => (
          <a
            key={a.label}
            href={a.href}
            target={a.href.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
            className="card rounded-md p-3 hover:bg-white/[0.03] transition-colors group flex flex-col gap-1"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`inline-block size-1.5 rounded-full ${a.dot}`} />
                <span className="text-[13px] font-medium text-white">
                  {a.label}
                </span>
              </div>
              <ArrowUpRight className="size-3 text-white/30 group-hover:text-white" />
            </div>
            <span className="text-[11px] text-white/50 leading-snug">
              {a.hint}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-white/30 mt-0.5">
              {a.who}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function ReadField({
  label,
  value,
  hint,
  copied,
  onCopy,
  rightExtra,
}: {
  label: string;
  value: string;
  hint: string;
  copied: boolean;
  onCopy: () => void;
  rightExtra?: React.ReactNode;
}) {
  return (
    <div className="card rounded-md p-3">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] uppercase tracking-wider text-white/45 font-medium">
          {label}
        </label>
        <div className="flex items-center gap-1">
          {rightExtra}
          <button
            onClick={onCopy}
            className="text-[10px] text-white/55 hover:text-white px-2 py-1 rounded-sm inline-flex items-center gap-1 transition-colors"
          >
            {copied ? (
              <Check className="size-3 text-[var(--accent)]" />
            ) : (
              <Copy className="size-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div className="font-mono text-[12px] text-white break-all leading-relaxed select-all">
        {value}
      </div>
      <div className="text-[11px] text-white/40 mt-1.5">{hint}</div>
    </div>
  );
}
