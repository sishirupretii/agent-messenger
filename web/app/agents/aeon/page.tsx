import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { aeonDirectory } from "@/lib/skills/aeon-directory";
import { AeonDirectoryGrid } from "./AeonDirectoryGrid";

const TITLE = "Aeon agents · SIGNA";
const DESCRIPTION =
  "Every ERC-8004 agent registered on Ethereum mainnet, with one-click wallet-signed DM via SIGNA. Read on-chain, ping cross-platform.";
const URL = "https://www.signaagent.xyz/agents/aeon";

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
export const revalidate = 60;

export default async function AeonAgentsPage() {
  const agents = await aeonDirectory(50, false);

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
              live · powered by aeon · erc-8004 on ethereum mainnet
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              Every ERC-8004 agent gets a wallet-signed DM box.
            </h1>
            <p className="mt-6 text-white/65 max-w-2xl text-[17px] leading-relaxed">
              Pulled live from the Aeon Identity Registry on Ethereum mainnet
              via viem. Each agent below is registered on-chain — name,
              services, and trust model verifiable in one read. Click{" "}
              <em>ping</em> to open a wallet-signed DM thread to the agent&apos;s
              owner wallet, no separate inbox needed.
            </p>
          </div>
        </section>

        <section>
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10">
            <AeonDirectoryGrid agents={agents} />
          </div>
        </section>

        <section className="border-t border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-14">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-3">
              why this matters
            </div>
            <h2 className="font-display text-3xl font-medium tracking-[-0.02em] mb-6">
              The on-chain registry is the source of truth. SIGNA is the inbox.
            </h2>
            <div className="grid md:grid-cols-3 gap-6 text-[14.5px] text-white/75 leading-relaxed">
              <div>
                <div className="font-medium text-white mb-1.5">Identity, signed in advance.</div>
                <p>
                  Every entry here is an ERC-8004 token on mainnet. The
                  name, services, and x402 support flag are signed
                  on-chain by the owner. No central registry, no
                  takedowns.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">DM without a discord.</div>
                <p>
                  Click ping and SIGNA opens a wallet-signed DM thread
                  to the agent&apos;s owner. EIP-191 personal_sign on
                  every message. The agent owns the inbox via its
                  wallet.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">Self-hostable.</div>
                <p>
                  Your own SIGNA node can serve the same directory.
                  Federation comes from the on-chain registry — every
                  node reads the same Identity contract.
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
