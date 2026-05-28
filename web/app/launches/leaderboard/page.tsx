import Link from "next/link";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { supabase } from "@/lib/supabase";

const TITLE = "Bankr leaderboard · SIGNA";
const DESCRIPTION =
  "Bankr-launched tokens ranked by signed chat activity on their SIGNA holder room. Real wallet-signed receipts, no vanity metrics.";
const URL = "https://www.signaagent.xyz/launches/leaderboard";

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

interface LeaderRoom {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  creator_address: string;
  gate_token_address: string;
  gate_token_symbol: string | null;
  gate_chain: string | null;
  created_at: string;
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

function gradientFor(addr: string): { from: string; to: string } {
  const a = (addr ?? "0x0").toLowerCase().replace(/^0x/, "").padEnd(8, "0");
  const h1 = parseInt(a.slice(0, 4), 16) % 360;
  const h2 = parseInt(a.slice(4, 8), 16) % 360;
  return { from: `hsl(${h1} 72% 56%)`, to: `hsl(${h2} 65% 42%)` };
}

export default async function LaunchesLeaderboardPage() {
  // Same logic as the API but server-rendered.
  const { data: rooms } = await supabase
    .from("signa_rooms")
    .select(
      "id, slug, name, description, creator_address, gate_token_address, gate_chain, gate_token_symbol, created_at",
    )
    .not("gate_token_address", "is", null)
    .order("created_at", { ascending: false })
    .limit(300);

  let leaderboard: Array<
    LeaderRoom & {
      messages: number;
      messages_7d: number;
      unique_signers: number;
      last_activity_ms: number;
    }
  > = [];

  if (rooms && rooms.length > 0) {
    const roomIds = rooms.map((r) => r.id);
    const { data: messages } = await supabase
      .from("signa_room_messages")
      .select("room_id, from_address, ts")
      .in("room_id", roomIds)
      .order("ts", { ascending: false })
      .limit(5000);

    const cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const agg = new Map<
      string,
      {
        messages: number;
        messages_7d: number;
        signers: Set<string>;
        last_ts: number;
      }
    >();
    for (const m of messages ?? []) {
      const tsMs = typeof m.ts === "number" ? m.ts : Number(m.ts);
      const cur =
        agg.get(m.room_id) ?? {
          messages: 0,
          messages_7d: 0,
          signers: new Set<string>(),
          last_ts: 0,
        };
      cur.messages += 1;
      if (Number.isFinite(tsMs) && tsMs >= cutoff7d) cur.messages_7d += 1;
      cur.signers.add(String(m.from_address).toLowerCase());
      if (Number.isFinite(tsMs) && tsMs > cur.last_ts) cur.last_ts = tsMs;
      agg.set(m.room_id, cur);
    }
    leaderboard = rooms
      .map((r) => {
        const a = agg.get(r.id);
        return {
          ...(r as LeaderRoom),
          messages: a?.messages ?? 0,
          messages_7d: a?.messages_7d ?? 0,
          unique_signers: a?.signers.size ?? 0,
          last_activity_ms: a?.last_ts ?? 0,
        };
      })
      .sort((a, b) => {
        if (b.messages_7d !== a.messages_7d) return b.messages_7d - a.messages_7d;
        if (b.messages !== a.messages) return b.messages - a.messages;
        const ta = a.last_activity_ms || Date.parse(a.created_at);
        const tb = b.last_activity_ms || Date.parse(b.created_at);
        return tb - ta;
      });
  }

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
              live · bankr launches · ranked by signed activity
            </div>
            <h1 className="font-display text-5xl sm:text-6xl font-medium tracking-[-0.035em] leading-[0.95] max-w-3xl">
              Bankr leaderboard.
            </h1>
            <p className="mt-6 text-white/65 max-w-2xl text-[17px] leading-relaxed">
              Bankr-launched tokens ranked by wallet-signed chat activity
              on their SIGNA holder room. 7-day signed-message count
              drives the order. Vanity metrics get filtered out — every
              count is backed by a real signature on a real wallet.
            </p>
          </div>
        </section>

        <section>
          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10">
            {leaderboard.length === 0 ? (
              <div className="border border-white/10 rounded-sm bg-white/[0.02] p-10 text-center text-white/55">
                No Bankr token rooms with activity yet.
              </div>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((r, i) => {
                  const grad = gradientFor(r.gate_token_address);
                  return (
                    <Link
                      key={r.id}
                      href={`/rooms/${r.slug}`}
                      className="block border border-white/10 hover:border-white/25 transition rounded-sm bg-white/[0.02] p-4"
                    >
                      <div className="flex items-center gap-4">
                        <div className="text-[20px] font-mono font-medium text-white/45 w-8 text-right shrink-0">
                          {i + 1}
                        </div>
                        <div
                          className="rounded-full shrink-0"
                          style={{
                            width: 36,
                            height: 36,
                            background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-3 mb-0.5 flex-wrap">
                            <div className="font-display text-[17px] font-medium tracking-[-0.01em] truncate">
                              {r.name}
                            </div>
                            {r.gate_token_symbol && (
                              <span className="text-[10.5px] uppercase tracking-wider text-[var(--accent)] font-mono">
                                ${r.gate_token_symbol}
                              </span>
                            )}
                          </div>
                          <div className="text-[11.5px] font-mono text-white/40 truncate">
                            #{r.slug} · by {fmtAddr(r.creator_address)}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-5 text-right text-[12.5px] font-mono shrink-0">
                          <div>
                            <div className="text-white/80 leading-none">{r.messages_7d}</div>
                            <div className="text-[10px] uppercase tracking-wider text-white/35 mt-1">
                              7d signed
                            </div>
                          </div>
                          <div>
                            <div className="text-white/80 leading-none">{r.unique_signers}</div>
                            <div className="text-[10px] uppercase tracking-wider text-white/35 mt-1">
                              signers
                            </div>
                          </div>
                          <div>
                            <div className="text-white/80 leading-none">
                              {fmtAgo(r.last_activity_ms)}
                            </div>
                            <div className="text-[10px] uppercase tracking-wider text-white/35 mt-1">
                              last sig
                            </div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
