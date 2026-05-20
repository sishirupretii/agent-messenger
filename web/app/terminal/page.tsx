"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";

/**
 * /terminal — the GATEWAY terminal.
 *
 * An immersive, retro-CRT style chat interface that talks to the real
 * /api/gateway/respond endpoint. No mocks. Each user prompt is routed
 * through SIGNA's gateway and dispatched to whichever specialist agent
 * matches the intent.
 *
 * The visual is a halftone-dotted hooded operator silhouette ("GATEWAY")
 * with glowing accent-blue eyes, sitting under a subtle scanline overlay.
 * The aesthetic mirrors classic terminal portrait software (think MEI
 * Terminal, KEWE-style ASCII characters) but rendered in SIGNA's
 * electric-blue + violet palette rather than the typical phosphor green —
 * decentralized, wallet-native, base mainnet — not generic cyberpunk.
 *
 * The hood is built from an SVG pattern of dots. The eye glow is
 * accent-blue with a CSS filter drop-shadow. A slow breathing animation
 * on the eyes hints at "online". Scanlines are a fixed-position overlay
 * with a slow vertical sweep + faint flicker.
 */

type ChatMessage =
  | { id: string; role: "operator"; text: string; meta?: string }
  | { id: string; role: "you"; text: string }
  | { id: string; role: "system"; text: string };

const QUICK_PROMPTS = [
  "What is SIGNA?",
  "How do I install the CLI?",
  "Who are the top agents?",
  "What's the price of $USDC on base?",
];

const GREETING =
  "gateway online. routing layer for the signa network. ask anything — i'll dispatch to the right agent. wallet-native, base mainnet.";

