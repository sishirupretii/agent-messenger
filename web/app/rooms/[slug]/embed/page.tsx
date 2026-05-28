import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { RoomEmbedClient } from "./RoomEmbedClient";

/**
 * /rooms/[slug]/embed
 *
 * iframe-friendly chat view. No AppHeader, no Footer, no nav. Just the
 * room timeline + composer. Renders against the same /api/rooms/[slug]
 * endpoints as the full chat. Auto-resizes to viewport.
 *
 * Designed to be embedded on any partner site with one tag:
 *
 *   <iframe src="https://www.signaagent.xyz/rooms/<slug>/embed"
 *           style="width:100%;height:560px;border:0"
 *           allow="clipboard-write"
 *           sandbox="allow-scripts allow-same-origin allow-popups
 *                    allow-forms allow-popups-to-escape-sandbox"></iframe>
 *
 * Posting from the iframe works as long as the visitor has a wallet
 * (RainbowKit modal pops over the iframe). Reads always work.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return {
    title: `#${slug} · SIGNA embed`,
    robots: { index: false, follow: false },
  };
}

export default async function RoomEmbedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();

  const { data: room } = await supabase
    .from("signa_rooms")
    .select(
      "id, name, slug, description, creator_address, ts, created_at, gate_token_address, gate_chain, gate_min_balance_raw, gate_token_symbol, gate_token_decimals",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!room) notFound();

  const gate = room.gate_token_address
    ? {
        tokenAddress: room.gate_token_address as string,
        chain: (room.gate_chain ?? "base") as string,
        symbol: (room.gate_token_symbol ?? "TOKEN") as string,
        decimals: (room.gate_token_decimals ?? 18) as number,
        minBalanceRaw: (room.gate_min_balance_raw ?? "0") as string,
      }
    : null;

  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col">
      <RoomEmbedClient
        slug={room.slug}
        roomName={room.name}
        roomDescription={room.description ?? null}
        roomCreator={room.creator_address}
        gate={gate}
      />
    </div>
  );
}
