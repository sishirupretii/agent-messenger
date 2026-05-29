import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { findByTokenAddress } from "@/lib/token-score";
import { TokenWarsClient } from "./TokenWarsClient";

export const dynamic = "force-dynamic";
export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  const token = await findByTokenAddress(address);
  const symbol = token?.gate_token_symbol ?? "TOKEN";
  const rank = token?.rank ?? "—";
  const TITLE = token
    ? `$${symbol} · Rank #${rank} · SIGNA Token Wars`
    : `Token Wars · SIGNA`;
  const DESCRIPTION = token
    ? `$${symbol} has Signed Holder Velocity ${token.shv} with ${token.unique_signers_7d} unique signers and ${token.signed_messages_7d} signed messages this week.`
    : `Token Wars leaderboard on SIGNA — every Bankr launch ranked by Signed Holder Velocity.`;
  const URL = `https://www.signaagent.xyz/token-wars/${address.toLowerCase()}`;
  return {
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
}

function fmtAddr(a: string): string {
  if (!a || a.length < 10) return a ?? "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

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

function gradientFor(addr: string): { from: string; to: string } {
  const a = (addr ?? "0x0").toLowerCase().replace(/^0x/, "").padEnd(8, "0");
  const h1 = parseInt(a.slice(0, 4), 16) % 360;
  const h2 = parseInt(a.slice(4, 8), 16) % 360;
  return { from: `hsl(${h1} 72% 56%)`, to: `hsl(${h2} 65% 42%)` };
}

export default async function TokenWarsTokenPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) notFound();
  const token = await findByTokenAddress(address);
  if (!token) notFound();

  const grad = gradientFor(address);
  const symbol = token.gate_token_symbol ?? "TOKEN";
  const buyUrl =
    token.gate_chain?.toLowerCase() === "base"
      ? `https://aerodrome.finance/swap?to=${address}`
      : token.gate_chain?.toLowerCase() === "solana"
        ? `https://jup.ag/swap/SOL-${address}`
        : `https://www.geckoterminal.com/${token.gate_chain ?? "base"}/pools/${address}`;

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="relative border-b border-white/[0.06]">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-60"
            style={{
              background: `radial-gradient(ellipse 60% 60% at 50% 0%, ${grad.from}33, transparent 70%)`,
            }}
          />
          <div className="relative max-w-5xl mx-auto px-6 lg:px-10 pt-16 pb-12">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-4">
              <Link href="/token-wars" className="hover:text-white">
                ← token wars
              </Link>
            </div>

            <div className="flex items-start gap-5">
              <div
                className="rounded-full shrink-0"
                style={{
                  width: 80,
                  height: 80,
                  background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-4 flex-wrap">
                  <h1 className="font-display text-5xl sm:text-6xl font-medium tracking-[-0.025em] leading-none text-[var(--accent)]">
                    ${symbol}
                  </h1>
                  <div className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.025em] leading-none text-white/30">
                    #{token.rank}
                  </div>
                </div>
                <div className="mt-3 text-[15px] text-white/65 leading-relaxed max-w-2xl">
                  {token.name.replace(/^\$\S+\s·\s/, "")}
                </div>
                <div className="mt-1 text-[11.5px] font-mono text-white/40">
                  {address} · {token.gate_chain}
                </div>
              </div>
            </div>

            <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-6">
              <Stat label="Signed Holder Velocity" value={token.shv.toLocaleString()} highlight />
              <Stat label="Unique signers (7d)" value={token.unique_signers_7d.toString()} />
              <Stat label="Signed messages (7d)" value={token.signed_messages_7d.toString()} />
              <Stat label="Last signature" value={fmtAgo(token.last_message_ms)} />
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href={`/rooms/${token.slug}`}
                className="bg-[var(--accent)] text-black font-semibold rounded-full px-5 py-2.5 text-[14px] hover:brightness-110 transition uppercase tracking-wide"
              >
                open ${symbol} room →
              </Link>
              <a
                href={buyUrl}
                target="_blank"
                rel="noreferrer"
                className="border border-white/15 hover:border-white/30 text-white font-medium rounded-full px-5 py-2.5 text-[14px] transition-colors"
              >
                buy ${symbol} (climb the board)
              </a>
              <TokenWarsClient
                symbol={symbol}
                rank={token.rank}
                shv={token.shv}
                signers7d={token.unique_signers_7d}
                msgs7d={token.signed_messages_7d}
                tokenAddress={address}
              />
            </div>
          </div>
        </section>

        <section>
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/45 mb-4">
              score breakdown
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Breakdown
                label="100 · unique signers (7d)"
                detail={`${token.unique_signers_7d} signers × 100 = ${token.unique_signers_7d * 100}`}
              />
              <Breakdown
                label="10 · signed messages (7d)"
                detail={`${token.signed_messages_7d} msgs × 10 = ${token.signed_messages_7d * 10}`}
              />
              <Breakdown
                label="1 · all-time signed messages"
                detail={`${token.signed_messages_total} msgs × 1 = ${token.signed_messages_total}`}
              />
              <Breakdown
                label="+ recency bonus"
                detail={`+${token.recency_bonus} (decays from +50 at 1h to 0 at 7d)`}
              />
            </div>
            <div className="mt-4 text-[12.5px] font-mono text-white/45">
              total = {token.shv.toLocaleString()} SHV
            </div>
          </div>
        </section>

        <section className="border-t border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-12">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-3">
              embed this room on your site
            </div>
            <p className="text-[14px] text-white/65 leading-relaxed max-w-2xl mb-4">
              Drop the chat onto your token landing page, your Aerodrome
              listing, your Farcaster mini-app. Visitors arrive, connect
              their wallet, and post if they hold the token. One tag.
            </p>
            <pre className="bg-black/40 border border-white/10 rounded-sm p-4 text-[12px] font-mono text-white/85 overflow-x-auto">
{`<div data-signa-room="${token.slug}" style="height:560px"></div>
<script src="https://www.signaagent.xyz/widget.js" defer></script>`}
            </pre>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div
        className={`font-display ${highlight ? "text-5xl text-[var(--accent)]" : "text-4xl text-white"} font-medium tracking-[-0.02em] leading-none tabular-nums`}
      >
        {value}
      </div>
      <div className="mt-2 text-[11px] uppercase tracking-[0.16em] text-white/45">
        {label}
      </div>
    </div>
  );
}

function Breakdown({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="border border-white/10 rounded-sm bg-white/[0.02] p-3">
      <div className="text-[12.5px] text-white/80 font-mono">{label}</div>
      <div className="text-[11.5px] text-white/45 font-mono mt-1">{detail}</div>
    </div>
  );
}
