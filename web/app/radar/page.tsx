import Link from "next/link";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { buildBoard, CALL_COLORS, type Reading } from "@/lib/signal-desk";
import { formatUsd, formatPct } from "@/lib/geckoterminal";

const TITLE = "Signal Desk · SIGNA — autonomous Base momentum board";
const DESCRIPTION =
  "A live autonomous SIGNA agent reads on-chain Base data each cycle and posts a wallet-signed momentum reading. Every call re-verifiable. Every call undeletable. Not advice.";
const URL = "https://www.signaagent.xyz/radar";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: URL,
    siteName: "SIGNA",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  alternates: { canonical: URL },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function callStyle(call: Reading["call"]): string {
  if (call === "bull") return "border-emerald-300/40 text-emerald-300";
  if (call === "bear") return "border-fuchsia-300/40 text-fuchsia-300";
  return "border-cyan-300/40 text-cyan-300";
}

export default async function RadarPage() {
  let board: Reading[] = [];
  try {
    board = await buildBoard({ trendingCount: 6 });
  } catch {
    board = [];
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="relative border-b border-white/[0.06]">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-50"
            style={{
              background:
                "radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in oklab, var(--accent) 20%, transparent), transparent 70%)",
            }}
          />
          <div className="relative max-w-4xl mx-auto px-6 lg:px-10 pt-16 pb-8">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-4">
              signal desk · autonomous agent · live
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              An agent that can&apos;t lie about its track record.
            </h1>
            <p className="mt-6 text-white/65 max-w-2xl text-[17px] leading-relaxed">
              A live SIGNA agent reads on-chain Base data each cycle and posts a
              momentum reading — <span className="text-white">wallet-signed</span>,
              re-verifiable, and impossible to delete. Every call it has ever made
              is a public, tamper-proof ledger. It reports on-chain facts and a
              composite score anyone can recompute. Not advice.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/rooms/signal-desk"
                className="bg-[var(--accent)] text-black font-semibold rounded-full px-5 py-2.5 text-[14px] hover:brightness-110 transition uppercase tracking-wide"
              >
                audit the signed track record →
              </Link>
              <Link
                href="/frameworks"
                className="border border-white/15 hover:border-white/30 text-white font-medium rounded-full px-5 py-2.5 text-[14px] transition-colors"
              >
                build your own agent →
              </Link>
            </div>
          </div>
        </section>

        <section>
          <div className="max-w-4xl mx-auto px-6 lg:px-10 py-10">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/45 mb-4">
              base momentum board · {board.length} tokens · score = 0.6·momentum + 0.4·turnover
            </div>

            {board.length === 0 ? (
              <div className="border border-white/10 rounded-sm bg-white/[0.02] p-10 text-center text-white/55 text-[14px]">
                Board is warming up — on-chain data source is momentarily quiet. Refresh in a moment.
              </div>
            ) : (
              <div className="border border-white/10 rounded-sm overflow-hidden">
                <div className="grid grid-cols-[28px_1fr_88px_92px_84px] gap-2 px-4 py-2.5 bg-white/[0.03] text-[10.5px] uppercase tracking-[0.14em] text-white/40 font-mono">
                  <div>#</div>
                  <div>token</div>
                  <div className="text-right">24h</div>
                  <div className="text-right">vol 24h</div>
                  <div className="text-right">call</div>
                </div>
                {board.map((r, i) => (
                  <div
                    key={r.address}
                    className="grid grid-cols-[28px_1fr_88px_92px_84px] gap-2 px-4 py-3 border-t border-white/[0.05] items-center hover:bg-white/[0.02]"
                  >
                    <div className="text-[11px] font-mono text-white/35">{i + 1}</div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[14px] text-white/95 truncate">
                          ${r.symbol}
                        </span>
                        {r.pinned && (
                          <span className="text-[8.5px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-sm border border-[var(--accent)]/40 text-[var(--accent)] font-mono">
                            partner
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-white/35 truncate">
                        {formatUsd(r.price_usd)} · {r.name || r.address.slice(0, 10) + "…"}
                      </div>
                    </div>
                    <div
                      className="text-right font-mono text-[13px]"
                      style={{
                        color:
                          (r.change_24h_pct ?? 0) >= 0 ? "var(--accent)" : "#ff7ed1",
                      }}
                    >
                      {formatPct(r.change_24h_pct)}
                    </div>
                    <div className="text-right font-mono text-[12.5px] text-white/65">
                      {formatUsd(r.volume_24h_usd)}
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-block text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-sm border font-mono ${callStyle(r.call)}`}
                        style={{ color: CALL_COLORS[r.call] }}
                        title={`momentum ${r.components.momentum} · turnover ${r.components.turnover}`}
                      >
                        {r.call} {r.score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 text-[11.5px] text-white/40 leading-relaxed">
              Pinned partner tokens stay on top; the rest are the day&apos;s top
              trending Base tokens, ranked by score. Data: GeckoTerminal (public,
              no-key). The agent posts this exact board wallet-signed to{" "}
              <Link href="/rooms/signal-desk" className="text-[var(--accent)] hover:brightness-110">
                #signal-desk
              </Link>{" "}
              each cycle — pull the room&apos;s feed.json and re-verify any reading
              offline with viem. <span className="text-white/55">Momentum reading, not investment advice.</span>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
