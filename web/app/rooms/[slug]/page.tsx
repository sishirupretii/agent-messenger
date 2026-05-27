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

interface RoomRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  creator_address: string;
  is_public: boolean;
  ts: number;
  created_at: string;
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
      .select("id, name, slug, description, creator_address, is_public, ts, created_at")
      .eq("slug", slug)
      .maybeSingle(),
    supabase
      .from("signa_rooms")
      .select("name, slug, description")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (!room) notFound();

  const allRooms = (allRoomsRaw ?? []) as Array<Pick<RoomRow, "name" | "slug" | "description">>;

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
          />
        </div>
      </main>
    </div>
  );
}
