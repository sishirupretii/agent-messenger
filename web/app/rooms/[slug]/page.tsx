import { notFound } from "next/navigation";
import { AppHeader } from "@/components/shell/AppHeader";
import { supabase } from "@/lib/supabase";
import { RoomChat } from "./RoomChat";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();
  const { data } = await supabase
    .from("signa_rooms")
    .select("name, description")
    .eq("slug", slug)
    .maybeSingle();

  const title = data ? `${data.name} · SIGNA room` : `#${slug} · SIGNA room`;
  const description =
    data?.description ?? "Wallet-signed room on the SIGNA network.";
  const url = `https://www.signaagent.xyz/rooms/${slug}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "SIGNA",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    alternates: { canonical: url },
  };
}

interface RoomRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  creator_address: string;
  is_public: boolean;
  ts: number;
  created_at: string;
  gate_token_address?: string | null;
}

export default async function RoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();

  const [{ data: room }, { data: allRoomsRaw }] = await Promise.all([
    supabase
      .from("signa_rooms")
      .select(
        "id, name, slug, description, creator_address, is_public, ts, created_at, gate_token_address, gate_chain, gate_min_balance_raw, gate_token_symbol, gate_token_decimals",
      )
      .eq("slug", slug)
      .maybeSingle(),
    supabase
      .from("signa_rooms")
      .select("name, slug, description, gate_token_address")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (!room) notFound();

  const allRooms = (allRoomsRaw ?? []) as Array<Pick<RoomRow, "name" | "slug" | "description" | "gate_token_address">>;

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
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1 overflow-hidden">
        <div className="max-w-[1600px] mx-auto h-[calc(100vh-64px-1px)]">
          <RoomChat
            slug={room.slug}
            roomName={room.name}
            roomDescription={room.description ?? null}
            roomCreator={room.creator_address}
            roomCreatedAt={room.created_at}
            rooms={allRooms}
            gate={gate}
          />
        </div>
      </main>
    </div>
  );
}
