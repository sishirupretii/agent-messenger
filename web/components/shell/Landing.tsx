"use client";

import { motion } from "framer-motion";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { MessageSquare, Bot, Lock } from "lucide-react";

const features = [
  {
    icon: MessageSquare,
    title: "Wallet-to-wallet chat",
    desc: "End-to-end encrypted messages between any two wallets via XMTP.",
  },
  {
    icon: Bot,
    title: "Talk to agents",
    desc: "DM autonomous agents powered by Llama 3.3 70B over the same network.",
  },
  {
    icon: Lock,
    title: "Your wallet is your identity",
    desc: "No accounts, no passwords. Sign once, your address is your handle.",
  },
];

export function Landing() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-xl text-center flex flex-col items-center gap-6"
      >
        <div className="relative">
          <div className="absolute inset-0 brand-gradient blur-3xl opacity-50 rounded-full" />
          <div className="relative size-16 rounded-2xl brand-gradient shadow-2xl" />
        </div>
        <div className="space-y-3">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
            Talk to wallets.
            <br />
            Talk to <span className="brand-text">agents.</span>
          </h1>
          <p className="text-white/55 max-w-md mx-auto leading-relaxed">
            Open-source agent messaging on Base Sepolia. Connect a wallet to message
            any other wallet — or any agent — over XMTP.
          </p>
        </div>
        <div className="pt-2">
          <ConnectButton.Custom>
            {({ openConnectModal, mounted }) => (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={openConnectModal}
                disabled={!mounted}
                className="brand-gradient text-white font-medium rounded-xl px-6 py-3 shadow-lg disabled:opacity-50"
              >
                Connect wallet
              </motion.button>
            )}
          </ConnectButton.Custom>
        </div>
      </motion.div>

      <motion.div
        initial="hidden"
        animate="show"
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.08, delayChildren: 0.2 } },
        }}
        className="grid sm:grid-cols-3 gap-3 mt-14 w-full max-w-3xl"
      >
        {features.map(({ icon: Icon, title, desc }) => (
          <motion.div
            key={title}
            variants={{
              hidden: { opacity: 0, y: 12 },
              show: { opacity: 1, y: 0 },
            }}
            className="glass rounded-2xl p-4 flex flex-col gap-2"
          >
            <Icon className="size-4 text-white/70" />
            <div className="text-sm font-medium text-white">{title}</div>
            <div className="text-xs text-white/45 leading-relaxed">{desc}</div>
          </motion.div>
        ))}
      </motion.div>
    </main>
  );
}
