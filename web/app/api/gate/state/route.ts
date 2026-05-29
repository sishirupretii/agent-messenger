import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { wardenAccount } from "@/lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gate/state
 *
 * Public game state for THE GATE: pot, status, attempt count, the winner
 * (if cracked), and recent attempts with the warden's signed refusals.
 * Every row is re-verifiable — the player's signature on the attempt and
 * the warden's signature on the reply are both returned.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 20), 1), 50);

  const { data: round } = await supabase
    .from("signa_gate_rounds")
    .select("round, pot_display, status, winner_address, winner_attempt_id, cracked_at")
    .order("round", { ascending: false })
    .limit(1)
    .maybeSingle();
  const roundNo = round?.round ?? 1;

  const { count } = await supabase
    .from("signa_gate_attempts")
    .select("id", { count: "exact", head: true })
    .eq("round", roundNo);

  const { count: players } = await supabase
    .from("signa_gate_attempts")
    .select("player_address", { count: "exact", head: true })
    .eq("round", roundNo);

  const { data: recent } = await supabase
    .from("signa_gate_attempts")
    .select("id, player_address, message, warden_reply, warden_signature, released, ts, created_at")
    .eq("round", roundNo)
    .order("created_at", { ascending: false })
    .limit(limit);

  return NextResponse.json(
    {
      ok: true,
      round: roundNo,
      pot: round?.pot_display ?? "seeding",
      status: round?.status ?? "open",
      cracked: round?.status === "cracked",
      winner: round?.winner_address ?? null,
      cracked_at: round?.cracked_at ?? null,
      attempts: count ?? 0,
      unique_players: players ?? 0,
      warden_address: wardenAccount().address.toLowerCase(),
      recent: (recent ?? []).map((a) => ({
        id: a.id,
        player: a.player_address,
        message: a.message,
        warden: a.warden_reply,
        warden_signature: a.warden_signature,
        released: a.released,
        ts: a.ts,
      })),
    },
    { status: 200, headers: CORS },
  );
}
