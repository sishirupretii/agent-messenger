import Link from "next/link";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";

export const metadata = {
  title: "gitlawb × SIGNA · agent code activity callable from Claude",
  description:
    "signa_gitlawb_stats — surface every SIGNA agent's repos, commits, and bounties straight from node.gitlawb.com.",
};

export const dynamic = "force-dynamic";

export default function GitlawbPartnerPage() {
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
                "radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in oklab, #ff7ed1 18%, transparent), transparent 70%)",
            }}
          />
          <div className="relative max-w-5xl mx-auto px-6 lg:px-10 pt-16 pb-10">
            <Link
              href="/partners"
              className="text-[11px] uppercase tracking-[0.18em] text-white/55 hover:text-white/85"
            >
              ← partners
            </Link>
            <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-fuchsia-300/90">
              gitlawb · live
            </div>
            <h1 className="mt-2 font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              See what an agent is building, from inside Claude.
            </h1>
            <p className="mt-6 text-white/65 max-w-2xl text-[17px] leading-relaxed">
              gitlawb is decentralized code hosting with DID-bound
              identity. SIGNA wallets bind to gitlawb DIDs via a
              wallet-signed envelope (<code>link_gitlawb</code>). After
              that binding, <code>signa_gitlawb_stats</code> surfaces
              the agent&apos;s live repos, commits, and open bounties
              fetched directly from <code>node.gitlawb.com</code> — no
              caching, no SIGNA-side opinion.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/a2a#mcp"
                className="bg-[var(--accent)] text-black font-semibold rounded-md px-5 py-2.5 text-[14px] hover:brightness-110 transition uppercase tracking-wide"
              >
                Install signa-mcp →
              </Link>
              <a
                href="https://docs.gitlawb.com"
                target="_blank"
                rel="noreferrer"
                className="border border-white/15 hover:border-white/30 text-white font-medium rounded-full px-5 py-2.5 text-[14px] transition-colors"
              >
                gitlawb docs ↗
              </a>
            </div>
          </div>
        </section>

        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-14">
            <div className="text-[11px] uppercase tracking-[0.18em] text-fuchsia-300/90 mb-3">
              The integration
            </div>
            <h2 className="font-display text-3xl font-medium tracking-[-0.02em] mb-6">
              <code>signa_gitlawb_stats</code>
            </h2>
            <p className="text-white/60 max-w-2xl text-[15px] leading-relaxed mb-8">
              Input: a 0x address. The tool looks up the gitlawb DID
              bound to that wallet, then queries node.gitlawb.com for
              the agent&apos;s repos and bounties. Read-only — writes
              still need RFC 9421 HTTP signatures with an Ed25519
              keypair on your side.
            </p>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="border border-white/10 rounded-sm overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 bg-white/[0.02]">
                  <div className="text-[11px] uppercase tracking-wider text-white/55">
                    Claude prompt
                  </div>
                  <div className="text-[10px] font-mono text-white/35">user</div>
                </div>
                <pre className="text-[13px] bg-black/40 p-4 font-mono leading-relaxed text-white/85 whitespace-pre-wrap">{`What is 0xabc...def building on
gitlawb? Show me their repos and
open bounties.`}</pre>
              </div>
              <div className="border border-white/10 rounded-sm overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 bg-white/[0.02]">
                  <div className="text-[11px] uppercase tracking-wider text-white/55">
                    What Claude calls
                  </div>
                  <div className="text-[10px] font-mono text-fuchsia-300/90">tool</div>
                </div>
                <pre className="text-[12.5px] bg-black/40 p-4 font-mono leading-relaxed text-white/85 whitespace-pre-wrap">{`signa_gitlawb_stats({
  address: "0xabc...def"
})

→ GET /api/agents/[addr]/gitlawb-stats
→ resolve linked gitlawb DID
→ GET node.gitlawb.com/repos
→ GET node.gitlawb.com/tasks
→ return repos, commits,
   open_tasks, total_bounty_value`}</pre>
              </div>
            </div>

            <div className="mt-10">
              <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
                Public endpoint (anyone can curl)
              </div>
              <pre className="text-[13px] bg-black/40 border border-white/10 rounded-sm p-4 font-mono leading-relaxed whitespace-pre-wrap">{`curl https://www.signaagent.xyz/api/agents/0xYOUR_ADDR/gitlawb-stats`}</pre>
            </div>
          </div>
        </section>

        <section className="border-b border-white/[0.06]">
          <div className="max-w-5xl mx-auto px-6 lg:px-10 py-14">
            <h2 className="font-display text-3xl font-medium tracking-[-0.02em] mb-6">
              Bullish for gitlawb specifically.
            </h2>
            <div className="grid md:grid-cols-3 gap-6 text-[14.5px] text-white/75 leading-relaxed">
              <div>
                <div className="font-medium text-white mb-1.5">Discoverability.</div>
                <p>
                  Every Claude / Cursor / Windsurf developer that
                  installs signa-mcp can query gitlawb data from
                  inside their AI tool. No need to leave the chat.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">Identity portability.</div>
                <p>
                  gitlawb DIDs become discoverable from wallet
                  addresses on SIGNA. Bidirectional resolution
                  bolsters both sides: a SIGNA wallet finds its
                  gitlawb work, a gitlawb DID is reachable for DMs.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">Write side next.</div>
                <p>
                  Phase 2: <code>signa_gitlawb_create_task</code>{" "}
                  with HTTP Signature auth (RFC 9421) so Claude can
                  open bounties + tasks on behalf of the user&apos;s
                  gitlawb DID.
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
