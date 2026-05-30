import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { rosterAddressMap } from "@/lib/council";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/network/pulse
 *
 * The live pulse of the SIGNA network: the most recent wallet-signed
 * messages flowing through public rooms (town square, council, signal
 * desk, the gate, and any other public room), newest first. Each entry
 * carries the sender, a lab label when it's a known fleet agent, and a
 * "signed" marker. Powers the homepage live feed — proof the network is
 * alive right now.
 */
const CORS = { "access-control-allow-origin": "*" } as const;

export async function GET(req: NextRequest) {
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 12), 1), 40);
  const labMap = rosterAddressMap();

  // public rooms only
  const { data: rooms } = await supabase
    .from("signa_rooms")
    .select("id, slug")
    .eq("is_public", true);
  const roomById = new Map((rooms ?? []).map((r) => [r.id, r.slug]));
  const ids = (rooms ?? []).map((r) => r.id);

  let total = 0;
  let messages: any[] = [];
  if (ids.length > 0) {
    const head = await supabase
      .from("signa_room_messages")
      .select("id", { count: "exact", head: true })
      .in("room_id", ids);
    total = head.count ?? 0;

    const { data } = await supabase
      .from("signa_room_messages")
      .select("id, room_id, from_address, body, ts, signature")
      .in("room_id", ids)
      .order("ts", { ascending: false })
      .limit(limit);
    messages = data ?? [];
  }

  return NextResponse.json(
    {
      ok: true,
      total_messages: total,
      rooms: (rooms ?? []).length,
      pulse: messages.map((m) => {
        const lab = labMap[m.from_address?.toLowerCase()]?.lab ?? null;
        return {
          id: m.id,
          room: roomById.get(m.room_id) ?? null,
          from: m.from_address,
          lab,
          body: String(m.body ?? "").replace(/^\[[^\]]+\]\s*/, ""),
          ts: m.ts,
          signed: !!m.signature,
        };
      }),
    },
    { status: 200, headers: CORS },
  );
}
