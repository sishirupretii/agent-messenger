import Link from "next/link";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";

export const metadata = {
  title: "Bankr × SIGNA · agent wallet + token launches, callable from Claude",
  description:
    "signa_bankr_resolve and signa_bankr_launches — Bankr's address resolver and Clanker/Raydium launch feed, wrapped as MCP tools that work without API keys.",
};

export const dynamic = "force-dynamic";
export const revalidate = 60;

const BASE_URL = process.env.NEXT_PUBLIC_SIGNA_BASE_URL ?? "https://www.signaagent.xyz";

interface BankrLaunch {
  tokenName?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  chain?: string;
  timestamp?: number | string;
  deployer?: { walletAddress?: string };
  feeRecipient?: { xUsername?: string };
}

async function fetchRecentLaunches(): Promise<BankrLaunch[]> {
  try {
    const r = await fetch(`${BASE_URL}/api/partners/bankr/launches?limit=6`, {
      next: { revalidate: 60 },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.launches ?? []) as BankrLaunch[];
  } catch {
    return [];
  }
}

function fmtAddress(addr: string | undefined): string {
  if (!addr || addr.length < 10) return addr ?? "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtTimestamp(ts: number | string | undefined): string {
  if (!ts) return "—";
  try {
    const ms = typeof ts === "number" ? ts : Number(ts);
    if (!Number.isFinite(ms)) return String(ts).slice(0, 19);
    const d = new Date(ms);
    return d.toISOString().replace("T", " ").slice(0, 16);
  } catch {
    return String(ts);
  }
}

export default async function BankrPartnerPage() {
  const launches = await fetchRecentLaunches();

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
                "radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in oklab, #66f0a2 18%, transparent), transparent 70%)",
            }}
          />
          <div className="relative max-w-5xl mx-auto px-6 lg:px-10 pt-16 pb-10">
            <Link
              href="/partners"
              className="text-[11px] uppercase tracking-[0.18em] text-white/55 hover:text-white/85"
            >
              ← partners
            </Link>
            <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-emerald-300/90">
              Bankr · live
            </div>
            <h1 className="mt-2 font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              Bankr token launches, in Claude Desktop.
            </h1>
            <p className="mt-6 text-white/65 max-w-2xl text-[17px] leading-relaxed">
              Two Bankr tools wrapped as MCP calls. Resolve any social
              handle (ENS, Twitter, Farcaster, raw 0x) to its on-chain
              wallet, or list the most recent token launches on Base
              and Solana via Bankr&apos;s Clanker + Raydium pipelines.
              No API key. No auth. The wrappers point at{" "}
              <code>api.bankr.bot</code> directly.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/a2a#mcp"
                className="bg-[var(--accent)] text-black font-semibold rounded-md px-5 py-2.5 text-[14px] hover:brightness-110 transition uppercase tracking-wide"
              >
                Install signa-mcp →
              </Link>
              <a
                href={`${BASE_URL}/api/partners/bankr/launches`}
                target="_blank"
                rel="noreferrer"
                className="border border-white/15 hover:border-white/30 text-white font-medium rounded-full px-5 py-2.5 text-[14px] transition-colors"
              >
                Public endpoint ↗
              </a>
            </div>
          </div>
        </section>

        {/* Live launches table */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-14">
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300/90 mb-3">
              live · refreshed every 60s
            </div>
            <h2 className="font-display text-3xl font-medium tracking-[-0.02em] mb-6">
              Recent Bankr launches.
            </h2>
            {launches.length === 0 ? (
              <p className="text-white/55 text-[14px]">
                Bankr launch feed temporarily empty. The data is
                fetched live from <code>api.bankr.bot/token-launches</code>;
                refresh in a minute.
              </p>
            ) : (
              <div className="border border-white/10 rounded-sm overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead className="bg-white/[0.03] text-white/55 text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2.5">symbol</th>
                      <th className="text-left px-3 py-2.5">name</th>
                      <th className="text-left px-3 py-2.5">chain</th>
                      <th className="text-left px-3 py-2.5">address</th>
                      <th className="text-left px-3 py-2.5">deployer</th>
                      <th className="text-left px-3 py-2.5">when</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {launches.map((l, i) => (
                      <tr key={i} className="hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5 font-mono text-emerald-300/90">
                          ${l.tokenSymbol ?? "?"}
                        </td>
                        <td className="px-3 py-2.5 text-white/85">
                          {l.tokenName ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-white/55 lowercase">
                          {l.chain ?? "?"}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-white/55">
                          {fmtAddress(l.tokenAddress)}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-white/55">
                          {l.feeRecipient?.xUsername
                            ? `@${l.feeRecipient.xUsername}`
                            : fmtAddress(l.deployer?.walletAddress)}
                        </td>
                        <td className="px-3 py-2.5 text-white/45 font-mono">
                          {fmtTimestamp(l.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Tools */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-14">
            <h2 className="font-display text-3xl font-medium tracking-[-0.02em] mb-8">
              Two MCP tools.
            </h2>
            <div className="space-y-6">
              <ToolCard
                name="signa_bankr_resolve"
                desc='Resolve ENS / Twitter / Farcaster / 0x address via api.bankr.bot.'
                prompt={`"Use Bankr to resolve vitalik.eth to a wallet, then DM that wallet 'gm from claude'"`}
              />
              <ToolCard
                name="signa_bankr_launches"
                desc="Recent token launches via Clanker (Base) and Raydium (Solana)."
                prompt={`"Show me the last 3 token launches on Base via Bankr"`}
              />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function ToolCard({
  name,
  desc,
  prompt,
}: {
  name: string;
  desc: string;
  prompt: string;
}) {
  return (
    <div className="border border-white/10 rounded-sm p-5 bg-white/[0.02]">
      <div className="font-mono text-[15px] text-emerald-300/90 mb-1.5">{name}</div>
      <p className="text-[13.5px] text-white/65 leading-relaxed mb-3">{desc}</p>
      <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">try in Claude:</div>
      <pre className="text-[12.5px] bg-black/40 p-3 rounded-sm font-mono text-white/85 whitespace-pre-wrap">{prompt}</pre>
    </div>
  );
}
