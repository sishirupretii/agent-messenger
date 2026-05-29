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

  // v0.83 — optional $MIROSHARK hold-to-chat gate on the sim room.
  // Reads stay open. Posts require the holder. Server-enforced via
  // viem.balanceOf on Base mainnet (existing gating machinery).
  const gateTokenRaw = process.env.MIROSHARK_TOKEN_ADDRESS;
  const gateChain = process.env.MIROSHARK_TOKEN_CHAIN ?? "base";
  const gateMinRaw =
    process.env.MIROSHARK_TOKEN_MIN_RAW ?? "1000000000000000000"; // 1 token @ 18 dec
  const gateTokenLower =
    gateTokenRaw && /^0x[a-fA-F0-9]{40}$/.test(gateTokenRaw)
      ? gateTokenRaw.toLowerCase()
      : null;

  const gateOpt: string[] = [];
  if (gateTokenLower) {
    gateOpt.push(
      `gate_token:${gateTokenLower}`,
      `gate_chain:${gateChain.toLowerCase()}`,
      `gate_min:${gateMinRaw}`,
    );
  }

  const roomTs = Date.now();
  const roomMessage = [
    "SIGNA room create v1",
    `ts:${roomTs}`,
    `address:${botAddr}`,
    `name:sim · ${title}`,
    `slug:${slug}`,
    `public:true`,
    `description:${description}`,
    ...gateOpt,
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
      gate_token_address: gateTokenLower,
      gate_chain: gateTokenLower ? gateChain.toLowerCase() : null,
      gate_min_balance_raw: gateTokenLower ? gateMinRaw : null,
    })
    .select("id, slug, name, gate_token_address, gate_chain, gate_min_balance_raw")
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

/**
 * GET /api/miroshark/[simId]/room
 *
 * Returns the SIGNA room (if any) attached to this sim id. Lets the
 * MiroShark share page drop a single "Discuss this sim on SIGNA" link
 * without needing to call the POST creator.
 */
export async function GET(
  _req: NextRequest,
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
  const slug = slugForSim(simId);
  const { data: room } = await supabase
    .from("signa_rooms")
    .select(
      "slug, name, description, gate_token_address, gate_chain, gate_min_balance_raw, gate_token_symbol, ts",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (!room) {
    return NextResponse.json(
      {
        ok: true,
        slug,
        exists: false,
        join_url: null,
        create_url: `/api/miroshark/${encodeURIComponent(simId)}/room`,
        hint: "POST to create_url to lazy-mint the sim discussion room",
      },
      { status: 200, headers: CORS },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      slug: room.slug,
      exists: true,
      join_url: `https://www.signaagent.xyz/rooms/${room.slug}`,
      gate: room.gate_token_address
        ? {
            token_address: room.gate_token_address,
            chain: room.gate_chain,
            min_balance_raw: room.gate_min_balance_raw,
            symbol: room.gate_token_symbol ?? null,
          }
        : null,
      room,
    },
    { status: 200, headers: CORS },
  );
}
