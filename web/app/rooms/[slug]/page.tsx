import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";
import { supabase } from "@/lib/supabase";
import { RoomChat } from "./RoomChat";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { data } = await supabase
    .from("signa_rooms")
    .select("name, description")
    .eq("slug", (slug ?? "").toLowerCase())
    .maybeSingle();
  return {
    title: data ? `#${slug} · SIGNA room` : "Room · SIGNA",
    description: data?.description ?? "Wallet-signed room on the SIGNA network.",
  };
}

export default async function RoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();

  const { data: room } = await supabase
    .from("signa_rooms")
    .select("id, name, slug, description, creator_address, is_public, ts, created_at")
    .eq("slug", slug)
    .maybeSingle();

  if (!room) notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-4xl mx-auto px-6 lg:px-10 pt-10 pb-6">
            <Link
              href="/rooms"
              className="text-[11.5px] uppercase tracking-[0.18em] text-white/45 hover:text-white/75"
            >
              ← rooms
            </Link>
            <div className="mt-3 flex items-baseline justify-between flex-wrap gap-2">
              <h1 className="font-display text-3xl font-medium tracking-[-0.02em]">
                {room.name}
              </h1>
              <div className="text-[11.5px] font-mono text-white/45">#{room.slug}</div>
            </div>
            {room.description && (
              <p className="mt-2 text-white/65 text-[14px] leading-relaxed">
                {room.description}
              </p>
            )}
            <div className="mt-3 text-[11px] font-mono text-white/40">
              created by {room.creator_address.slice(0, 6)}…{room.creator_address.slice(-4)}
              {" · "}wallet-signed
              {" · "}federated
            </div>
          </div>
        </section>

        <section>
          <div className="max-w-4xl mx-auto px-6 lg:px-10 py-8">
            <RoomChat slug={room.slug} />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
