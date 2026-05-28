import { notFound } from "next/navigation";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { aeonAgentRegistration } from "@/lib/skills/aeon";
import { AeonHandshakeClient } from "./AeonHandshakeClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}) {
  const { tokenId } = await params;
  return {
    title: `Aeon handshake · #${tokenId} · SIGNA`,
    description: `Wallet-signed handshake DM to ERC-8004 agent #${tokenId} on Ethereum mainnet via SIGNA.`,
  };
}

export default async function AeonHandshakePage({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}) {
  const { tokenId } = await params;
  if (!/^\d+$/.test(tokenId)) notFound();

  const reg = await aeonAgentRegistration(BigInt(tokenId), "mainnet");
  if (!reg) notFound();

  const r = reg.registration ?? {};
  const services = Array.isArray(r.services) ? r.services : [];

  // Pre-built handshake body — the user signs this with their wallet.
  // Format mirrors the conventions in lib/feed-types.ts agent_dm so the
  // recipient sees a structured, recognizable preimage.
  const handshakeTemplate = [
    `gm. handshake from a SIGNA wallet.`,
    ``,
    `you are registered as ERC-8004 agent #${tokenId}`,
    `on the Aeon Identity Registry (Ethereum mainnet).`,
    `i'm reaching you through your on-chain owner wallet.`,
    ``,
    `signed end to end. reply via SIGNA inbox or your own bridge.`,
  ].join("\n");

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-16 pb-10">
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300 mb-4">
              aeon handshake · erc-8004 · mainnet
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-[-0.025em] leading-[1.0]">
              {r.name ?? `Agent #${tokenId}`}
            </h1>
            <p className="mt-4 text-[14px] text-white/55 leading-relaxed">
              {r.description ?? "No description set on-chain."}
            </p>
            <div className="mt-6 grid sm:grid-cols-2 gap-3 text-[11.5px] font-mono text-white/45">
              <div>
                <div className="text-white/30 uppercase tracking-wider mb-0.5">
                  token id
                </div>
                #{tokenId}
              </div>
              <div>
                <div className="text-white/30 uppercase tracking-wider mb-0.5">
                  owner wallet
                </div>
                <span className="break-all text-white/75">{reg.owner}</span>
              </div>
              <div>
                <div className="text-white/30 uppercase tracking-wider mb-0.5">
                  services
                </div>
                {services.length} declared
              </div>
              <div>
                <div className="text-white/30 uppercase tracking-wider mb-0.5">
                  x402 support
                </div>
                {r.x402Support ? "yes" : "no"}
              </div>
            </div>
            {services.length > 0 && (
              <div className="mt-4 border border-white/10 rounded-sm bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">
                  declared services
                </div>
                <div className="space-y-1 text-[11.5px] font-mono">
                  {services.map((s, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="text-emerald-300 w-16 shrink-0">
                        {s.name ?? "?"}
                      </div>
                      <div className="text-white/55 break-all">
                        {s.endpoint ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="max-w-3xl mx-auto px-6 lg:px-10 py-10">
            <AeonHandshakeClient
              tokenId={tokenId}
              recipient={reg.owner}
              defaultBody={handshakeTemplate}
            />
          </div>
        </section>

        <section className="border-t border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 py-10 text-[13px] text-white/55 leading-relaxed">
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300 mb-2">
              what happens when you sign
            </div>
            Your wallet signs a SIGNA <code className="text-white/85">agent_dm</code>{" "}
            envelope addressed to{" "}
            <code className="text-white/85">{reg.owner.slice(0, 10)}…{reg.owner.slice(-6)}</code>.
            The signature is verified server-side against{" "}
            <code className="text-white/85">from_address</code>, the DM
            lands in the agent owner&apos;s SIGNA inbox, and replies
            come back to your wallet. No new account, no email, no
            password — your wallet is the identity.
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
