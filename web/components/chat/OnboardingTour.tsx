"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  TrendingUp,
  Newspaper,
  X,
} from "lucide-react";

const ONBOARDING_TOUR_KEY = "signa:onboarding-tour:v1";

type Step = {
  num: number;
  title: string;
  body: string;
  cta: { label: string; href: string; icon: React.ReactNode };
  prompt: string;
};

const STEPS: Step[] = [
  {
    num: 1,
    title: "Open your command center.",
    body:
      "Your /me page is the wallet-native daily-driver — portfolio, watchlist, launched agents, recent DMs, all in one tab. Open it once now so you know where it lives.",
    cta: {
      label: "Open /me",
      href: "/me",
      icon: <ArrowRight className="size-3.5" />,
    },
    prompt: "$ signa whoami",
  },
  {
    num: 2,
    title: "Find what's trending on Base.",
    body:
      "Live trending + new-launch tokens from GeckoTerminal. Click any → see price, holders, recent activity, one-click trade via Bankr. Bookmark with ✦ — your watchlist follows you across devices.",
    cta: {
      label: "Browse /tokens",
      href: "/tokens",
      icon: <TrendingUp className="size-3.5" />,
    },
    prompt: "$ signa tokens --network=base",
  },
  {
    num: 3,
    title: "Catch the social signal.",
    body:
      "Wallet-signed posts. Live whale alerts at /feed/bankr. New repos at /feed/gitlawb. Every $SYMBOL in any post is a tappable trade chip.",
    cta: {
      label: "Open /feed",
      href: "/feed",
      icon: <Newspaper className="size-3.5" />,
    },
    prompt: "$ signa feed",
  },
];

/**
 * Three-step onboarding tour shown ONCE per browser after XMTP enables
 * for the first time. Dismissable; the choice persists under a v1
 * localStorage key so we can re-run new tours later (v2, v3...).
 *
 * Each step has its own deeplink so a user can stop the tour and
 * actually go to that surface — clicking the CTA dismisses the tour
 * so they don't see it again on return.
 */
export function OnboardingTour({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem(ONBOARDING_TOUR_KEY)) return;
      // Defer so the modal doesn't fire mid-XMTP-init render
      const t = setTimeout(() => setOpen(true), 1200);
      return () => clearTimeout(t);
    } catch {
      // ignore
    }
  }, [active]);

  function dismiss() {
    try {
      localStorage.setItem(ONBOARDING_TOUR_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setOpen(false);
  }

  function next() {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      dismiss();
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={dismiss}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="w-full max-w-md border border-white/10 bg-[#0a0a0f] p-6 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={dismiss}
              className="absolute top-3 right-3 text-white/45 hover:text-white p-1 rounded-sm"
              aria-label="Dismiss tour"
            >
              <X className="size-4" />
            </button>

            <div className="font-mono text-[10px] text-[var(--accent)] mb-1">
              {STEPS[step].prompt}
            </div>
            <div className="font-mono text-[10px] text-white/40 mb-4">
              {STEPS[step].num} / {STEPS.length} · welcome to signa
            </div>

            <h2 className="font-display text-2xl font-semibold tracking-[-0.03em] leading-tight">
              {STEPS[step].title}
            </h2>
            <p className="text-white/65 mt-3 text-[14px] leading-relaxed">
              {STEPS[step].body}
            </p>

            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                onClick={dismiss}
                className="text-[12px] text-white/45 hover:text-white font-mono"
              >
                skip tour
              </button>
              <div className="flex items-center gap-2">
                <Link
                  href={STEPS[step].cta.href}
                  onClick={() => dismiss()}
                  className="border border-white/15 text-white text-[13px] rounded-md px-3 py-1.5 inline-flex items-center gap-1.5 hover:bg-white/[0.04] transition"
                >
                  {STEPS[step].cta.icon}
                  {STEPS[step].cta.label}
                </Link>
                <button
                  onClick={next}
                  className="bg-[var(--accent)] text-black font-semibold text-[13px] uppercase tracking-wide rounded-md px-3 py-1.5 inline-flex items-center gap-1.5 hover:brightness-110 transition"
                >
                  {step < STEPS.length - 1 ? "next" : "done"}
                  <span aria-hidden className="font-mono">
                    →
                  </span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1 mt-4 justify-center">
              {STEPS.map((s, i) => (
                <button
                  key={s.num}
                  onClick={() => setStep(i)}
                  className={
                    i === step
                      ? "h-1 w-6 bg-[var(--accent)] rounded-full"
                      : "h-1 w-1 bg-white/20 rounded-full hover:bg-white/40 transition"
                  }
                  aria-label={`step ${i + 1}`}
                />
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
