"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, MessageCircle, Sparkles, Github } from "lucide-react";
import { AppHeader } from "@/components/shell/AppHeader";
import { PeerAvatar } from "@/components/ui/Avatar";
import { shortAddress } from "@/lib/format";
import agentsData from "@/data/agents.json";

type AgentEntry = {
  name: string;
  address: string;
  description: string;
  tags?: string[];
};

const agents = agentsData as AgentEntry[];

export default function DirectoryPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1 flex flex-col items-center px-4 sm:px-6 py-8 sm:py-12">
        <div className="w-full max-w-3xl flex flex-col gap-6">
          <Link
            href="/"
            className="text-xs text-white/50 hover:text-white flex items-center gap-1 self-start"
          >
            <ArrowLeft className="size-3" />
            Back to chats
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-2 text-white/60 text-xs uppercase tracking-wider">
              <Sparkles className="size-3.5" />
              Agent directory
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              Find an agent to talk to
            </h1>
            <p className="text-white/55 max-w-lg">
              A curated list of agents running on XMTP dev. Click any to start a chat.
            </p>
          </motion.div>

          {agents.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="glass rounded-2xl p-8 text-center flex flex-col items-center gap-3"
            >
              <Sparkles className="size-6 text-white/40" />
              <div className="space-y-1">
                <p className="text-white font-medium">
                  No agents registered yet
                </p>
                <p className="text-sm text-white/50 max-w-md">
                  When you deploy an agent on Railway, add it to{" "}
                  <code className="text-xs font-mono bg-white/[0.05] px-1.5 py-0.5 rounded">
                    web/data/agents.json
                  </code>{" "}
                  and push to GitHub — it&apos;ll appear here.
                </p>
              </div>
              <Link
                href="https://github.com/sishirupretii/agent-messenger#agent-railway"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-white/70 hover:text-white flex items-center gap-1 mt-1"
              >
                <Github className="size-3" />
                How to deploy an agent
              </Link>
            </motion.div>
          ) : (
            <motion.div
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.05 } },
              }}
              className="grid sm:grid-cols-2 gap-3"
            >
              {agents.map((a) => (
                <motion.div
                  key={a.address}
                  variants={{
                    hidden: { opacity: 0, y: 8 },
                    show: { opacity: 1, y: 0 },
                  }}
                  className="glass rounded-2xl p-4 flex flex-col gap-3"
                >
                  <div className="flex items-center gap-3">
                    <PeerAvatar address={a.address} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white truncate">
                        {a.name}
                      </div>
                      <div className="text-[11px] font-mono text-white/40 truncate">
                        {shortAddress(a.address, 8, 6)}
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-white/60 leading-snug">
                    {a.description}
                  </p>
                  {a.tags && a.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {a.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] uppercase tracking-wider text-white/50 bg-white/[0.05] rounded-full px-2 py-0.5"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <Link
                    href={`/?to=${a.address}`}
                    className="brand-gradient text-white text-sm font-medium rounded-xl px-3 py-2 flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
                  >
                    <MessageCircle className="size-3.5" />
                    Message
                  </Link>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
}
