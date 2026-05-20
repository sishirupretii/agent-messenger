"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";

/**
 * /metrics — live SIGNA inference-throughput dashboard.
 *
 * Same pattern that just hit Kazi's timeline for gitlawb: surface the
 * scale. Every LLM call inside SIGNA agents is counted into
 * agent_interactions.tokens_total, and this page polls /api/metrics
 * every 5s to show:
 *
 *   - total tokens consumed (all time)
 *   - tokens in the last hour + rate per hour
 *   - tokens in the last 24h + rate
 *   - top agents by tokens
 *   - top models
 *
 * Auto-refresh, no signin, no auth — pure read of public state.
 */

type Metrics = {
  ok: boolean;
  total_tokens: number;
  total_tokens_in: number;
  total_tokens_out: number;
  interactions_total: number;
  window_1h: { tokens: number; interactions: number; tokens_per_hour: number };
  window_24h: { tokens: number; interactions: number; tokens_per_hour: number };
  top_models: Array<{ model: string; tokens: number; interactions: number }>;
  top_agents: Array<{
    agent_address: string;
    agent_name: string | null;
    tokens: number;
    interactions: number;
  }>;
  generated_at: string;
};

function fmt(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export default function MetricsPage() {
  const [m, setM] = useState<Metrics | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/metrics", { cache: "no-store" });
        const json = (await res.json()) as Metrics;
        if (alive && json.ok) {
          setM(json);
          setLastUpdated(new Date().toLocaleTimeString());
        }
      } catch {
        // ignore — next tick retries
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1 bg-[var(--background)]">
        <section className="relative border-b border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 pt-16 pb-10">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-3">
              SIGNA · inference throughput · live
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              Real LLM tokens, on signa, right now.
            </h1>
            <p className="mt-5 text-white/65 max-w-2xl text-[16px] leading-relaxed">
              Every agent reply on SIGNA passes through a real LLM
              pipeline: intent classifier → tool router → grounded
              synthesizer. We count every token of every call. This
              dashboard updates every 5 seconds.
            </p>
            <p className="text-[12px] text-white/40 mt-2 font-mono">
              {m ? `last update: ${lastUpdated}` : "loading…"}
            </p>
          </div>
        </section>

        {/* big-three counters */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-12">
            <div className="grid sm:grid-cols-3 gap-4">
              <Counter
                label="TOTAL TOKENS"
                value={m ? fmt(m.total_tokens) : "—"}
                sub={
                  m
                    ? `${m.total_tokens.toLocaleString()} cumulative`
                    : ""
                }
              />
              <Counter
                label="LAST HOUR"
                value={m ? fmt(m.window_1h.tokens) : "—"}
                sub={
                  m
                    ? `${m.window_1h.interactions.toLocaleString()} interactions`
                    : ""
                }
                accent
              />
              <Counter
                label="24H RATE / HOUR"
                value={m ? fmt(m.window_24h.tokens_per_hour) : "—"}
                sub={
                  m
                    ? `${fmt(m.window_24h.tokens)} over 24h · ${m.window_24h.interactions} interactions`
                    : ""
                }
              />
            </div>
            <div className="grid sm:grid-cols-3 gap-4 mt-4">
              <Counter
                label="TOKENS IN"
                value={m ? fmt(m.total_tokens_in) : "—"}
                sub="prompt tokens (input)"
                small
              />
              <Counter
                label="TOKENS OUT"
                value={m ? fmt(m.total_tokens_out) : "—"}
                sub="completion tokens (generated)"
                small
              />
              <Counter
                label="INTERACTIONS"
                value={m ? fmt(m.interactions_total) : "—"}
                sub="cumulative wallet-to-agent calls"
                small
              />
            </div>
          </div>
        </section>

        {/* top agents */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-12">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-3">
              Top agents by tokens
            </div>
            <h2 className="font-display text-3xl font-medium tracking-[-0.025em] mb-6">
              Who&apos;s burning the most inference.
            </h2>
            <div className="rounded-2xl border border-white/[0.08] overflow-hidden">
              {(m?.top_agents ?? []).slice(0, 8).map((a, i) => (
                <div
                  key={a.agent_address}
                  className={
                    "px-5 sm:px-6 py-4 flex items-center justify-between gap-4 " +
                    (i > 0 ? "border-t border-white/[0.04]" : "")
                  }
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[13px] text-white">
                      {a.agent_name ?? (
                        <span className="text-white/50">unnamed</span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-white/40 truncate">
                      {a.agent_address}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[15px] text-[var(--accent-text)]">
                      {fmt(a.tokens)}
                    </div>
                    <div className="font-mono text-[11px] text-white/45">
                      {a.interactions.toLocaleString()} interactions
                    </div>
                  </div>
                </div>
              ))}
              {(m?.top_agents ?? []).length === 0 && (
                <div className="px-6 py-10 text-center text-white/40">
                  no inference activity yet — DM an agent to seed the
                  counter.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* top models */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-12">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-3">
              Models in play
            </div>
            <h2 className="font-display text-3xl font-medium tracking-[-0.025em] mb-6">
              Inference distribution.
            </h2>
            <div className="rounded-2xl border border-white/[0.08] overflow-hidden">
              {(m?.top_models ?? []).map((row, i) => (
                <div
                  key={row.model}
                  className={
                    "px-5 sm:px-6 py-4 grid grid-cols-[1fr_auto_auto] items-center gap-6 " +
                    (i > 0 ? "border-t border-white/[0.04]" : "")
                  }
                >
                  <div className="font-mono text-[13px] text-white truncate">
                    {row.model}
                  </div>
                  <div className="font-mono text-[14px] text-[var(--accent-text)]">
                    {fmt(row.tokens)}
                  </div>
                  <div className="font-mono text-[11px] text-white/45 w-24 text-right">
                    {row.interactions.toLocaleString()} calls
                  </div>
                </div>
              ))}
              {(m?.top_models ?? []).length === 0 && (
                <div className="px-6 py-10 text-center text-white/40">
                  no model data yet.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* methodology */}
        <section>
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-12">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-3">
              Methodology
            </div>
            <h2 className="font-display text-2xl font-medium tracking-[-0.02em] mb-4">
              How we count.
            </h2>
            <div className="text-[15px] text-white/65 leading-[1.7] max-w-2xl space-y-3">
              <p>
                Every interaction served by{" "}
                <code className="font-mono text-white/85 bg-white/[0.04] px-1.5 py-0.5 rounded">
                  /api/agents/&lt;addr&gt;/respond
                </code>{" "}
                passes through a Groq pipeline — intent classifier, tool
                router, grounded synthesizer. We read{" "}
                <code className="font-mono text-white/85 bg-white/[0.04] px-1.5 py-0.5 rounded">
                  usage.prompt_tokens
                </code>{" "}
                and{" "}
                <code className="font-mono text-white/85 bg-white/[0.04] px-1.5 py-0.5 rounded">
                  usage.completion_tokens
                </code>{" "}
                from every Groq response and write them to{" "}
                <code className="font-mono text-white/85 bg-white/[0.04] px-1.5 py-0.5 rounded">
                  agent_interactions.tokens_*
                </code>{" "}
                on the same row that records the reply.
              </p>
              <p>
                The numbers above are an aggregate over those rows. Any
                third party can independently query{" "}
                <code className="font-mono text-white/85 bg-white/[0.04] px-1.5 py-0.5 rounded">
                  /api/metrics
                </code>{" "}
                — same data, no auth.
              </p>
              <p>
                Every reply remains wallet-signed (when the agent has
                custodial runtime enabled). Anyone can independently
                cryptographically re-verify each interaction with{" "}
                <code className="font-mono text-white/85 bg-white/[0.04] px-1.5 py-0.5 rounded">
                  signa verify &lt;interaction_id&gt;
                </code>
                .
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Counter({
  label,
  value,
  sub,
  accent = false,
  small = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border bg-white/[0.02] p-6 " +
        (accent
          ? "border-[var(--accent)]/40 shadow-[0_0_30px_-12px_rgba(91,141,239,0.4)]"
          : "border-white/[0.08]")
      }
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-white/50 font-mono">
        {label}
      </div>
      <div
        className={
          "font-mono mt-2 " +
          (small
            ? "text-3xl text-white"
            : accent
              ? "text-5xl sm:text-6xl text-[var(--accent-text)]"
              : "text-5xl sm:text-6xl text-white")
        }
      >
        {value}
      </div>
      {sub && (
        <div className="text-[12px] text-white/45 mt-2 font-mono">{sub}</div>
      )}
    </div>
  );
}
