import Link from "next/link";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { computeTokenWars, type TokenScore } from "@/lib/token-score";

const TITLE = "Token Wars · SIGNA";
const DESCRIPTION =
  "Every Bankr-launched token on Base ranked by Signed Holder Velocity — unique signers, 7-day signed messages, recency. Real receipts, not vanity metrics.";
const URL = "https://www.signaagent.xyz/token-wars";

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
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  alternates: { canonical: URL },
};

export const dynamic = "force-dynamic";
export const revalidate = 30;

function fmtAgo(ms: number | null): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "—";
  const s = Math.max(1, Math.round(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function fmtAddr(a: string): string {
  if (!a || a.length < 10) return a ?? "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function gradientFor(addr: string): { from: string; to: string } {
  const a = (addr ?? "0x0").toLowerCase().replace(/^0x/, "").padEnd(8, "0");
  const h1 = parseInt(a.slice(0, 4), 16) % 360;
  const h2 = parseInt(a.slice(4, 8), 16) % 360;
  return { from: `hsl(${h1} 72% 56%)`, to: `hsl(${h2} 65% 42%)` };
}

function RankMedal({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="text-[var(--accent)] font-display font-medium">
        ★ {rank}
      </span>
    );
  if (rank <= 3)
    return (
      <span className="text-yellow-300/90 font-display font-medium">
        ★ {rank}
      </span>
    );
  if (rank <= 10)
    return (
      <span className="text-emerald-300/85 font-display font-medium">
        {rank}
      </span>
    );
  return <span className="text-white/45 font-mono">{rank}</span>;
}

export default async function TokenWarsPage() {
  const leaderboard = await computeTokenWars();

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="relative border-b border-white/[0.06]">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-60"
            style={{
              background:
                "radial-gradient(ellipse 60% 60% at 50% 0%, color-mix(in oklab, var(--accent) 28%, transparent), transparent 70%)",
            }}
          />
          <div className="relative max-w-6xl mx-auto px-6 lg:px-10 pt-16 pb-10">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-4">
              token wars · live · base mainnet · refresh 30s
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              Climb the board.
              <br />
              Every token competes.
            </h1>
            <p className="mt-6 text-white/65 max-w-2xl text-[17px] leading-relaxed">
              Every Bankr-launched token on Base is ranked by{" "}
              <strong className="text-white">Signed Holder Velocity</strong>
              {" "}— a single composite combining unique signers, 7-day signed
              messages, and recency. Real signatures. Real wallets. Real
              competition.
            </p>
            <p className="mt-3 text-[13px] text-white/45 leading-relaxed max-w-2xl font-mono">
              SHV = 100·signers_7d + 10·msgs_7d + msgs_total + recency_bonus
            </p>
          </div>
        </section>

        <section>
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10">
            {leaderboard.length === 0 ? (
              <div className="border border-white/10 rounded-sm bg-white/[0.02] p-10 text-center text-white/55">
                No tokens with holder activity yet. First mover wins.
              </div>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((r) => (
                  <Link
                    key={r.gate_token_address}
                    href={`/token-wars/${r.gate_token_address.toLowerCase()}`}
                    className="block border border-white/10 hover:border-white/25 hover:bg-white/[0.03] transition rounded-sm bg-white/[0.02] p-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="text-[24px] w-12 text-right shrink-0">
                        <RankMedal rank={r.rank} />
                      </div>
                      <div
                        className="rounded-full shrink-0"
                        style={{
                          width: 40,
                          height: 40,
                          background: `linear-gradient(135deg, ${gradientFor(r.gate_token_address).from}, ${gradientFor(r.gate_token_address).to})`,
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-3 mb-0.5 flex-wrap">
                          {r.gate_token_symbol && (
                            <div className="font-display text-[20px] font-medium tracking-[-0.01em] text-[var(--accent)]">
                              ${r.gate_token_symbol}
                            </div>
                          )}
                          <div className="font-display text-[16px] font-medium tracking-[-0.01em] text-white/85 truncate">
                            {r.name.replace(/^\$\S+\s·\s/, "")}
                          </div>
                        </div>
                        <div className="text-[11.5px] font-mono text-white/40 truncate">
                          #{r.slug} · launched {fmtAddr(r.creator_address)}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-5 text-right text-[12.5px] font-mono shrink-0">
                        <div>
                          <div className="text-white/85 leading-none font-display text-[18px] font-medium">
                            {r.shv}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-[var(--accent)] mt-1">
                            SHV
                          </div>
                        </div>
                        <div>
                          <div className="text-white/80 leading-none">{r.unique_signers_7d}</div>
                          <div className="text-[10px] uppercase tracking-wider text-white/35 mt-1">
                            signers
                          </div>
                        </div>
                        <div>
                          <div className="text-white/80 leading-none">{r.signed_messages_7d}</div>
                          <div className="text-[10px] uppercase tracking-wider text-white/35 mt-1">
                            7d msgs
                          </div>
                        </div>
                        <div>
                          <div className="text-white/80 leading-none">
                            {fmtAgo(r.last_message_ms)}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-white/35 mt-1">
                            last sig
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="border-t border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-14">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-3">
              how to climb
            </div>
            <h2 className="font-display text-3xl font-medium tracking-[-0.02em] mb-6">
              Holder velocity beats holder count.
            </h2>
            <div className="grid md:grid-cols-3 gap-6 text-[14.5px] text-white/75 leading-relaxed">
              <div>
                <div className="font-medium text-white mb-1.5">Get holders signing.</div>
                <p>
                  100 SHV per unique wallet that posts in your holder room
                  this week. A single chatty whale can&apos;t shove a
                  token to the top. Broad signer base wins.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">Stay active.</div>
                <p>
                  +50 SHV recency bonus when the last signed message in
                  your room was under an hour ago. Fades to 0 over 7
                  days. Sleeping rooms drop.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">Bring the holders.</div>
                <p>
                  Embed the room widget on your token site so visitors
                  arrive ready to chat. <code>/widget.js</code>, one
                  script tag, hold-to-chat enforced on-chain.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
