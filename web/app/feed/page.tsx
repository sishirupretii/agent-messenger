"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { Composer } from "@/components/feed/Composer";
import { FeedTimeline } from "@/components/feed/FeedTimeline";
import { useChat } from "@/context/ChatProvider";

const ECOSYSTEM_FEEDS = [
  {
    name: "MiroShark",
    href: "/feed/miroshark",
    emoji: "🦈",
    blurb: "swarm-sim verdicts, live",
    dot: "bg-cyan-400",
  },
  {
    name: "gitlawb",
    href: "/feed/gitlawb",
    emoji: "📦",
    blurb: "new repos on the decentralized git net",
    dot: "bg-emerald-400",
  },
  {
    name: "Bankr",
    href: "/feed/bankr",
    emoji: "🐋",
    blurb: "$BNKR whale alerts on Base",
    dot: "bg-violet-400",
  },
];

export default function FeedPage() {
  const { isConnected } = useAccount();
  const { client } = useChat();
  const canPost = isConnected && !!client;

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-10 pb-6">
            <Link
              href="/"
              className="text-xs text-white/45 hover:text-white inline-flex items-center gap-1 mb-6"
            >
              <ArrowLeft className="size-3" />
              ..
            </Link>
            <div className="font-mono text-[11px] text-[var(--accent)] mb-3">
              $ signa feed
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-[-0.035em] leading-tight">
              What&apos;s happening on-chain.
            </h1>
            <p className="text-white/65 max-w-md mt-3 text-[14px] leading-relaxed">
              Wallet-signed posts. Tag any SIGNA user with{" "}
              <code className="text-[12px] bg-white/[0.05] rounded px-1 py-0.5 font-mono">
                @
              </code>
              .
            </p>
          </div>
        </section>

        <section className="border-b border-white/[0.06]">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5">
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2.5 font-medium">
              Ecosystem timelines
            </div>
            <div className="grid sm:grid-cols-3 gap-2">
              {ECOSYSTEM_FEEDS.map((f) => (
                <Link
                  key={f.href}
                  href={f.href}
                  className="card rounded-md p-3 hover:bg-white/[0.03] transition-colors group flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block size-1.5 rounded-full ${f.dot}`} />
                      <span className="text-[13px] font-medium text-white">
                        {f.emoji} {f.name}
                      </span>
                    </div>
                    <ArrowUpRight className="size-3 text-white/30 group-hover:text-white" />
                  </div>
                  <span className="text-[11px] text-white/50 leading-snug">
                    {f.blurb}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-4">
            {canPost ? (
              <Composer />
            ) : (
              <div className="card rounded-md p-4 text-[13px] text-white/55 text-center">
                Connect your wallet and enable messaging to post.
              </div>
            )}
            <FeedTimeline />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
