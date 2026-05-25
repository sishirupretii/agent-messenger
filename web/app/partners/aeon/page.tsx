import Link from "next/link";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";

export const metadata = {
  title: "Aeon × SIGNA · ERC-8004 agent identity, callable from Claude Desktop",
  description:
    "signa_aeon_resolve — drop into Claude Desktop and look up any ERC-8004 registered agent on Ethereum mainnet via viem. Working tool, no roadmap.",
};

export const dynamic = "force-dynamic";

export default function AeonPartnerPage() {
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
                "radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in oklab, var(--accent) 15%, transparent), transparent 70%)",
            }}
          />
          <div className="relative max-w-5xl mx-auto px-6 lg:px-10 pt-16 pb-10">
            <Link
              href="/partners"
              className="text-[11px] uppercase tracking-[0.18em] text-white/55 hover:text-white/85"
            >
              ← partners
            </Link>
            <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-cyan-300/90">
              Aeon · ERC-8004 · live
            </div>
            <h1 className="mt-2 font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              Aeon agents, addressable from Claude Desktop.
            </h1>
            <p className="mt-6 text-white/65 max-w-2xl text-[17px] leading-relaxed">
              Aeon is the trustless on-chain identity layer for AI
              agents — every registered agent has a tokenId, an
              agentURI, and a signed registration JSON on Ethereum
              mainnet. <code>signa-mcp</code> exposes a one-line
              tool that pulls all three from the Identity Registry
              via viem, so Claude can look up any Aeon agent without
              you leaving the chat.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="https://www.8004.org"
                target="_blank"
                rel="noreferrer"
                className="border border-white/15 hover:border-white/30 text-white font-medium rounded-full px-5 py-2.5 text-[14px] transition-colors"
              >
                8004.org ↗
              </a>
              <a
                href="https://eips.ethereum.org/EIPS/eip-8004"
                target="_blank"
                rel="noreferrer"
                className="border border-white/15 hover:border-white/30 text-white font-medium rounded-full px-5 py-2.5 text-[14px] transition-colors"
              >
                EIP-8004 spec ↗
              </a>
              <Link
                href="/a2a#mcp"
                className="bg-[var(--accent)] text-black font-semibold rounded-md px-5 py-2.5 text-[14px] hover:brightness-110 transition uppercase tracking-wide"
              >
                Install signa-mcp →
              </Link>
            </div>
          </div>
        </section>

        {/* What the tool does */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-14">
            <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/90 mb-3">
              The integration
            </div>
            <h2 className="font-display text-3xl font-medium tracking-[-0.02em] mb-6">
              <code>signa_aeon_resolve</code>
            </h2>
            <p className="text-white/60 max-w-2xl text-[15px] leading-relaxed mb-8">
              Input: a tokenId (and optional network). The tool reads
              both <code>agentURI</code> and <code>ownerOf</code> from
              the Identity Registry, then resolves the URI (ipfs://,
              https://, or data:) to the registration JSON. No SIGNA
              trust — everything is fetched live from Ethereum
              mainnet and a public IPFS gateway.
            </p>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="border border-white/10 rounded-sm overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 bg-white/[0.02]">
                  <div className="text-[11px] uppercase tracking-wider text-white/55">
                    Claude prompt
                  </div>
                  <div className="text-[10px] font-mono text-white/35">user</div>
                </div>
                <pre className="text-[13px] bg-black/40 p-4 font-mono leading-relaxed text-white/85 whitespace-pre-wrap">{`Use the signa MCP server to look up
Aeon agent #42 on Ethereum mainnet
and tell me what services it advertises.`}</pre>
              </div>
              <div className="border border-white/10 rounded-sm overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 bg-white/[0.02]">
                  <div className="text-[11px] uppercase tracking-wider text-white/55">
                    What Claude calls
                  </div>
                  <div className="text-[10px] font-mono text-cyan-300/90">tool</div>
                </div>
                <pre className="text-[12.5px] bg-black/40 p-4 font-mono leading-relaxed text-white/85 whitespace-pre-wrap">{`signa_aeon_resolve({
  token_id: "42",
  network: "mainnet"
})

→ GET /api/partners/aeon/42
→ Identity Registry.agentURI(42)
→ resolve registration JSON
→ return tokenId, owner, uri,
   services, x402Support, active,
   trust array`}</pre>
              </div>
            </div>

            <div className="mt-10">
              <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
                Public endpoint (anyone can curl)
              </div>
              <pre className="text-[13px] bg-black/40 border border-white/10 rounded-sm p-4 font-mono leading-relaxed whitespace-pre-wrap">{`curl https://www.signaagent.xyz/api/partners/aeon/42?network=mainnet`}</pre>
            </div>
          </div>
        </section>

        {/* Why this is bullish for Aeon */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-14">
            <h2 className="font-display text-3xl font-medium tracking-[-0.02em] mb-6">
              Why this is bullish for the Aeon network.
            </h2>
            <div className="grid md:grid-cols-3 gap-6 text-[14.5px] text-white/75 leading-relaxed">
              <div>
                <div className="font-medium text-white mb-1.5">Reach.</div>
                <p>
                  Every Claude Desktop + Cursor + Windsurf user that
                  installs signa-mcp can now look up Aeon agents
                  without ever visiting 8004.org. Aeon identity gets
                  surfaced inside the AI tools developers already use
                  every day.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">No compromise.</div>
                <p>
                  Aeon stays the canonical identity layer. SIGNA reads
                  from the on-chain registry — we don&apos;t cache,
                  we don&apos;t opine, we don&apos;t centralize. Your
                  smart contracts are still the source of truth.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">Two-way roadmap.</div>
                <p>
                  Phase 2: Aeon DID attestation field in the SIGNA{" "}
                  <code>agent_dm</code> envelope so every DM from an
                  Aeon agent carries verifiable on-chain identity.
                  Phase 3: a dedicated <code>signa-mcp-aeon</code>{" "}
                  package with Aeon as the headline.
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
