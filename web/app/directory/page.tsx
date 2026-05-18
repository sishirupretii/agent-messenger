"use client";

import Link from "next/link";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { PeerAvatar } from "@/components/ui/Avatar";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { shortAddress } from "@/lib/format";
import { listAgents } from "@/lib/agents";

const agents = listAgents();

export default function DirectoryPage() {
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
              Back
            </Link>
            <div className="text-xs uppercase tracking-wider text-white/40 mb-3">
              Directory
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-0.03em] leading-[1.05] max-w-2xl">
              Agents you can DM.
            </h1>
            <p className="text-white/55 max-w-xl mt-5 text-[16px] leading-relaxed">
              A curated list of XMTP agents on Base.
              {agents.length > 0 && (
                <> Tap any to start a conversation with their address pre-filled.</>
              )}
            </p>
          </div>
        </section>

        <section className="flex-1">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-12 sm:py-16">
            {agents.length === 0 ? (
              <div className="grid sm:grid-cols-[180px_1fr] gap-4 sm:gap-12">
                <div className="text-xs uppercase tracking-wider text-white/40">
                  Empty
                </div>
                <div className="max-w-xl space-y-3">
                  <p className="text-[15px] text-white leading-relaxed">
                    No agents registered yet.
                  </p>
                  <p className="text-sm text-white/55 leading-relaxed">
                    Deploy an agent, then add an entry to{" "}
                    <code className="text-[13px] bg-white/[0.05] rounded px-1.5 py-0.5 font-mono">
                      web/data/agents.json
                    </code>
                    . On the next deploy, it shows up here with a Message
                    button.
                  </p>
                </div>
              </div>
            ) : (
              <div className="border-t border-white/[0.06]">
                {agents.map((a) => (
                  <div
                    key={a.address}
                    className="py-6 border-b border-white/[0.06] grid sm:grid-cols-[60px_1fr_auto] gap-4 sm:gap-6 items-start"
                  >
                    <PeerAvatar address={a.address} size={44} />
                    <div className="min-w-0">
                      <div className="text-[17px] font-medium text-white flex items-center gap-1.5">
                        <span>{a.name}</span>
                        {a.verified && <VerifiedBadge size={13} />}
                      </div>
                      <div className="text-[11px] font-mono text-white/40 mt-0.5">
                        {shortAddress(a.address, 10, 8)}
                      </div>
                      <p className="text-sm text-white/60 mt-2 max-w-lg leading-relaxed">
                        {a.description}
                      </p>
                      {a.tags && a.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {a.tags.map((t) => (
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
                    <Link
                      href={`/?to=${a.address}`}
                      className="bg-white text-black text-sm font-medium rounded-md px-3.5 py-1.5 inline-flex items-center gap-1.5 hover:bg-white/90 transition-colors self-center"
                    >
                      <MessageCircle className="size-3.5" />
                      Message
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
