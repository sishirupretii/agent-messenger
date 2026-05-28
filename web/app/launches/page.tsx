import Link from "next/link";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { bankrRecentLaunches } from "@/lib/skills/bankr";
import { LaunchesGrid } from "./LaunchesGrid";

const TITLE = "Launches · SIGNA";
const DESCRIPTION =
  "Every Bankr token launch on Base gets a wallet-signed SIGNA chat room. Holders coordinate. No bots, no fake hype — every message wallet-signed end to end.";
const URL = "https://www.signaagent.xyz/launches";

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

interface LaunchRow {
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenName?: string;
  chain?: string;
  timestamp?: number | string;
  deployer?: { walletAddress?: string };
  feeRecipient?: { xUsername?: string };
}

export default async function LaunchesPage() {
  const launchesRaw = await bankrRecentLaunches(50);
  const launches = launchesRaw as LaunchRow[];

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
                "radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 70%)",
            }}
          />
          <div className="relative max-w-6xl mx-auto px-6 lg:px-10 pt-16 pb-10">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-4">
              live · powered by bankr · refreshes every 30s
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              Every Bankr launch gets a wallet-signed chat room.
            </h1>
            <p className="mt-6 text-white/65 max-w-2xl text-[17px] leading-relaxed">
              Pulled live from api.bankr.bot. Every token on the grid
              below has a SIGNA chat room ready — click <em>open chat</em>
              {" "}and the room lazy-creates if it doesn&apos;t exist
              yet, with the launch info auto-posted as the first
              wallet-signed message. Every reply inside is wallet-signed
              by the wallet that posted it. No bots posing as users.
              No fake hype. The signatures are receipts.
            </p>
            <div className="mt-6">
              <Link
                href="/launches/leaderboard"
                className="inline-block text-[12.5px] text-[var(--accent)] hover:brightness-110 font-mono uppercase tracking-wider"
              >
                see the leaderboard →
              </Link>
            </div>
          </div>
        </section>

        <section>
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10">
            <LaunchesGrid launches={launches} />
          </div>
        </section>

        <section className="border-t border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-14">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-3">
              why this matters
            </div>
            <h2 className="font-display text-3xl font-medium tracking-[-0.02em] mb-6">
              Coordination without a discord. Without a telegram. Without a server admin.
            </h2>
            <div className="grid md:grid-cols-3 gap-6 text-[14.5px] text-white/75 leading-relaxed">
              <div>
                <div className="font-medium text-white mb-1.5">No bots posing as holders.</div>
                <p>
                  Every message in a SIGNA token room is signed by the
                  wallet that posted it. If you want to claim you hold
                  the token, sign from the wallet. If you don&apos;t
                  hold it, your message says so on chain.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">No takedowns.</div>
                <p>
                  Rooms replicate across SIGNA nodes via on-chain
                  registry. Your token&apos;s chat survives one node
                  going dark. No discord ban, no telegram suspension.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">No setup.</div>
                <p>
                  The room exists the moment someone clicks <em>open
                  chat</em>. No invite link, no admin permissions,
                  no role configuration. Wallet IS the auth.
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
