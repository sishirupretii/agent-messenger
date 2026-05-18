"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { LogoMark } from "@/components/ui/LogoMark";
import { Footer } from "./Footer";

const ROWS: Array<{
  k: string;
  v: string;
  hint?: string;
}> = [
  {
    k: "Transport",
    v: "XMTP V3 (MLS)",
    hint: "End-to-end encrypted, decentralized",
  },
  {
    k: "Network",
    v: "Base",
    hint: "Wallet identity; XMTP itself is chain-agnostic",
  },
  {
    k: "Names",
    v: "Basenames + ENS",
    hint: "Reverse resolution on Base mainnet and Ethereum mainnet",
  },
  {
    k: "Agents",
    v: "Llama 3.3 70B on Groq",
    hint: "With tool-calling against on-chain data",
  },
  {
    k: "License",
    v: "MIT",
    hint: "Open source, self-hostable",
  },
];

export function Landing() {
  return (
    <>
      <main className="flex-1 flex flex-col">
        {/* Hero */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 pt-20 pb-24 sm:pt-28 sm:pb-32">
            <div className="flex items-center gap-2 text-xs text-white/55 mb-10">
              <span className="size-1.5 rounded-full bg-[var(--accent)]" />
              <span>Live on Base</span>
              <span className="text-white/20">·</span>
              <span>Open source · MIT</span>
            </div>

            <h1 className="font-display text-5xl sm:text-7xl font-semibold leading-[0.95] tracking-[-0.04em] max-w-3xl">
              Your wallet is{" "}
              <span className="brand-text">your identity.</span>
              <br />
              Your chat lives there too.
            </h1>

            <p className="text-white/55 max-w-xl mt-8 text-[17px] leading-relaxed">
              Wallet-native messaging for crypto.
              <br />
              Connect once. Message any wallet.
              <br />
              Encrypted by default.
            </p>

            <div className="mt-10 flex items-center gap-3">
              <ConnectButton.Custom>
                {({ openConnectModal, mounted }) => (
                  <button
                    onClick={openConnectModal}
                    disabled={!mounted}
                    className="bg-white text-black font-medium rounded-md px-5 py-2.5 text-sm hover:bg-white/90 transition-colors disabled:opacity-50"
                  >
                    Connect wallet
                  </button>
                )}
              </ConnectButton.Custom>
              <Link
                href="/launch-agent"
                className="text-white/70 hover:text-white text-sm font-medium px-3 py-2.5 transition-colors inline-flex items-center gap-1.5"
              >
                <span className="size-1.5 rounded-full bg-[var(--accent)] inline-block" />
                Spawn an agent →
              </Link>
              <Link
                href="/directory"
                className="text-white/45 hover:text-white text-sm font-medium px-3 py-2.5 transition-colors"
              >
                Browse →
              </Link>
            </div>
          </div>
        </section>

        {/* Launchpad pitch — terminal slab, not v0.dev */}
        <section className="border-b border-white/[0.06] relative overflow-hidden">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-20 sm:py-28">
            <div className="font-mono text-[11px] text-[var(--accent)] mb-5">
              $ signa spawn-agent --help
            </div>
            <h2 className="font-display text-4xl sm:text-6xl font-semibold tracking-[-0.04em] leading-[0.98] max-w-3xl">
              Mint an agent.
              <br />
              Sign one tx.
              <br />
              <span className="brand-text">Drop a token.</span>
            </h2>
            <p className="text-white/65 max-w-lg mt-7 text-[16px] leading-relaxed">
              Browser mints a fresh Base wallet for the agent. The wallet signs
              its own launch. Anyone can DM it. Tokenize it through Bankr
              when you&apos;re ready — same wallet, one click.
            </p>

            <div className="mt-9 border border-white/10 bg-black/40 font-mono text-[13px] max-w-2xl">
              <div className="px-4 py-2 border-b border-white/10 flex items-center justify-between">
                <span className="text-white/40 text-[10px] uppercase tracking-wider">
                  output
                </span>
                <span className="text-white/30 text-[10px]">~/agent.toml</span>
              </div>
              <div className="px-4 py-3 space-y-0.5 leading-[1.7]">
                <Line k="wallet" v="0xAb…cE39   # base mainnet, fresh, yours" />
                <Line k="dm    " v="signaagent.xyz/?to=…   # live, signed, encrypted" />
                <Line k="token " v="$NAME   # one click via bankrbot" />
                <Line k="code  " v="did:gitlawb:…   # push prompt to decentralized git" />
                <Line k="id    " v="erc-8004 #…   # portable reputation" />
              </div>
            </div>

            <div className="mt-9 flex items-center gap-4">
              <Link
                href="/launch-agent"
                className="bg-[var(--accent)] text-black font-semibold rounded-md px-6 py-3 text-[15px] uppercase tracking-wide inline-flex items-center gap-2 hover:brightness-110 transition"
              >
                Spawn now
                <span aria-hidden className="font-mono">→</span>
              </Link>
              <Link
                href="/launchpad"
                className="text-white/55 hover:text-white text-sm font-mono underline underline-offset-4"
              >
                /launchpad
              </Link>
            </div>
          </div>
        </section>

        {/* Specs / stack table */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-16 sm:py-20">
            <div className="grid sm:grid-cols-[180px_1fr] gap-4 sm:gap-12">
              <div className="text-xs uppercase tracking-wider text-white/40">
                Stack
              </div>
              <div className="border-t border-white/[0.06]">
                {ROWS.map((row) => (
                  <div
                    key={row.k}
                    className="grid grid-cols-[1fr_2fr] sm:grid-cols-[200px_1fr] gap-4 py-4 border-b border-white/[0.06]"
                  >
                    <div className="text-xs text-white/45 pt-0.5">{row.k}</div>
                    <div>
                      <div className="text-[15px] text-white">{row.v}</div>
                      {row.hint && (
                        <div className="text-xs text-white/40 mt-0.5">
                          {row.hint}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* What works */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-16 sm:py-20">
            <div className="grid sm:grid-cols-[180px_1fr] gap-4 sm:gap-12">
              <div className="text-xs uppercase tracking-wider text-white/40">
                What works
              </div>
              <div className="space-y-6 max-w-2xl">
                <Feature title="One-to-one and group DMs">
                  Paste any wallet, Basename, or ENS. End-to-end encrypted via
                  XMTP V3 (MLS). Avatars and primary names resolve
                  automatically.
                </Feature>
                <Feature title="Send ETH inline">
                  Tap the lightning icon next to the composer. Sign in your
                  wallet, the tx confirms on Base, and a real payment card
                  renders in chat — interoperable with any XMTP V3 client via
                  the <code className="text-[13px] bg-white/[0.05] rounded px-1 py-0.5 font-mono">TransactionReference</code> content type.
                </Feature>
                <Feature title="Reactions, replies, read receipts">
                  Hover any message. Standard XMTP content types throughout.
                </Feature>
                <Feature title="Agents that read on-chain">
                  DM an agent like a person. The agent uses Groq tool-calling
                  to answer questions about your Base balance, transactions,
                  ENS, and the network — in natural language.
                </Feature>
                <Feature title="Self-hostable">
                  Designed to be forked. Deploy the web app to Vercel and the
                  agent to Railway. Add agents to{" "}
                  <code className="text-[13px] bg-white/[0.05] rounded px-1.5 py-0.5 font-mono">
                    data/agents.json
                  </code>{" "}
                  to surface them in the directory.
                </Feature>
              </div>
            </div>
          </div>
        </section>

        {/* Quiet CTA strip */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-12 sm:py-14 flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <LogoMark size={20} className="text-white" />
              <span className="text-[15px] font-medium">
                Ready when you are.
              </span>
            </div>
            <ConnectButton.Custom>
              {({ openConnectModal, mounted }) => (
                <button
                  onClick={openConnectModal}
                  disabled={!mounted}
                  className="bg-white text-black font-medium rounded-md px-4 py-2 text-sm hover:bg-white/90 transition-colors disabled:opacity-50"
                >
                  Connect wallet
                </button>
              )}
            </ConnectButton.Custom>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="text-white/80">
      <span className="text-[var(--accent)]">{k.padEnd(7, " ")}</span>
      <span className="text-white/30"> = </span>
      <span>{v}</span>
    </div>
  );
}

function Feature({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[15px] font-medium text-white mb-1 font-display">
        {title}
      </div>
      <div className="text-sm text-white/55 leading-relaxed">{children}</div>
    </div>
  );
}
