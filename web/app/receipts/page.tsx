import Link from "next/link";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { getPartnerReceipts, type PartnerKey } from "@/lib/receipts";

const TITLE = "Receipts · SIGNA";
const DESCRIPTION =
  "Public ledger of wallet-signed activity SIGNA produces for Bankr, gitlawb, Aeon, and MiroShark. Counts the rooms, messages, and unique signers per partner network.";
const URL = "https://www.signaagent.xyz/receipts";

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

const TONE: Record<PartnerKey, string> = {
  bankr: "text-[var(--accent)] border-[var(--accent)]/40",
  gitlawb: "text-cyan-300 border-cyan-300/40",
  miroshark: "text-fuchsia-300 border-fuchsia-300/40",
  aeon: "text-emerald-300 border-emerald-300/40",
  community: "text-white/60 border-white/15",
};

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const diff = Date.now() - ms;
  const s = Math.max(1, Math.round(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export default async function ReceiptsPage() {
  const receipts = await getPartnerReceipts();
  const totals = receipts.reduce(
    (acc, r) => ({
      rooms: acc.rooms + r.rooms,
      messages: acc.messages + r.messages,
      posters: acc.posters + r.unique_posters,
    }),
    { rooms: 0, messages: 0, posters: 0 },
  );

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
              public ledger · live · refreshes every 60s
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              Receipts.
            </h1>
            <p className="mt-6 text-white/65 max-w-2xl text-[17px] leading-relaxed">
              Every wallet-signed room and message SIGNA produces for the
              Bankr, gitlawb, Aeon, and MiroShark networks, counted live.
              Each row classifies by partner so the team behind each one
              can see exactly what cross-network identity their users
              show up with on SIGNA. No tracking pixels, no analytics
              vendor — just rows in the database, each one signed by a
              real wallet.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-6 max-w-2xl">
              <Stat label="rooms" value={totals.rooms} />
              <Stat label="signed messages" value={totals.messages} />
              <Stat label="unique posters" value={totals.posters} />
            </div>
          </div>
        </section>

        <section>
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10">
            <div className="grid md:grid-cols-2 gap-4">
              {receipts.map((r) => (
                <Link
                  key={r.partner}
                  href={`/receipts/${r.partner}`}
                  className={`block border rounded-sm bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-colors ${TONE[r.partner]}`}
                >
                  <div className="flex items-baseline justify-between mb-2 gap-3">
                    <div className="font-display text-2xl font-medium tracking-[-0.015em] text-white">
                      {r.label}
                    </div>
                    <div className={`text-[10px] uppercase tracking-[0.18em] font-mono ${TONE[r.partner]}`}>
                      {r.partner} →
                    </div>
                  </div>
                  <p className="text-[13px] text-white/55 leading-relaxed mb-5">
                    {r.description}
                  </p>
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <SmallStat label="rooms" value={r.rooms} sub={`${r.rooms_7d} this week`} />
                    <SmallStat
                      label="messages"
                      value={r.messages}
                      sub={`${r.messages_7d} this week`}
                    />
                    <SmallStat label="signers" value={r.unique_posters} sub="unique" />
                    <SmallStat
                      label="last activity"
                      valueLabel={fmtAgo(r.last_activity)}
                      sub=""
                    />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-14">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-3">
              what this proves
            </div>
            <h2 className="font-display text-3xl font-medium tracking-[-0.02em] mb-6">
              The signature is the receipt. The ledger is public.
            </h2>
            <div className="grid md:grid-cols-3 gap-6 text-[14.5px] text-white/75 leading-relaxed">
              <div>
                <div className="font-medium text-white mb-1.5">No fake numbers.</div>
                <p>
                  Each message counted here returned a valid EIP-191
                  signature from the poster&apos;s wallet. Operators
                  can&apos;t inflate the count without holding the
                  private keys of the wallets that signed.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">No vendor lock-in.</div>
                <p>
                  The dataset is the signa_rooms and signa_room_messages
                  tables. Run your own SIGNA node, query the same data,
                  derive the same receipts. No Mixpanel, no Segment.
                </p>
              </div>
              <div>
                <div className="font-medium text-white mb-1.5">No middleman.</div>
                <p>
                  When SIGNA introduces a partner to their own community,
                  the proof of traffic is here, signed by real wallets,
                  not a screenshot we control.
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

function SmallStat({
  label,
  value,
  valueLabel,
  sub,
}: {
  label: string;
  value?: number;
  valueLabel?: string;
  sub: string;
}) {
  return (
    <div>
      <div className="font-display text-[18px] font-medium tracking-[-0.01em] leading-none text-white">
        {valueLabel ?? value ?? 0}
      </div>
      <div className="text-[10.5px] uppercase tracking-wider text-white/40 mt-1">
        {label}
      </div>
      {sub && <div className="text-[10.5px] text-white/30 mt-0.5">{sub}</div>}
    </div>
  );
}