export default function TerminalPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "g0", role: "operator", text: GREETING, meta: "boot" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send(prompt: string) {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setInput("");
    const youId = crypto.randomUUID();
    setMessages((m) => [...m, { id: youId, role: "you", text }]);
    try {
      const res = await fetch("/api/gateway/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "system",
            text: `error · ${json.error ?? "unknown"}`,
          },
        ]);
      } else {
        const routedTo =
          json.gateway?.routed_to?.name ?? json.gateway?.routed_to ?? null;
        const intent = json.intent ?? null;
        const elapsed = json.gateway?.elapsed_ms ?? null;
        const metaBits: string[] = [];
        if (intent) metaBits.push(intent);
        if (routedTo) metaBits.push(`via ${routedTo}`);
        if (elapsed != null) metaBits.push(`${elapsed}ms`);
        if (json.signed) metaBits.push("signed");
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "operator",
            text: json.response ?? "(empty response)",
            meta: metaBits.join(" · ") || undefined,
          },
        ]);
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "system",
          text: `network error · ${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)]">
      <AppHeader />
      <main className="flex-1 relative overflow-hidden">
        {/* scanlines + vignette overlay — pointer-events none so it never
            blocks the chat. positioned over everything below the header. */}
        <ScanlineOverlay />

        <div className="relative max-w-5xl mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-20">
          {/* title */}
          <div className="text-center">
            <h1 className="font-mono text-4xl sm:text-5xl md:text-6xl font-bold tracking-[0.18em] text-white terminal-glow">
              SIGNA TERMINAL
            </h1>
            <div
              className="mt-3 mx-auto h-2 max-w-md"
              style={{
                backgroundImage:
                  "radial-gradient(circle, var(--accent) 1.5px, transparent 1.5px)",
                backgroundSize: "8px 8px",
                backgroundRepeat: "repeat-x",
                backgroundPosition: "center",
                opacity: 0.55,
              }}
              aria-hidden
            />
            <p className="mt-4 font-mono text-[12px] sm:text-[13px] text-white/45 tracking-wider">
              ANONYMOUS ROUTING NODE · BASE MAINNET · WALLET-NATIVE
            </p>
          </div>

          {/* portrait + chat composition */}
          <div className="relative mt-8 sm:mt-10 flex justify-center">
            <OperatorPortrait />
            <ChatPanel
              messages={messages}
              busy={busy}
              input={input}
              setInput={setInput}
              onSend={() => send(input)}
            />
          </div>

          {/* quick chips */}
          <div className="relative mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-w-4xl mx-auto">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                disabled={busy}
                className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-white/70 hover:text-white border border-white/15 hover:border-[var(--accent)]/60 rounded-md py-3 px-4 transition-colors text-center disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--background)]/40 backdrop-blur"
              >
                {q}
              </button>
            ))}
          </div>

          {/* footer hint */}
          <p className="relative mt-10 text-center font-mono text-[11px] text-white/35 tracking-wider">
            POWERED BY <span className="text-[var(--accent-text)]">/api/gateway/respond</span> · LIVE, NO MOCK ·
            ROUTES TO ANY LAUNCHED AGENT ON SIGNA
          </p>
        </div>
      </main>
      <Footer />

      <style jsx global>{`
        .terminal-glow {
          text-shadow:
            0 0 8px rgba(91, 141, 239, 0.45),
            0 0 24px rgba(91, 141, 239, 0.18);
        }
        .terminal-text-glow {
          text-shadow: 0 0 4px rgba(91, 141, 239, 0.35);
        }
        @keyframes signa-flicker {
          0%, 96%, 100% { opacity: 1; }
          97% { opacity: 0.85; }
          98% { opacity: 0.95; }
          99% { opacity: 0.88; }
        }
        @keyframes signa-scan {
          0% { transform: translateY(-20%); }
          100% { transform: translateY(120%); }
        }
        @keyframes signa-eye-pulse {
          0%, 100% { opacity: 1; filter: drop-shadow(0 0 6px var(--accent)) drop-shadow(0 0 14px var(--accent)); }
          50%      { opacity: 0.78; filter: drop-shadow(0 0 4px var(--accent)) drop-shadow(0 0 10px var(--accent)); }
        }
      `}</style>
    </div>
  );
}

/* ---------------- scanline + vignette overlay ---------------- */

function ScanlineOverlay() {
  return (
    <>
      {/* horizontal scanlines — fine, low-alpha so they don't fatigue eyes */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 3px)",
          animation: "signa-flicker 8s infinite",
        }}
      />
      {/* slow scanning highlight */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 z-10"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, rgba(91,141,239,0.06) 50%, transparent 100%)",
          animation: "signa-scan 8s linear infinite",
        }}
      />
      {/* vignette — pulls eye toward center */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.45) 95%)",
        }}
      />
    </>
  );
}

/* ---------------- operator portrait ---------------- */

function OperatorPortrait() {
  // Generate a halftone dot grid for the hood. We precompute positions
  // once and let alpha vary by radial distance from the face center —
  // denser/brighter at the hood edges, fainter near the face cavity,
  // which approximates the dithered-portrait look.
  const dots = useMemo(() => {
    const out: Array<{ cx: number; cy: number; r: number; a: number }> = [];
    const cx = 200;
    const cy = 240;
    const step = 7;
    for (let y = 30; y <= 470; y += step) {
      // offset every other row for a tighter packing — feels less grid-like
      const rowOffset = (y / step) % 2 === 0 ? 0 : step / 2;
      for (let x = 30 + rowOffset; x <= 370; x += step) {
        // distance from face center, normalized
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        // hood mask: keep points inside an inverted-egg silhouette
        const hoodTop = 60;
        const hoodBottomY = 460;
        const halfWidth =
          y < hoodTop
            ? 0
            : y < cy
              ? // top dome
                Math.sqrt(Math.max(0, 145 * 145 - (y - cy) * (y - cy)))
              : // straighter sides down to bottom
                145 - (y - cy) * 0.05;
        if (Math.abs(dx) > halfWidth) continue;
        if (y < hoodTop || y > hoodBottomY) continue;
        // carve a face cavity (darker, dot-less zone) — an ellipse
        const faceCavityRx = 95;
        const faceCavityRy = 115;
        const inFaceCavity =
          (dx * dx) / (faceCavityRx * faceCavityRx) +
            ((y - cy + 5) * (y - cy + 5)) / (faceCavityRy * faceCavityRy) <
          1;
        if (inFaceCavity) continue;
        // alpha falls off with distance (brighter near hood edge band)
        const edgeBand = Math.max(0, Math.min(1, (d - 110) / 80));
        const a = 0.25 + 0.55 * edgeBand;
        // dot size varies a touch — gives the dithered halftone look
        const r =
          1 + ((Math.sin(x * 1.3) + Math.cos(y * 1.1)) + 2) * 0.35;
        out.push({ cx: x, cy: y, r, a });
      }
    }
    return out;
  }, []);

  return (
    <div className="relative w-full max-w-[480px] sm:max-w-[520px] mx-auto pointer-events-none select-none">
      <svg
        viewBox="0 0 400 500"
        className="w-full h-auto"
        aria-label="SIGNA gateway operator portrait"
      >
        {/* faint halo behind the hood — adds depth without being colorful */}
        <defs>
          <radialGradient id="halo" cx="50%" cy="48%" r="55%">
            <stop offset="0%" stopColor="rgba(91,141,239,0.18)" />
            <stop offset="60%" stopColor="rgba(91,141,239,0.04)" />
            <stop offset="100%" stopColor="rgba(91,141,239,0)" />
          </radialGradient>
          <radialGradient id="faceCavity" cx="50%" cy="52%" r="45%">
            <stop offset="0%" stopColor="rgba(10,10,15,1)" />
            <stop offset="100%" stopColor="rgba(10,10,15,0.7)" />
          </radialGradient>
        </defs>

        {/* halo */}
        <rect x="0" y="0" width="400" height="500" fill="url(#halo)" />

        {/* halftone dots — the hood itself */}
        <g>
          {dots.map((d, i) => (
            <circle
              key={i}
              cx={d.cx}
              cy={d.cy}
              r={d.r}
              fill="var(--accent)"
              opacity={d.a}
            />
          ))}
        </g>

        {/* darker face cavity overlay so the eyes pop */}
        <ellipse cx="200" cy="245" rx="92" ry="115" fill="url(#faceCavity)" />

        {/* glowing eyes */}
        <g style={{ animation: "signa-eye-pulse 3.6s ease-in-out infinite" }}>
          <ellipse cx="167" cy="240" rx="11" ry="6" fill="var(--accent)" />
          <ellipse cx="233" cy="240" rx="11" ry="6" fill="var(--accent)" />
        </g>

        {/* a faint mouth line — barely visible, just hint of geometry */}
        <line
          x1="178"
          y1="305"
          x2="222"
          y2="305"
          stroke="var(--accent)"
          strokeWidth="1.5"
          opacity="0.35"
        />
      </svg>
    </div>
  );
}

/* ---------------- chat panel ---------------- */

function ChatPanel({
  messages,
  busy,
  input,
  setInput,
  onSend,
}: {
  messages: ChatMessage[];
  busy: boolean;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 bottom-0 w-[min(92%,560px)] z-20"
      style={{ transform: "translate(-50%, 20%)" }}
    >
      <div className="rounded-lg border border-[var(--accent)]/35 bg-black/85 backdrop-blur-sm shadow-[0_0_30px_-8px_rgba(91,141,239,0.45)] overflow-hidden">
        {/* terminal title bar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[var(--accent)]" />
            <span className="size-2 rounded-full bg-white/15" />
            <span className="size-2 rounded-full bg-white/15" />
          </div>
          <div className="font-mono text-[10px] tracking-wider text-white/45">
            GATEWAY · 0x...signa
          </div>
          <div className="w-10" />
        </div>

        {/* message list */}
        <div
          ref={listRef}
          className="px-4 py-3 max-h-[280px] overflow-y-auto font-mono text-[13px] leading-[1.55] space-y-2.5"
        >
          {messages.map((m) => {
            if (m.role === "operator") {
              return (
                <div key={m.id} className="text-white/90">
                  <span className="text-[var(--accent-text)] terminal-text-glow mr-1.5">
                    gateway&nbsp;&gt;
                  </span>
                  <span className="whitespace-pre-wrap">{m.text}</span>
                  {m.meta && (
                    <div className="mt-0.5 text-[10.5px] text-white/35 tracking-wider uppercase ml-3">
                      {m.meta}
                    </div>
                  )}
                </div>
              );
            }
            if (m.role === "you") {
              return (
                <div key={m.id} className="text-white/90">
                  <span className="text-[#c4b5fd] mr-1.5">you&nbsp;&gt;</span>
                  <span className="whitespace-pre-wrap">{m.text}</span>
                </div>
              );
            }
            return (
              <div
                key={m.id}
                className="text-[11px] text-white/45 tracking-wide uppercase"
              >
                <span className="text-white/35 mr-1.5">system &gt;</span>
                {m.text}
              </div>
            );
          })}
          {busy && (
            <div className="text-white/65">
              <span className="text-[var(--accent-text)] mr-1.5">gateway&nbsp;&gt;</span>
              <BlinkingDots />
            </div>
          )}
        </div>

        {/* input row */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
          className="flex items-center gap-2 px-3 py-2 border-t border-white/[0.08] bg-white/[0.01]"
        >
          <span className="font-mono text-[12px] text-[var(--accent-text)] terminal-text-glow">
            &gt;
          </span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="say hi to gateway..."
            disabled={busy}
            className="flex-1 bg-transparent font-mono text-[13px] text-white placeholder:text-white/30 focus:outline-none disabled:opacity-50"
            autoFocus
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-md bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 text-[var(--accent-text)] border border-[var(--accent)]/35 hover:border-[var(--accent)]/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            send
          </button>
        </form>
      </div>
    </div>
  );
}

function BlinkingDots() {
  return (
    <span className="inline-flex gap-1 align-middle">
      <span className="size-1.5 rounded-full bg-[var(--accent-text)] animate-pulse [animation-delay:0ms]" />
      <span className="size-1.5 rounded-full bg-[var(--accent-text)] animate-pulse [animation-delay:200ms]" />
      <span className="size-1.5 rounded-full bg-[var(--accent-text)] animate-pulse [animation-delay:400ms]" />
    </span>
  );
}
