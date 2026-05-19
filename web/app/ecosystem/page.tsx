"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";

type Integration = {
  name: string;
  token: string | null;
  category: string;
  blurb: string;
  signaUses: string[];
  url: string;
  slash: string | null;
  contract?: string;
};

const INTEGRATIONS: Integration[] = [
  {
    name: "Bankr",
    token: "$BNKR",
    category: "Trading",
    blurb:
      "AI trading agent on X / Farcaster / Terminal. Trade with natural language across Base, Ethereum, Solana, Polygon. Coinbase-Ventures-backed.",
    signaUses: [
      "Type /bankr <command> in any SIGNA chat — opens Bankr Terminal pre-filled",
      "Tip with $BNKR from the payment modal",
      "SIGNA is publishing a `signa-feed` Skill to BankrBot/skills",
    ],
    url: "https://bankr.bot",
    slash: "/bankr",
    contract: "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b",
  },
  {
    name: "AEON",
    token: "USDC",
    category: "Payments",
    blurb:
      "Modular crypto payment protocol for AI agents. $263M+ processed, 5.7M+ txs. x402 facilitator for AI-to-AI micropayments.",
    signaUses: [
      "Type /aeon in any SIGNA chat — opens AEON Pay",
      "Tip with USDC (AEON's preferred unit) from the payment modal",
      "Roadmap: per-message agent pricing settled via AEON x402",
    ],
    url: "https://aeon.xyz",
    slash: "/aeon",
  },
  {
    name: "gitlawb",
    token: "$GITLAWB",
    category: "Open source",
    blurb:
      "Decentralized git network for AI agents. Repos on IPFS+Filecoin+Arweave, peer connectivity via libp2p, identity via DID+UCAN. Staking via $GITLAWB on Base.",
    signaUses: [
      "Type /gitlawb in any SIGNA chat — opens gitlawb",
      "Tip with $GITLAWB from the payment modal",
      "Roadmap: \"Open source on gitlawb\" badge on directory agents",
    ],
    url: "https://gitlawb.com",
    slash: "/gitlawb",
    contract: "0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3",
  },
  {
    name: "MiroShark",
    token: "$MIROSHARK",
    category: "Simulation",
    blurb:
      "AI multi-agent simulation infrastructure on Base. Spawn hundreds of agents to simulate public reaction across Twitter, Reddit, and prediction markets.",
    signaUses: [
      "Ask the SIGNA agent 'simulate reaction to X' — calls miroshark_simulate which POSTs to your MIROSHARK_BASE_URL instance (or returns deploy-your-own instructions)",
      "Tip with $MIROSHARK from the payment modal — verified Base contract 0xd7bc…ba3",
      "Holder chip on every profile that owns $MIROSHARK",
    ],
    url: "https://github.com/aaronjmars/MiroShark",
    slash: "/miroshark",
    contract: "0xd7bc6a05a56655fb2052f742b012d1dfd66e1ba3",
  },
];

export default function EcosystemPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 pt-12 pb-12 sm:pt-16">
            <Link
              href="/"
              className="text-xs text-white/45 hover:text-white inline-flex items-center gap-1 mb-8"
            >
              <ArrowLeft className="size-3" />
              Back
            </Link>
            <div className="text-xs uppercase tracking-wider text-white/40 mb-3">
              Ecosystem
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-0.03em] leading-[1.05] max-w-2xl">
              The stack we&apos;re built on.
            </h1>
            <p className="text-white/55 max-w-xl mt-5 text-[16px] leading-relaxed">
              SIGNA is the messenger and the kernel. Bankr is the trader.
              AEON is the on-chain identity + payment rail. gitlawb is the
              decentralized git layer. MiroShark is the simulation lab.
              All native to Base.
            </p>
          </div>
        </section>

        <section className="flex-1">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-12 sm:py-16">
            <div className="grid sm:grid-cols-2 gap-4">
              {INTEGRATIONS.map((it) => (
                <a
                  key={it.name}
                  href={it.url}
                  target="_blank"
                  rel="noreferrer"
                  className="card rounded-md p-5 hover:bg-white/[0.03] transition-colors group flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
                        {it.category}
                      </div>
                      <div className="flex items-baseline gap-2">
                        <h2 className="font-display text-xl font-semibold text-white">
                          {it.name}
                        </h2>
                        {it.token && (
                          <span className="text-[11px] text-[var(--accent)] font-mono">
                            {it.token}
                          </span>
                        )}
                      </div>
                    </div>
                    <ArrowUpRight className="size-4 text-white/30 group-hover:text-white flex-shrink-0" />
                  </div>
                  <p className="text-[13px] text-white/60 leading-relaxed">
                    {it.blurb}
                  </p>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
                      Uses in SIGNA
                    </div>
                    <ul className="text-[12px] text-white/70 space-y-1">
                      {it.signaUses.map((u) => (
                        <li
                          key={u}
                          className="pl-3 relative before:absolute before:left-0 before:top-[7px] before:size-1 before:rounded-full before:bg-[var(--accent)]/60"
                        >
                          {u}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {it.slash && (
                    <div className="mt-auto pt-2 flex items-center gap-2 text-[11px]">
                      <span className="font-mono bg-white/[0.05] rounded px-1.5 py-0.5 text-white/70">
                        {it.slash}
                      </span>
                      <span className="text-white/35">
                        Try it in any chat composer
                      </span>
                    </div>
                  )}
                </a>
              ))}
            </div>

            <div className="mt-12 card rounded-md p-5 text-[13px] text-white/60 leading-relaxed">
              <span className="text-[10px] uppercase tracking-wider text-white/40 block mb-2">
                Want to integrate?
              </span>
              If you&apos;re building something Base-native that touches
              messaging, agents, or payments, your project belongs on this
              page. Find SIGNA on{" "}
              <a
                href="/directory"
                className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-2)]"
              >
                directory
              </a>
              .
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
