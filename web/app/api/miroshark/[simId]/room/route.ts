import { NextRequest, NextResponse } from "next/server";
import { supabase, serverClient } from "@/lib/supabase";
import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/miroshark/[simId]/room
 *
 * Lazy-create a wallet-signed SIGNA room for a MiroShark simulation.
 * Bot wallet signs the room manifest + an intro message with the
 * sim's topic. Idempotent — slug is derived from simId.
 *
 * Body (all optional, used to seed the intro message if the room is
 * being created for the first time):
 *   { scenario?, share_url?, bullish?, neutral?, bearish?, outcome? }
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function slugForSim(simId: string): string {
  const tail = simId.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase();
  if (tail.length < 2) return `sim-${Math.random().toString(36).slice(2, 8)}`;
  return `sim-${tail}`;
}

function pct(n: unknown): string {
  const x = typeof n === "number" ? n : Number(n ?? NaN);
  if (!Number.isFinite(x)) return "—";
  const v = x <= 1 ? x * 100 : x;
  return `${Math.round(v)}%`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ simId: string }> },
) {
  const { simId: raw } = await params;
  const simId = String(raw ?? "").trim();
  if (!simId) {
    return NextResponse.json(
      { ok: false, error: "invalid_sim_id" },
      { status: 400, headers: CORS },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // empty body is fine
  }

  const scenario = String((body.scenario as string | undefined) ?? "").slice(0, 200);
  const shareUrl = (body.share_url as string | undefined) || null;
  const bullish = body.bullish;
  const neutral = body.neutral;
  const bearish = body.bearish;
  const outcome = (body.outcome as "YES" | "NO" | null | undefined) ?? null;

  const slug = slugForSim(simId);

  // Idempotent lookup
  const { data: existing } = await supabase
    .from("signa_rooms")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { ok: true, slug: existing.slug, created: false, room: existing },
      { status: 200, headers: CORS },
    );
  }

  const botKey = process.env.SIGNA_BOT_PRIVATE_KEY;
  if (!botKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "bot_wallet_not_configured",
      },
      { status: 503, headers: CORS },
    );
  }

  const pk = (botKey.startsWith("0x") ? botKey : `0x${botKey}`) as `0x${string}`;
  const botAccount = privateKeyToAccount(pk);
  const botAddr = botAccount.address.toLowerCase();

  const title = scenario ? scenario.slice(0, 60) : `sim ${simId.slice(0, 8)}`;
  const description = [
    `MiroShark sim thread · ${title}`,
    `Powered by SIGNA wallet-signed chat.`,
  ].join(" · ").slice(0, 500);

  const roomTs = Date.now();
  const roomMessage = [
    "SIGNA room create v1",
    `ts:${roomTs}`,
    `address:${botAddr}`,
    `name:sim · ${title}`,
    `slug:${slug}`,
    `public:true`,
    `description:${description}`,
  ].join("\n");
  const roomSig = await botAccount.signMessage({ message: roomMessage });

  const db = serverClient();
  const { data: createdRoom, error: roomErr } = await db
    .from("signa_rooms")
    .insert({
      name: `sim · ${title}`,
      slug,
      description,
      creator_address: botAddr,
      is_public: true,
      ts: roomTs,
      signature: roomSig,
      signed_message: roomMessage,
    })
    .select("id, slug, name")
    .single();

  if (roomErr) {
    return NextResponse.json(
      { ok: false, error: roomErr.message },
      { status: 500, headers: CORS },
    );
  }

  const ts = Date.now();
  const verdictLine =
    outcome === "YES"
      ? "verdict:     YES"
      : outcome === "NO"
        ? "verdict:     NO"
        : "verdict:     inconclusive";

  const introBody = [
    `🦈 swarm verdict thread`,
    ``,
    scenario ? `scenario:    ${scenario}` : null,
    `sim id:      ${simId}`,
    bullish !== undefined || neutral !== undefined || bearish !== undefined
      ? `consensus:   ${pct(bullish)} bullish · ${pct(neutral)} neutral · ${pct(bearish)} bearish`
      : null,
    verdictLine,
    shareUrl ? `watch:       ${shareUrl}` : null,
    ``,
    `wallet-signed thread for sim discussion. anyone can read. signatures are receipts.`,
    `type / for slash commands.`,
  ].filter(Boolean).join("\n");

  const msgPreimage = [
    "SIGNA room message v1",
    `ts:${ts}`,
    `from:${botAddr}`,
    `room:${slug}`,
    `body:${introBody}`,
  ].join("\n");
  const msgSig = await botAccount.signMessage({ message: msgPreimage });

  await db.from("signa_room_messages").insert({
    room_id: createdRoom.id,
    from_address: botAddr,
    body: introBody,
    body_type: "text",
    ts,
    signature: msgSig,
    signed_message: msgPreimage,
  });

  return NextResponse.json(
    { ok: true, slug, created: true, room: createdRoom },
    { status: 200, headers: CORS },
  );
}
