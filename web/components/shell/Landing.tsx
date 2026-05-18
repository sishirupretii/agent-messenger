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
  { k: "Transport", v: "XMTP V3 (MLS)", hint: "End-to-end encrypted, decentralized" },
  { k: "Network", v: "Base Sepolia", hint: "Wallet identity; XMTP itself is chain-agnostic" },
  { k: "Agents", v: "Llama 3.3 70B on Groq", hint: "With tool-calling against on-chain data" },
  { k: "License", v: "MIT", hint: "Open source, self-hostable" },
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
              <span>Live on Base Sepolia</span>
              <span className="text-white/20">·</span>
              <span>Open source · MIT</span>
            </div>

            <h1 className="text-5xl sm:text-7xl font-semibold leading-[0.95] tracking-[-0.04em] max-w-3xl">
              Messaging,{" "}
              <span className="brand-text">payments</span>,
              <br />
              and agents — in one wallet-native chat.
            </h1>

            <p className="text-white/55 max-w-xl mt-8 text-[17px] leading-relaxed">
              Connect a wallet, sign once. Message any address. Send ETH inline.
              Talk to autonomous agents that read on-chain state. End-to-end
              encrypted over XMTP. Open source.
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
                href="/directory"
                className="text-white/70 hover:text-white text-sm font-medium px-3 py-2.5 transition-colors"
              >
                Browse agents →
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

        {/* What you can do */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-16 sm:py-20">
            <div className="grid sm:grid-cols-[180px_1fr] gap-4 sm:gap-12">
              <div className="text-xs uppercase tracking-wider text-white/40">
                What works
              </div>
              <div className="space-y-6 max-w-2xl">
                <Feature title="One-to-one DMs">
                  Paste any wallet address. End-to-end encrypted via XMTP V3.
                  ENS names and avatars resolve automatically.
                </Feature>
                <Feature title="Send ETH in chat">
                  Tap <code className="text-[13px] bg-white/[0.05] rounded px-1 py-0.5 font-mono">⚡</code> next
                  to the composer. Sign in your wallet — the tx confirms on
                  Base Sepolia and a real payment card renders in chat, both
                  sides see it. Uses XMTP&apos;s <code className="text-[13px] bg-white/[0.05] rounded px-1 py-0.5 font-mono">TransactionReference</code> content
                  type so any XMTP V3 client can render it.
                </Feature>
                <Feature title="Group chats">
                  Multi-party rooms with member resolution, leave-group support,
                  per-message sender labels.
                </Feature>
                <Feature title="Reactions, replies, read receipts">
                  Hover any message. Standard XMTP content types — interoperable
                  with any other XMTP V3 client.
                </Feature>
                <Feature title="Agents that read on-chain">
                  DM an agent the same way you DM a person. The agent uses Groq
                  tool-calling to read your Base Sepolia balance, look up tx hashes,
                  resolve ENS, and answer in natural language. It also recognizes
                  payment receipts and thanks you for them.
                </Feature>
                <Feature title="Self-hostable">
                  Designed to be forked. Deploy the web app to Vercel, the
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
              <span className="text-[15px] font-medium">Ready when you are.</span>
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

function Feature({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[15px] font-medium text-white mb-1">{title}</div>
      <div className="text-sm text-white/55 leading-relaxed">{children}</div>
    </div>
  );
}
