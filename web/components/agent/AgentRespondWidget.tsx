"use client";

import { useState } from "react";

/**
 * Public "try this agent" surface — embedded on /agent/[address].
 *
 * Rendered as a single shell session block. No chip buttons, no icon
 * decorations, no rounded card containers, no animated "thinking…"
 * microcopy. Just a `>` prompt + the agent's reply + a fixed-width
 * field list (intent, sources, signed, latency, interaction_id) like
 * a real curl trace. The visual language is a unix shell, not a SaaS
 * playground — so the surface reads as engineering, not a Cursor
 * template.
 */

type Source = { kind: string; ref: string };

type RespondJson = {
  ok: boolean;
  response?: string;
  intent?: string;
  sources?: Source[];
  signed?: boolean;
  signature?: string | null;
  signed_message?: string | null;
  agent_did?: string | null;
  interaction_id?: string | null;
  notice?: string | null;
  error?: string;
  message?: string;
};

const PRESETS: { cmd: string; prompt: string }[] = [
  {
    cmd: "/facts",
    prompt:
      "price of $USDC on base 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  { cmd: "/code", prompt: "build me a single-html dashboard for base trending tokens" },
  { cmd: "/swarm", prompt: "simulate 1000 wallets buying $AEON over 24h" },
  { cmd: "/action", prompt: "buy me 10 USDC of $AEON on base" },
  { cmd: "/chat", prompt: "who built you" },
];

export function AgentRespondWidget({
  address,
  agentName,
}: {
  address: string;
  agentName: string;
}) {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<RespondJson | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [history, setHistory] = useState<
    Array<{ q: string; r: RespondJson; ms: number }>
  >([]);

  async function ask(promptOverride?: string) {
    const m = (promptOverride ?? message).trim();
    if (!m || busy) return;
    setBusy(true);
    setReply(null);
    setElapsedMs(null);
    const t0 = performance.now();
    try {
      const res = await fetch(`/api/agents/${address.toLowerCase()}/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: m }),
      });
      const j = (await res.json()) as RespondJson;
      const ms = Math.round(performance.now() - t0);
      setReply(j);
      setElapsedMs(ms);
      setHistory((h) => [{ q: m, r: j, ms }, ...h].slice(0, 5));
    } catch (e) {
      const j: RespondJson = {
        ok: false,
        error: "network_error",
        message: e instanceof Error ? e.message : String(e),
      };
      setReply(j);
      setElapsedMs(Math.round(performance.now() - t0));
    } finally {
      setBusy(false);
    }
  }

  function onPreset(p: (typeof PRESETS)[number]) {
    setMessage(p.prompt);
    void ask(p.prompt);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void ask();
    }
  }

  const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`;

  return (
    <section className="border-b border-white/[0.06]">
      <div className="max-w-3xl mx-auto px-6 lg:px-10 py-10 font-mono text-[12.5px] leading-[1.7] text-white/85">
        <div className="text-white/35 mb-2">
          # public reply primitive · POST /api/agents/{shortAddr}/respond
        </div>

        {/* Preset bar — bare slash-commands, no chip styling */}
        <div className="text-white/45 mb-3">
          <span className="text-white/30">presets:</span>{" "}
          {PRESETS.map((p, i) => (
            <span key={p.cmd}>
              <button
                disabled={busy}
                onClick={() => onPreset(p)}
                className="text-[var(--accent)] hover:underline underline-offset-4 disabled:opacity-40"
              >
                {p.cmd}
              </button>
              {i < PRESETS.length - 1 && (
                <span className="text-white/20"> · </span>
              )}
            </span>
          ))}
        </div>

        {/* Composer — prompt-style, not card-style */}
        <label className="block">
          <div className="flex items-baseline gap-2">
            <span className="text-[var(--accent)]">{">"}</span>
            <span className="text-white/40">ask {agentName}</span>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={onKey}
            placeholder=""
            rows={3}
            maxLength={1500}
            disabled={busy}
            spellCheck={false}
            className="block w-full mt-1 bg-transparent border-0 border-l-2 border-white/15 focus:border-[var(--accent)] outline-none pl-3 py-1 resize-y text-white placeholder:text-white/25 disabled:opacity-50"
          />
        </label>

        <div className="mt-2 flex items-center justify-between text-white/35">
          <span>
            bytes {message.length}/1500 — public · no auth · cors-open
          </span>
          <button
            onClick={() => ask()}
            disabled={busy || !message.trim()}
            className="text-[var(--accent)] hover:underline underline-offset-4 disabled:opacity-30"
          >
            {busy ? "[…]" : "[ enter ]"}
            <span className="text-white/25 ml-2 hidden sm:inline">
              ⌘/ctrl + return
            </span>
          </button>
        </div>

        {/* Output — flat shell trace, no card, no chips */}
        {reply && (
          <div className="mt-6 pt-4 border-t border-white/[0.08]">
            <FieldRow label="intent" value={reply.intent ?? "—"} />
            <FieldRow
              label="signed"
              value={
                reply.signed
                  ? "true (agent wallet)"
                  : "false (non-custodial)"
              }
            />
            {elapsedMs != null && (
              <FieldRow label="latency" value={`${elapsedMs}ms`} />
            )}
            {reply.interaction_id && (
              <FieldRow label="id" value={reply.interaction_id} mono />
            )}
            {reply.sources && reply.sources.length > 0 && (
              <FieldRow
                label="sources"
                value={reply.sources
                  .map((s) => `${s.kind}:${s.ref}`)
                  .join("  ")}
                mono
              />
            )}

            <div className="mt-4 pt-3 border-t border-white/[0.04]">
              {reply.ok && reply.response ? (
                <pre className="whitespace-pre-wrap text-white">
                  {reply.response}
                </pre>
              ) : (
                <pre className="whitespace-pre-wrap text-red-300">
                  {reply.error ?? "error"}
                  {reply.message ? `: ${reply.message}` : ""}
                </pre>
              )}
            </div>

            {reply.notice && (
              <div className="mt-3 text-white/35">// {reply.notice}</div>
            )}
          </div>
        )}

        {/* History — flat list, no cards */}
        {history.length > 1 && (
          <div className="mt-8 pt-4 border-t border-white/[0.06]">
            <div className="text-white/35 mb-2"># history</div>
            <ol className="space-y-1">
              {history.slice(1).map((h, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[80px_1fr_auto] gap-3 text-white/55"
                >
                  <span className="text-[var(--accent)]/70">
                    {h.r.intent ?? "?"}
                  </span>
                  <span className="truncate">{h.q}</span>
                  <span className="text-white/30">{h.ms}ms</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

function FieldRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3">
      <span className="text-white/40">{label}</span>
      <span
        className={mono ? "text-white/80 break-all" : "text-white"}
      >
        {value}
      </span>
    </div>
  );
}
