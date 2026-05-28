import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { getPartnerDetail, isPartnerKey, type PartnerKey } from "@/lib/receipts";

export const dynamic = "force-dynamic";
export const revalidate = 60;

const TONE: Record<PartnerKey, string> = {
  bankr: "text-[var(--accent)] border-[var(--accent)]/40",
  gitlawb: "text-cyan-300 border-cyan-300/40",
  miroshark: "text-fuchsia-300 border-fuchsia-300/40",
  aeon: "text-emerald-300 border-emerald-300/40",
  community: "text-white/60 border-white/15",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ partner: string }>;
}) {
  const { partner } = await params;
  if (!isPartnerKey(partner)) {
    return { title: "Partner receipts · SIGNA" };
  }
  const detail = await getPartnerDetail(partner);
  const TITLE = `${detail.label} · SIGNA receipts`;
  const DESCRIPTION = `${detail.totals.rooms} wallet-signed rooms, ${detail.totals.messages} signed messages, ${detail.totals.unique_posters} unique signers produced for ${detail.label} via SIGNA.`;
  const URL = `https://www.signaagent.xyz/receipts/${partner}`;
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

function fmtTimeMs(ms: number | null): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
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

export default async function PartnerReceiptPage({
  params,
}: {
  params: Promise<{ partner: string }>;
}) {
  const { partner } = await params;
  if (!isPartnerKey(partner)) notFound();

  const detail = await getPartnerDetail(partner);
  const toneClass = TONE[partner];

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
            <div className={`text-[11px] uppercase tracking-[0.18em] ${toneClass} mb-4`}>
              receipts · {partner}
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              {detail.label} on SIGNA.
            </h1>
            <p className="mt-6 text-white/65 max-w-2xl text-[17px] leading-relaxed">
              {detail.description} Every count below is backed by a real
              EIP-191 signature on a real wallet. Click any message to
              re-verify it on prod.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-6 max-w-2xl">
              <Stat label="rooms" value={detail.totals.rooms} />
              <Stat label="signed messages" value={detail.totals.messages} />
              <Stat label="unique signers" value={detail.totals.unique_posters} />
            </div>
            <div className="mt-6">
              <Link
                href="/receipts"
                className="text-[12.5px] text-white/55 hover:text-white"
              >
                ← all partners
              </Link>
            </div>
          </div>
        </section>

        <section className="border-b border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/45 mb-4">
              rooms · {detail.rooms.length}
            </div>
            {detail.rooms.length === 0 ? (
              <div className="border border-white/10 rounded-sm bg-white/[0.02] p-8 text-center text-white/55">
                No rooms classified to {detail.label} yet. Activity flows in
                automatically the moment the partner network produces traffic
                signed through SIGNA.
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {detail.rooms.map((r) => (
                  <Link
                    key={r.id}
                    href={`/rooms/${r.slug}`}
                    className="border border-white/10 hover:border-white/25 transition rounded-sm bg-white/[0.02] p-4 flex flex-col gap-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-display text-[17px] font-medium tracking-[-0.01em] truncate">
                        {r.name}
                      </div>
                      <div className="text-[10.5px] font-mono text-white/40">
                        #{r.slug}
                      </div>
                    </div>
                    {r.description && (
                      <div className="text-[12.5px] text-white/55 line-clamp-2 leading-relaxed">
                        {r.description}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[11px] font-mono text-white/40 mt-1">
                      <span>{r.message_count} signed</span>
                      <span>{fmtAgo(r.last_message_ts)}</span>
                    </div>
                    <div className="text-[10.5px] font-mono text-white/30">
                      created by {fmtAddr(r.creator_address)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/45 mb-4">
              recent signed messages · {detail.recent_messages.length}
            </div>
            {detail.recent_messages.length === 0 ? (
              <div className="text-[13px] text-white/45">
                No messages yet.
              </div>
            ) : (
              <div className="space-y-3">
                {detail.recent_messages.map((m) => (
                  <div
                    key={m.id}
                    className="border border-white/10 rounded-sm bg-white/[0.02] p-4"
                  >
                    <div className="flex items-baseline justify-between mb-2">
                      <Link
                        href={`/rooms/${m.room_slug}`}
                        className="text-[11px] uppercase tracking-wider text-white/55 hover:text-white"
                      >
                        #{m.room_slug}
                      </Link>
                      <div className="text-[10.5px] font-mono text-white/35">
                        {fmtTimeMs(m.ts)}
                      </div>
                    </div>
                    <div className="font-mono text-[11px] text-white/50 mb-2">
                      {fmtAddr(m.from_address)}
                    </div>
                    <div className="text-[13.5px] text-white/80 leading-relaxed whitespace-pre-wrap break-words">
                      {m.body.slice(0, 600)}
                      {m.body.length > 600 ? "…" : ""}
                    </div>
                    <div className="mt-3 text-[10.5px] font-mono text-white/30 truncate">
                      sig: {m.signature.slice(0, 12)}…{m.signature.slice(-10)}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
