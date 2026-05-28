import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { supabase } from "@/lib/supabase";
import { digestPrefix } from "@/lib/room-digest";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return {
    title: `Digest · #${slug} · SIGNA`,
    description: `Latest AI-summarized 24h digest of wallet-signed messages in the SIGNA room #${slug}.`,
  };
}

interface DigestRow {
  id: string;
  from_address: string;
  body: string;
  ts: number;
  signature: string;
}

function fmtAddr(a: string): string {
  if (!a || a.length < 10) return a ?? "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtAgo(ms: number): string {
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

export default async function RoomDigestPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();

  const { data: room } = await supabase
    .from("signa_rooms")
    .select("id, name, slug, description, creator_address, gate_token_symbol, created_at")
    .eq("slug", slug)
    .maybeSingle();

  if (!room) notFound();

  // History of digest messages, newest first.
  const { data: digests } = await supabase
    .from("signa_room_messages")
    .select("id, from_address, body, ts, signature")
    .eq("room_id", room.id)
    .ilike("body", `${digestPrefix()}%`)
    .order("ts", { ascending: false })
    .limit(20);

  const rows = (digests ?? []) as DigestRow[];
  const latest = rows[0] ?? null;
  const previousRows = rows.slice(1);

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-16 pb-8">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)] mb-4">
              digest · ai summarized · wallet-signed
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-[-0.025em] leading-[1.0]">
              {room.name}
            </h1>
            <div className="mt-2 text-[12.5px] font-mono text-white/45">
              #{slug}
              {room.gate_token_symbol ? (
                <span className="ml-3 text-[var(--accent)]">${room.gate_token_symbol}</span>
              ) : null}
            </div>
            <p className="mt-4 text-[14px] text-white/55 leading-relaxed max-w-xl">
              The SIGNA bot wallet signs and posts a 24h digest of the
              room&apos;s wallet-signed messages back into the room as a
              regular signed message. Anyone reads. Anyone re-verifies the
              signature.
            </p>
            <div className="mt-5">
              <Link
                href={`/rooms/${slug}`}
                className="text-[12.5px] text-white/55 hover:text-white"
              >
                ← back to the room
              </Link>
            </div>
          </div>
        </section>

        <section>
          <div className="max-w-3xl mx-auto px-6 lg:px-10 py-8">
            {!latest ? (
              <div className="border border-white/10 rounded-sm bg-white/[0.02] p-8 text-center text-white/55 leading-relaxed">
                <div className="text-[13px]">No digest posted yet.</div>
                <div className="text-[11.5px] mt-2 font-mono text-white/35">
                  The next 24h cron run will post one if there&apos;s
                  activity to summarize.
                </div>
              </div>
            ) : (
              <article className="border border-[var(--accent)]/30 bg-[var(--accent)]/[0.04] rounded-sm p-5">
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
                    latest digest
                  </div>
                  <div className="text-[10.5px] font-mono text-white/45">
                    {fmtAgo(latest.ts)}
                  </div>
                </div>
                <div className="text-[14.5px] text-white/90 leading-relaxed whitespace-pre-wrap break-words font-mono">
                  {latest.body}
                </div>
                <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-baseline justify-between gap-3 text-[10.5px] font-mono text-white/35">
                  <div>signed by {fmtAddr(latest.from_address)}</div>
                  <div className="truncate">
                    sig: {latest.signature.slice(0, 12)}…{latest.signature.slice(-10)}
                  </div>
                </div>
              </article>
            )}
          </div>
        </section>

        {previousRows.length > 0 && (
          <section className="border-t border-white/[0.06]">
            <div className="max-w-3xl mx-auto px-6 lg:px-10 py-8">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/45 mb-4">
                previous digests · {previousRows.length}
              </div>
              <div className="space-y-3">
                {previousRows.map((d) => (
                  <div
                    key={d.id}
                    className="border border-white/10 rounded-sm bg-white/[0.02] p-4"
                  >
                    <div className="flex items-baseline justify-between mb-2 text-[10.5px] font-mono text-white/35">
                      <div>{fmtAgo(d.ts)}</div>
                      <div>sig: {d.signature.slice(0, 12)}…{d.signature.slice(-10)}</div>
                    </div>
                    <div className="text-[12.5px] text-white/75 leading-relaxed whitespace-pre-wrap break-words font-mono">
                      {d.body}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
