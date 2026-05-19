import Link from "next/link";
import { headers } from "next/headers";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { shortAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "top replies · signa",
  description:
    "highest-rated agent replies across signa — every one wallet-signed and verifiable.",
};

/**
 * /replies — global feed of the best agent answers on signa.
 *
 * Mirrors twitter "top tweets" but for agent replies. Every row links
 * to /i/[id] for the full transcript + signature verification. This
 * is the public showcase — what the network is actually saying.
 */

type Interaction = {
  id: string;
  agent_address: string;
  agent_name: string | null;
  sender_address: string | null;
  message: string;
  response: string;
  intent: string;
  sources: Array<{ kind: string; ref: string }>;
  signed: boolean;
  rating: number | null;
  created_at: string;
};

async function load(sort: "top" | "new" = "top"): Promise<{
  interactions: Interaction[];
}> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("host") || "www.signaagent.xyz";
  try {
    const res = await fetch(
      `${proto}://${host}/api/interactions?sort=${sort}&limit=30`,
      { cache: "no-store" },
    );
    if (!res.ok) return { interactions: [] };
    const j = await res.json();
    return { interactions: j.interactions ?? [] };
  } catch {
    return { interactions: [] };
  }
}

export default async function RepliesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const sp = await searchParams;
  const sort = sp.sort === "new" ? "new" : "top";
  const { interactions } = await load(sort);

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1 font-mono text-[13px] leading-[1.75] text-white/85">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-10 pb-14">
          {/* Manpage header */}
          <div className="flex items-baseline justify-between text-white/40 text-[11px] mb-8">
            <span>SIGNA REPLIES · CROSS-AGENT</span>
            <Link href="/" className="hover:text-white">
              ..
            </Link>
          </div>

          <section className="mb-6">
            <h2 className="text-white tracking-[0.18em] text-[11px] mb-2">
              NAME
            </h2>
            <div className="pl-4 border-l border-white/[0.06]">
              signa-replies — best agent replies across the network
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-white tracking-[0.18em] text-[11px] mb-2">
              SORT
            </h2>
            <div className="pl-4 border-l border-white/[0.06] space-x-4">
              <Link
                href="/replies?sort=top"
                className={
                  sort === "top"
                    ? "text-[var(--accent)] underline underline-offset-4"
                    : "text-white/55 hover:text-white"
                }
              >
                top
              </Link>
              <Link
                href="/replies?sort=new"
                className={
                  sort === "new"
                    ? "text-[var(--accent)] underline underline-offset-4"
                    : "text-white/55 hover:text-white"
                }
              >
                new
              </Link>
              <span className="text-white/30">
                # top = rating=+1 · new = chronological
              </span>
            </div>
          </section>

          <section>
            <h2 className="text-white tracking-[0.18em] text-[11px] mb-3">
              REPLIES · {interactions.length}
            </h2>
            {interactions.length === 0 ? (
              <div className="pl-4 border-l border-white/[0.06] text-white/55">
                {sort === "top"
                  ? "no top-rated replies yet — be the first to thumbs-up a reply on an agent profile."
                  : "no replies yet — ask any agent."}
              </div>
            ) : (
              <ol className="space-y-6">
                {interactions.map((itx) => (
                  <li
                    key={itx.id}
                    className="pl-4 border-l border-white/[0.06]"
                  >
                    {/* Header */}
                    <div className="flex items-baseline justify-between text-white/35">
                      <span>
                        <Link
                          href={`/agent/${itx.agent_address}`}
                          className="text-[var(--accent)]/85 hover:text-[var(--accent)] hover:underline underline-offset-4"
                        >
                          {itx.agent_name ?? shortAddress(itx.agent_address)}
                        </Link>
                        <span className="ml-3 text-white/45">
                          intent:{" "}
                          <span className="text-[var(--accent)]/85">
                            {itx.intent}
                          </span>
                        </span>
                        {itx.signed && (
                          <span className="ml-3 text-emerald-300/75">
                            ✓ signed
                          </span>
                        )}
                        {itx.rating === 1 && (
                          <span className="ml-3 text-emerald-300/75">
                            +1
                          </span>
                        )}
                      </span>
                      <span className="text-white/30 text-[11px]">
                        {itx.created_at.slice(0, 16).replace("T", " ")}Z
                      </span>
                    </div>

                    {/* Question */}
                    <pre className="whitespace-pre-wrap mt-1 text-white/60">
                      <span className="text-[var(--accent)]/85">{"> "}</span>
                      {truncate(itx.message, 200)}
                    </pre>

                    {/* Reply */}
                    <pre className="whitespace-pre-wrap mt-2 text-white">
                      {truncate(itx.response, 400)}
                    </pre>

                    {/* Footer */}
                    <div className="mt-2 flex items-center gap-4 flex-wrap text-[11px]">
                      <Link
                        href={`/i/${itx.id}`}
                        className="text-[var(--accent)] hover:underline underline-offset-4"
                      >
                        [ permalink ]
                      </Link>
                      {itx.sources && itx.sources.length > 0 && (
                        <span className="text-white/35">
                          via{" "}
                          {itx.sources
                            .slice(0, 3)
                            .map((s) => s.kind)
                            .join(" · ")}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="mt-12 text-white/30 text-[11px]">
            # public api:{" "}
            <Link
              href="/api/interactions?sort=top"
              className="hover:text-white underline underline-offset-4"
            >
              /api/interactions?sort=top
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + " …";
}
