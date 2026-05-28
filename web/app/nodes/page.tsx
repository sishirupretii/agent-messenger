import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { listFederatedNodes, probeNode, SIGNA_NODE_REGISTRY } from "@/lib/onchain-nodes";

const TITLE = "Federated nodes · SIGNA";
const DESCRIPTION =
  "Every SIGNA node registered on the on-chain SignaNodeRegistry contract on Base mainnet. Open spec, permissionless join. The federation source of truth.";
const URL = "https://www.signaagent.xyz/nodes";

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

function fmtAddr(a: string): string {
  if (!a || a.length < 10) return a ?? "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtUnix(s: number): string {
  if (!s) return "—";
  return new Date(s * 1000).toISOString().slice(0, 10);
}

export default async function NodesPage() {
  // Probe all nodes server-side so the page renders with live state.
  const { nodes, total, active } = await listFederatedNodes(true, 100);
  const probed = await Promise.all(
    nodes.map(async (n) => ({ ...n, probe: await probeNode(n) })),
  );
  const reachable = probed.filter((n) => n.probe.reachable).length;

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
              federation · on-chain registry · base mainnet
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              SIGNA federates over an on-chain registry.
            </h1>
            <p className="mt-6 text-white/65 max-w-2xl text-[17px] leading-relaxed">
              Every SIGNA node registers itself on the{" "}
              <code className="text-white/85">SignaNodeRegistry</code>{" "}
              contract on Base. There is no central directory we
              control — anyone can read this list, anyone can register
              their own node, and consumers cross-verify each URL by
              hitting <code className="text-white/85">/api/node/info</code>{" "}
              and confirming the on-chain operator address matches.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-6 max-w-2xl">
              <Stat label="total" value={total} />
              <Stat label="active" value={active} />
              <Stat label="reachable now" value={reachable} />
            </div>
            <div className="mt-6 text-[11.5px] font-mono text-white/35 break-all">
              registry: {SIGNA_NODE_REGISTRY}
            </div>
          </div>
        </section>

        <section>
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10">
            {probed.length === 0 ? (
              <div className="border border-white/10 rounded-sm bg-white/[0.02] p-10 text-center text-white/55">
                No nodes registered on-chain yet.
              </div>
            ) : (
              <div className="space-y-3">
                {probed.map((n) => (
                  <div
                    key={n.operator}
                    className="border border-white/10 rounded-sm bg-white/[0.02] p-5"
                  >
                    <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
                      <div className="font-display text-[18px] font-medium tracking-[-0.01em]">
                        {n.name}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-mono">
                        {n.active ? (
                          <span className="text-[var(--accent)] border border-[var(--accent)]/40 px-1.5 py-0.5 rounded-sm">
                            active
                          </span>
                        ) : (
                          <span className="text-white/40 border border-white/15 px-1.5 py-0.5 rounded-sm">
                            inactive
                          </span>
                        )}
                        {n.probe.reachable ? (
                          <span className="text-emerald-300 border border-emerald-300/40 px-1.5 py-0.5 rounded-sm">
                            reachable · {n.probe.latency_ms}ms
                          </span>
                        ) : (
                          <span className="text-red-300 border border-red-400/40 px-1.5 py-0.5 rounded-sm">
                            unreachable
                          </span>
                        )}
                        {n.probe.operator_match === false && (
                          <span
                            title="The node's /api/node/info JSON declares a different operator address than the on-chain record. Treat with caution."
                            className="text-red-300 border border-red-400/40 px-1.5 py-0.5 rounded-sm"
                          >
                            operator mismatch
                          </span>
                        )}
                      </div>
                    </div>
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[13px] text-white/75 hover:text-white break-all font-mono mb-2"
                    >
                      {n.url}
                    </a>
                    <div className="grid sm:grid-cols-4 gap-3 text-[11.5px] font-mono text-white/45">
                      <div>
                        <div className="text-white/30">operator</div>
                        {fmtAddr(n.operator)}
                      </div>
                      <div>
                        <div className="text-white/30">on-chain version</div>
                        {n.version || "—"}
                      </div>
                      <div>
                        <div className="text-white/30">reported version</div>
                        {n.probe.reported_version ?? "—"}
                      </div>
                      <div>
                        <div className="text-white/30">registered</div>
                        {fmtUnix(n.registeredAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="border-t border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-14">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-3">
              run your own node
            </div>
            <h2 className="font-display text-3xl font-medium tracking-[-0.02em] mb-6">
              Permissionless. Self-hostable. One contract call to join.
            </h2>
            <div className="grid md:grid-cols-2 gap-x-10 gap-y-4 text-[14px] text-white/75 leading-relaxed">
              <div>
                <div className="font-medium text-white mb-1">1. Deploy a SIGNA node.</div>
                <p>
                  Clone the repo, point it at your own Postgres + RPC,
                  serve <code className="text-white/85">/api/node/info</code>{" "}
                  with your operator address. Any host works — Fly,
                  Railway, your own VPS.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1">2. Register on-chain.</div>
                <p>
                  From the operator wallet, call{" "}
                  <code className="text-white/85">register(name, url, version)</code>{" "}
                  on{" "}
                  <code className="text-white/85">{SIGNA_NODE_REGISTRY}</code>.
                  Costs ~30k gas (~$0.005 on Base). Your node appears
                  on this page within a minute.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1">3. Federate automatically.</div>
                <p>
                  Other nodes pull your signed activity every 10 minutes
                  via the federation cron. Re-verification happens at
                  every peer — bad signatures get dropped automatically.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1">4. Deregister any time.</div>
                <p>
                  Same operator wallet calls{" "}
                  <code className="text-white/85">deregister()</code>.
                  Your record stays in history; the active flag flips.
                  No admin can take it down for you.
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-display text-4xl font-medium tracking-[-0.02em]">{value}</div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/40 mt-1">{label}</div>
    </div>
  );
}
