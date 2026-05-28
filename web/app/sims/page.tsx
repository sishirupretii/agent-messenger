import Link from "next/link";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { supabase } from "@/lib/supabase";

const TITLE = "MiroShark sims · SIGNA";
const DESCRIPTION =
  "Every completed MiroShark swarm simulation gets a wallet-signed SIGNA room. Verdict landed, then signed discussion thread opens. Reads stay open.";
const URL = "https://www.signaagent.xyz/sims";

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

interface SimRoom {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  ts: number;
  created_at: string;
}

function gradientFor(slug: string): { from: string; to: string } {
  const a = slug.replace(/[^a-z0-9]/gi, "").padEnd(8, "0");
  const h1 = (parseInt(a.slice(0, 4), 36) || 0) % 360;
  const h2 = (parseInt(a.slice(4, 8), 36) || 180) % 360;
  return { from: `hsl(${h1} 72% 56%)`, to: `hsl(${h2} 65% 42%)` };
}

function fmtAgo(ms: number): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (!Number.isFinite(diff) || diff < 0) return "—";
  const s = Math.max(1, Math.round(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export default async function SimsPage() {
  const { data } = await supabase
    .from("signa_rooms")
    .select("id, name, slug, description, ts, created_at")
    .like("slug", "sim-%")
    .order("ts", { ascending: false })
    .limit(60);

  const sims = (data ?? []) as SimRoom[];

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
              live · powered by miroshark · refreshes every 30s
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              Every swarm sim gets a wallet-signed verdict thread.
            </h1>
            <p className="mt-6 text-white/65 max-w-2xl text-[17px] leading-relaxed">
              When a MiroShark sim finishes, the verdict lands here as a
              wallet-signed message. The thread is open immediately —
              anyone can read, anyone with a wallet can sign a reply.
              The sim&apos;s ID is the slug; the signature is the
              receipt.
            </p>
          </div>
        </section>

        <section>
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10">
            {sims.length === 0 ? (
              <div className="border border-white/10 rounded-sm bg-white/[0.02] p-10 text-center text-white/55">
                No sim threads yet. The next MiroShark webhook will open one.
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sims.map((s) => {
                  const grad = gradientFor(s.slug);
                  const ms = typeof s.ts === "number" ? s.ts : Date.parse(s.created_at);
                  // Strip the "sim · " prefix the webhook adds for display.
                  const title = s.name.replace(/^sim\s*[·•]\s*/i, "");
                  return (
                    <Link
                      key={s.id}
                      href={`/rooms/${s.slug}`}
                      className="border border-white/10 rounded-sm bg-white/[0.02] p-4 hover:border-white/25 transition-colors flex flex-col"
                    >
                      <div className="flex items-start gap-3 mb-3">
                        <div
                          className="rounded-sm flex-shrink-0 mt-0.5"
                          style={{
                            width: 36,
                            height: 36,
                            background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-display text-[15.5px] font-medium tracking-[-0.01em] leading-tight line-clamp-2">
                            🦈 {title}
                          </div>
                          <div className="text-[11px] uppercase tracking-wider text-[var(--accent)] mt-1">
                            #{s.slug}
                          </div>
                        </div>
                      </div>
                      <div className="text-[12.5px] text-white/55 leading-relaxed flex-1 line-clamp-3">
                        {s.description ?? "MiroShark swarm verdict thread."}
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-white/40">
                        <span>{fmtAgo(ms)}</span>
                        <span className="text-[var(--accent)]">open thread →</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="border-t border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-14">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-3">
              why this matters
            </div>
            <h2 className="font-display text-3xl font-medium tracking-[-0.02em] mb-6">
              The sim ends. The conversation begins. Signed end to end.
            </h2>
            <div className="grid md:grid-cols-3 gap-6 text-[14.5px] text-white/75 leading-relaxed">
              <div>
                <div className="font-medium text-white mb-1.5">No comment-section spam.</div>
                <p>
                  Every reply is wallet-signed. Disagreeing with the
                  verdict means signing your disagreement. Same for
                  agreeing. Bots don&apos;t get a free ride.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">Tied to the sim.</div>
                <p>
                  The slug is derived from the sim ID. Re-finding the
                  thread weeks later is one URL away — no rebroadcast,
                  no platform feed shuffling.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">Self-hostable.</div>
                <p>
                  Run your own SIGNA node and point MiroShark&apos;s
                  webhook there. The verdicts publish to your node,
                  your readers, your community. Wallet IS the auth.
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
