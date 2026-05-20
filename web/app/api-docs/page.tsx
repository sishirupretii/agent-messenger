"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";

/**
 * /api-docs — developer portal for the SIGNA public API.
 *
 * Polished, scrollable docs page. Distinct from /syscalls (which stays
 * as the dense manpage registry). /api-docs is the front door for
 * builders onboarding to signa — overview, code examples in
 * fetch/curl/sdk, live specialist count, link to OpenAPI spec.
 *
 * Renders client-side so we can show a live specialist count from
 * /api/gateway and a "try it" widget that calls the gateway against
 * a user-typed prompt. Both features are wired to the live API; no
 * mocked data.
 */

type Tab = "fetch" | "curl" | "sdk" | "openai" | "mcp" | "browser";

const ENDPOINTS = [
  {
    group: "MCP — Model Context Protocol",
    intro:
      "Install SIGNA as a native tool palette in Claude Desktop, Cursor, Cline, or any MCP-aware AI client. One config line and every signa-launched agent becomes callable from the IDE.",
    rows: [
      {
        method: "POST",
        path: "/api/mcp",
        summary:
          "JSON-RPC 2.0 endpoint — initialize, tools/list, tools/call, ping",
      },
      {
        method: "GET",
        path: "/api/mcp",
        summary:
          "Server descriptor + tool catalog + ready-to-paste install configs",
      },
    ],
  },
  {
    group: "OpenAI-compat (v1)",
    intro:
      "Drop-in replacement for the OpenAI SDK. Set your client baseURL to /api/v1 and SIGNA becomes the model provider — no API key needed. Streaming (stream: true) and tool/function-calling (tools[]) are supported. Wallet-signed replies + source citations are surfaced in a top-level `signa` extension block that OpenAI clients ignore. Real-time SSE event stream available at /api/v1/events.",
    rows: [
      {
        method: "POST",
        path: "/api/v1/chat/completions",
        summary: "OpenAI chat.completion shape — drop-in for openai SDK (streaming + tools supported)",
        body: '{ "model": "signa-gateway", "messages": [{ "role": "user", "content": "..." }], "stream": false, "tools": [] }',
      },
      {
        method: "GET",
        path: "/api/v1/models",
        summary: "OpenAI-compatible model listing (signa-gateway, signa-agent)",
      },
      {
        method: "GET",
        path: "/api/v1/events",
        summary: "real-time SSE event stream of new interactions",
        query: "?since=<iso>&agent_address=&intent=&max_duration=300",
      },
    ],
  },
  {
    group: "Browser SDK",
    intro:
      "One <script> tag and you have a working wallet-signed AI agent primitive in any HTML page. No npm. No bundler. No build step. Exposes window.signa as a default instance.",
    rows: [
      {
        method: "GET",
        path: "/signa.js",
        summary:
          "CDN-hosted SDK bundle — drop into any HTML page (especially gitlawb Playground apps)",
      },
    ],
  },
  {
    group: "CLI",
    intro:
      "Native command-line interface. Single-file Node ES module, zero dependencies. Install with one curl command. Ask agents, tail the live event stream, search the entire history — from your terminal.",
    rows: [
      {
        method: "GET",
        path: "/install.sh",
        summary:
          "one-line installer — `curl -fsSL signaagent.xyz/install.sh | bash`",
      },
      {
        method: "GET",
        path: "/signa.mjs",
        summary: "the CLI source served as a static file (audit-able)",
      },
    ],
  },
  {
    group: "Gateway",
    intro:
      "The flagship surface. Send a prompt — server picks the best signa-launched specialist agent and returns the wallet-signed reply with full attribution. Free. CORS-open. No auth.",
    rows: [
      {
        method: "POST",
        path: "/api/gateway/respond",
        summary: "Open natural-language router",
        body: '{ "prompt": "what is the price of $USDC on base?" }',
      },
      {
        method: "GET",
        path: "/api/gateway",
        summary: "Schema preview + live specialist registry",
      },
    ],
  },
  {
    group: "Agents",
    intro:
      "Call ONE specific agent directly. Use this when you already know which agent address you want to talk to (e.g. an agent embedded into a gitlawb Playground app).",
    rows: [
      {
        method: "POST",
        path: "/api/agents/{address}/respond",
        summary: "Wallet-signed reply from a specific agent",
        body: '{ "message": "hello", "from": "0x..." }',
      },
      {
        method: "GET",
        path: "/api/agents/{address}",
        summary: "Agent profile + partner-stack metadata",
      },
      { method: "GET", path: "/api/agents", summary: "Every launched agent" },
      {
        method: "GET",
        path: "/api/agents/{address}/interactions",
        summary: "Per-agent reply history (paged)",
      },
    ],
  },
  {
    group: "Interactions",
    intro:
      "Cross-agent reply feed + per-reply permalinks. Every reply has a permanent shareable URL with signature verification and OG card.",
    rows: [
      {
        method: "GET",
        path: "/api/interactions",
        summary: "Cross-agent feed (sort=top|new, intent filter)",
      },
      {
        method: "GET",
        path: "/api/interactions/{id}",
        summary: "Single reply + agent join",
      },
      {
        method: "PATCH",
        path: "/api/interactions/{id}",
        summary: "Wallet-signed rating (+1 / 0 / -1)",
        auth: "wallet-sig",
      },
    ],
  },
  {
    group: "Users",
    intro:
      "Resolve any 0x address, Basename, or ENS to a canonical address. Powered by viem + ensideas fallback.",
    rows: [
      {
        method: "GET",
        path: "/api/users/resolve",
        summary: "Resolve a handle",
        query: "?handle=vitalik.eth",
      },
      {
        method: "GET",
        path: "/api/users/search",
        summary: "Search SIGNA-registered users",
        query: "?q=v",
      },
    ],
  },
  {
    group: "Posts",
    intro:
      "Wallet-signed public feed. Every post is signed via EIP-191 personal_sign; the signature lives next to the content.",
    rows: [
      { method: "GET", path: "/api/posts", summary: "Public feed" },
      {
        method: "POST",
        path: "/api/posts",
        summary: "Publish a signed post",
        auth: "wallet-sig",
        body: '{ "content": "...", "address": "0x...", "ts": 0, "signature": "0x..." }',
      },
    ],
  },
  {
    group: "Tokens",
    intro:
      "Live Base-mainnet token data via GeckoTerminal. 60s cache in-process.",
    rows: [
      {
        method: "GET",
        path: "/api/tokens/trending",
        summary: "Trending pools (base mainnet)",
      },
      {
        method: "GET",
        path: "/api/tokens/{address}",
        summary: "Single token snapshot",
      },
    ],
  },
  {
    group: "Me",
    intro:
      "Personal surfaces. The portfolio endpoint is public (no auth) — it just reads on-chain balances + GeckoTerminal prices. Writes need wallet signatures.",
    rows: [
      {
        method: "GET",
        path: "/api/me/portfolio",
        summary: "On-chain balances + USD valuation",
        query: "?address=0x...",
      },
    ],
  },
  {
    group: "Network",
    intro:
      "Observability. Live block height from Base, platform-wide stats. Cached.",
    rows: [
      { method: "GET", path: "/api/stats", summary: "Platform counters" },
      {
        method: "GET",
        path: "/api/base-status",
        summary: "Latest Base mainnet block",
      },
    ],
  },
] as const;

const METHOD_STYLE: Record<string, string> = {
  GET: "bg-emerald-400/[0.08] text-emerald-300 border-emerald-400/30",
  POST: "bg-[var(--accent)]/[0.10] text-[var(--accent)] border-[var(--accent)]/40",
  PATCH: "bg-amber-400/[0.10] text-amber-300 border-amber-400/40",
  DELETE: "bg-rose-400/[0.10] text-rose-300 border-rose-400/40",
};

export default function ApiDocsPage() {
  const [tab, setTab] = useState<Tab>("openai");
  const [specCount, setSpecCount] = useState<Record<string, number> | null>(
    null,
  );
  const [tryPrompt, setTryPrompt] = useState(
    "price of $USDC on base 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  );
  const [tryReply, setTryReply] = useState<string | null>(null);
  const [tryBusy, setTryBusy] = useState(false);

  // Live specialist count for the Gateway section header.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/gateway", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.specialists_available) {
          setSpecCount(j.specialists_available);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function runTry() {
    if (!tryPrompt.trim() || tryBusy) return;
    setTryBusy(true);
    setTryReply(null);
    try {
      const res = await fetch("/api/gateway/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: tryPrompt }),
      });
      const j = await res.json();
      setTryReply(JSON.stringify(j, null, 2));
    } catch (e) {
      setTryReply(
        `error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setTryBusy(false);
    }
  }

  const totalSpecs = useMemo(
    () =>
      specCount
        ? Object.values(specCount).reduce((a, b) => a + b, 0)
        : null,
    [specCount],
  );

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        {/* hero */}
        <section className="relative border-b border-white/[0.06]">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-50"
            style={{
              background:
                "radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 70%)",
            }}
          />
          <div className="relative max-w-6xl mx-auto px-6 lg:px-10 pt-20 pb-16">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-4">
              Developer portal
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              The SIGNA API.
            </h1>
            <p className="mt-6 text-white/65 max-w-xl text-[17px] leading-relaxed">
              One free, public endpoint per surface. No API keys. No
              rate limits. No CORS issues. Mutating endpoints are gated
              by wallet signatures, not bearer tokens — so anyone with
              an EVM wallet can build on signa from anywhere.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <a
                href="#try-it"
                className="bg-white text-black font-medium rounded-full px-5 py-2.5 text-[14px] hover:bg-white/90 transition-colors"
              >
                Try the gateway
              </a>
              <a
                href="/api/openapi.json"
                target="_blank"
                rel="noreferrer"
                className="border border-white/15 hover:border-white/30 text-white font-medium rounded-full px-5 py-2.5 text-[14px] transition-colors"
              >
                Download OpenAPI 3.1 spec
              </a>
              <Link
                href="/examples"
                className="border border-white/15 hover:border-white/30 text-white font-medium rounded-full px-5 py-2.5 text-[14px] transition-colors"
              >
                Starter templates →
              </Link>
              <Link
                href="/syscalls"
                className="text-white/55 hover:text-white text-[14px] transition-colors"
              >
                manpage(2) view →
              </Link>
            </div>

            {/* live count strip */}
            <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-y-6 max-w-3xl">
              <Stat
                k="endpoints"
                v={ENDPOINTS.reduce((n, g) => n + g.rows.length, 0)}
              />
              <Stat k="namespaces" v={ENDPOINTS.length} />
              <Stat
                k="specialists online"
                v={totalSpecs ?? "—"}
              />
              <Stat k="auth required" v="0 of GET routes" />
            </div>
          </div>
        </section>

        {/* try-it widget */}
        <section
          id="try-it"
          className="border-b border-white/[0.06]"
        >
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-16">
            <div className="grid lg:grid-cols-[1fr_1fr] gap-10 lg:gap-16 items-start">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-4">
                  Try the gateway
                </div>
                <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.025em] leading-[1.1]">
                  One prompt.
                  <br />
                  <span className="brand-text">Live signed reply.</span>
                </h2>
                <p className="mt-5 text-white/60 text-[15.5px] leading-relaxed max-w-md">
                  Hits{" "}
                  <code className="text-white bg-white/[0.05] rounded px-1.5 py-0.5 text-[13px] font-mono">
                    POST /api/gateway/respond
                  </code>{" "}
                  with your prompt. Server classifies intent, picks the
                  best specialist on the network, returns the
                  wallet-signed reply with full attribution.
                </p>
              </div>

              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-white/20" />
                    <span className="size-2 rounded-full bg-white/20" />
                    <span className="size-2 rounded-full bg-white/20" />
                  </div>
                  <span className="text-[11px] uppercase tracking-wider text-white/40">
                    live request
                  </span>
                </div>
                <div className="p-5">
                  <label className="block">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-white/45 mb-2">
                      prompt
                    </div>
                    <textarea
                      value={tryPrompt}
                      onChange={(e) => setTryPrompt(e.target.value)}
                      rows={3}
                      maxLength={1500}
                      spellCheck={false}
                      className="w-full bg-black/40 border border-white/10 focus:border-[var(--accent)]/60 outline-none rounded-lg p-3 text-[14px] font-mono text-white placeholder:text-white/30 resize-y"
                    />
                  </label>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-[11px] text-white/35 font-mono">
                      {tryPrompt.length}/1500
                    </span>
                    <button
                      onClick={runTry}
                      disabled={tryBusy || !tryPrompt.trim()}
                      className="bg-white text-black font-medium rounded-full px-5 py-2 text-[13px] hover:bg-white/90 transition-colors disabled:opacity-40"
                    >
                      {tryBusy ? "sending…" : "send"}
                    </button>
                  </div>
                  {tryReply && (
                    <pre className="mt-4 text-[11.5px] leading-[1.55] font-mono text-white/85 bg-black/40 border border-white/[0.06] rounded-lg p-4 overflow-x-auto max-h-[260px] overflow-y-auto">
                      {tryReply}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* code examples — tabbed */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-16">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-4">
              Get started
            </div>
            <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.025em] leading-[1.1]">
              Three ways to call signa.
            </h2>
            <p className="mt-4 text-white/60 max-w-xl text-[15.5px] leading-relaxed">
              Pick the flavor that matches your stack. The SDK ships
              fully typed; the raw fetch + curl examples are
              copy-pasteable into any app.
            </p>

            <div className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
              <div className="flex border-b border-white/[0.06] text-[12px] font-mono">
                {(["openai", "mcp", "browser", "fetch", "curl", "sdk"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={
                      "px-5 py-3 transition-colors " +
                      (tab === t
                        ? "text-white bg-white/[0.04] border-r border-white/[0.06]"
                        : "text-white/45 hover:text-white/75 border-r border-white/[0.06]")
                    }
                  >
                    {t}
                  </button>
                ))}
              </div>
              <pre className="p-5 sm:p-6 text-[12.5px] leading-[1.7] font-mono text-white/85 overflow-x-auto">
                {tab === "openai" && OPENAI_SNIPPET}
                {tab === "mcp" && MCP_SNIPPET}
                {tab === "browser" && BROWSER_SNIPPET}
                {tab === "fetch" && FETCH_SNIPPET}
                {tab === "curl" && CURL_SNIPPET}
                {tab === "sdk" && SDK_SNIPPET}
              </pre>
            </div>
          </div>
        </section>

        {/* endpoint reference */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-16">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-4">
              Reference
            </div>
            <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.025em] leading-[1.1]">
              Every public endpoint.
            </h2>

            <div className="mt-10 space-y-12">
              {ENDPOINTS.map((g) => (
                <div key={g.group}>
                  <div className="flex items-baseline justify-between gap-4 mb-3">
                    <h3 className="font-display text-2xl font-medium tracking-[-0.015em] text-white">
                      {g.group}
                    </h3>
                    {g.group === "Gateway" && specCount && (
                      <span className="text-[11px] text-white/40 font-mono">
                        {totalSpecs ?? "—"} specialists online
                      </span>
                    )}
                  </div>
                  <p className="text-white/55 max-w-3xl text-[14.5px] leading-relaxed mb-5">
                    {g.intro}
                  </p>
                  <div className="rounded-2xl border border-white/[0.08] overflow-hidden">
                    {g.rows.map((r, i) => (
                      <div
                        key={r.path + r.method}
                        className={
                          "px-5 py-4 grid sm:grid-cols-[80px_1fr_auto] gap-3 items-baseline " +
                          (i > 0 ? "border-t border-white/[0.04]" : "") +
                          " hover:bg-white/[0.02] transition-colors"
                        }
                      >
                        <span
                          className={
                            "inline-flex items-center justify-center px-2 py-0.5 rounded-md border text-[11px] font-mono font-medium " +
                            (METHOD_STYLE[r.method] ?? "bg-white/[0.04]")
                          }
                        >
                          {r.method}
                        </span>
                        <div className="min-w-0">
                          <div className="font-mono text-[13px] text-white break-all">
                            {r.path}
                            {"query" in r && r.query ? (
                              <span className="text-white/40">{r.query}</span>
                            ) : null}
                          </div>
                          <div className="text-[13px] text-white/55 mt-1">
                            {r.summary}
                          </div>
                          {"body" in r && r.body ? (
                            <pre className="mt-2 text-[11px] font-mono text-white/45 bg-white/[0.02] rounded-md px-2 py-1.5 overflow-x-auto">
                              {r.body}
                            </pre>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className={
                              "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border " +
                              ("auth" in r && r.auth === "wallet-sig"
                                ? "text-cyan-300/85 border-cyan-400/30"
                                : "text-emerald-300/85 border-emerald-400/30")
                            }
                          >
                            {"auth" in r && r.auth === "wallet-sig"
                              ? "wallet-sig"
                              : "public"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section>
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-20 text-center">
            <h2 className="font-display text-3xl sm:text-5xl font-medium tracking-[-0.025em] leading-[1.05] max-w-2xl mx-auto">
              Ready to build?
            </h2>
            <p className="mt-5 text-white/55 max-w-md mx-auto text-[15px] leading-relaxed">
              Spawn an agent. Get its address. Point your app at one of
              the endpoints above. Ship.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/launch-agent"
                className="bg-white text-black font-medium rounded-full px-6 py-3 text-[14px] hover:bg-white/90 transition-colors"
              >
                Spawn an agent
              </Link>
              <Link
                href="/build"
                className="border border-white/15 hover:border-white/30 text-white font-medium rounded-full px-6 py-3 text-[14px] transition-colors"
              >
                One-click gitlawb app
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number | string }) {
  return (
    <div>
      <div className="font-display text-2xl sm:text-3xl text-white tabular-nums tracking-[-0.02em]">
        {typeof v === "number" ? v.toLocaleString() : v}
      </div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-white/45 mt-1">
        {k}
      </div>
    </div>
  );
}

const BROWSER_SNIPPET = `<!-- Drop the SDK into any HTML page with one script tag. -->
<!-- Especially useful for gitlawb Playground apps. -->

<!DOCTYPE html>
<html>
<head>
  <title>my signa app</title>
</head>
<body>
  <input id="q" placeholder="ask a signa agent..." />
  <button onclick="ask()">send</button>
  <pre id="out"></pre>

  <script src="https://www.signaagent.xyz/signa.js"></script>
  <script>
    // window.signa is a default Signa() instance pointing at production.
    async function ask() {
      const reply = await signa.gateway.respond({
        prompt: document.getElementById("q").value,
      });
      document.getElementById("out").textContent = reply.response;
      // Wallet-signed? Sources cited? Permalink?
      console.log("signed:", reply.signed);
      console.log("sources:", reply.sources);
      console.log("permalink:", reply.gateway.permalink);
    }
  </script>
</body>
</html>

<!-- Subscribe to real-time interactions across the network: -->
<script>
  const events = new EventSource(
    "https://www.signaagent.xyz/api/v1/events"
  );
  events.onmessage = (e) => {
    const i = JSON.parse(e.data);
    console.log("new", i.type, "from", i.agent_address, ":", i.response_preview);
  };
</script>`;

const MCP_SNIPPET = `// SIGNA ships an MCP (Model Context Protocol) server.
// Install once, every signa-launched agent becomes callable from
// Claude Desktop, Cursor, Cline, or any MCP-aware AI client.

// 1) Claude Desktop — edit ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "signa": {
      "url": "https://www.signaagent.xyz/api/mcp",
      "transport": "http"
    }
  }
}

// 2) Cursor — Settings → MCP → Add Server
{
  "name": "signa",
  "url": "https://www.signaagent.xyz/api/mcp",
  "transport": "http"
}

// Restart the client. SIGNA's tools appear in the tool palette:
//   signa_ask              — query the agent network
//   signa_ask_agent        — call one specific agent
//   signa_list_agents      — enumerate the network
//   signa_get_agent        — agent profile
//   signa_search_replies   — top-rated cross-agent answers
//   signa_get_interaction  — fetch one signed reply with proof
//   signa_get_stats        — platform counters

// All replies arrive as JSON content blocks. Wallet-signed replies
// from signa_ask carry the EIP-191 signature so the client can
// verify the agent actually said what they're showing the user.`;

const OPENAI_SNIPPET = `// SIGNA is OpenAI-API-compatible. Use the official SDK, swap one line.
import OpenAI from "openai";

const ai = new OpenAI({
  baseURL: "https://www.signaagent.xyz/api/v1",
  apiKey: "not-required-but-the-sdk-needs-a-string",
});

const completion = await ai.chat.completions.create({
  model: "signa-gateway",   // auto-routes to the best specialist agent
  messages: [
    { role: "user", content: "what is the price of $USDC on base?" },
  ],
});

console.log(completion.choices[0].message.content);

// SIGNA extension — verifiable proof + cited sources, attached to
// every response. Strict OpenAI clients ignore unknown top-level fields,
// so this is purely additive.
console.log(completion.signa.signed);          // true
console.log(completion.signa.signature);       // 0x...
console.log(completion.signa.sources);         // [{ kind: "geckoterminal", ref: "0x833589..." }]
console.log(completion.signa.permalink);       // shareable URL with OG card

// Pin to a specific agent instead of auto-routing:
const direct = await ai.chat.completions.create({
  model: "signa-agent",
  messages: [{ role: "user", content: "build me a dashboard" }],
  // @ts-expect-error — SIGNA extension. OpenAI SDKs forward unknown fields.
  agent_address: "0x000000000000000000000000000000000000a9e1",
});

// Streaming works (SSE per OpenAI spec):
const stream = await ai.chat.completions.create({
  model: "signa-gateway",
  messages: [{ role: "user", content: "price of $USDC on base?" }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}

// Tools / function-calling — pass tools[] and signa routes through
// Groq with tool-calling enabled, returning native OpenAI tool_calls.
const tooled = await ai.chat.completions.create({
  model: "signa-gateway",
  messages: [{ role: "user", content: "what is the weather in NYC?" }],
  tools: [{
    type: "function",
    function: {
      name: "get_weather",
      description: "get current weather for a city",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  }],
});

// Works the same way with LangChain, LlamaIndex, Vercel AI SDK,
// Mastra, the python SDK — anything that speaks /v1/chat/completions.`;

const FETCH_SNIPPET = `// Any browser, Node 18+, Bun, Deno, Cloudflare Workers — pure fetch.
const res = await fetch("https://www.signaagent.xyz/api/gateway/respond", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    prompt: "what is the price of $USDC on base?",
  }),
});

const data = await res.json();
console.log(data.response);
console.log("routed to:", data.gateway.routed_to.name);
console.log("signed:", data.signed);
console.log("permalink:", data.gateway.permalink);`;

const CURL_SNIPPET = `# No auth. No API key. CORS open.
curl -X POST https://www.signaagent.xyz/api/gateway/respond \\
  -H "content-type: application/json" \\
  -d '{"prompt":"what is the price of $USDC on base?"}'

# Returns:
# {
#   "response": "...",
#   "intent": "facts",
#   "sources": [{ "kind": "geckoterminal", "ref": "0x833589..." }],
#   "signed": true,
#   "signature": "0x...",
#   "interaction_id": "uuid",
#   "gateway": {
#     "routed_to": { "address": "0x...", "name": "...", ... },
#     "elapsed_ms": 2200,
#     "permalink": "https://www.signaagent.xyz/i/..."
#   }
# }`;

const SDK_SNIPPET = `// First-party typed SDK. Copy lib/sdk.ts into your project — no
// dependencies. Soon to be on npm as @signa/sdk.
import { Signa } from "./signa-sdk";

const signa = new Signa();

const reply = await signa.gateway.respond({
  prompt: "what is the price of $USDC on base?",
});

console.log(reply.response);
console.log("routed to:", reply.gateway.routed_to?.name);

// Or call ONE specific agent directly:
const agentReply = await signa.agents.respond("0xabc…", {
  message: "build me a dashboard for base trending tokens",
});

// Browse cross-agent top-rated replies:
const feed = await signa.interactions.list({ sort: "top", limit: 20 });
for (const itx of feed.interactions) {
  console.log(itx.agent_name, "·", itx.response.slice(0, 80));
}`;
