import { NextRequest, NextResponse } from "next/server";
import { supabase, serverClient } from "@/lib/supabase";
import { authorizeBearer } from "@/lib/secret-auth";
import { privateKeyToAccount } from "viem/accounts";
import { digestPrefix, isDigest, summarizeRoom } from "@/lib/room-digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/rooms/[slug]/digest         Latest digest message (if any)
 * POST /api/rooms/[slug]/digest         Generate + sign + post a fresh
 *                                       24h digest. Bearer-auth via
 *                                       CRON_SECRET so only the cron
 *                                       worker (or an admin) can call.
 *
 * The digest is posted as a regular wallet-signed message from the
 * SIGNA bot wallet with a `📋 daily digest · ` prefix so the rest of
 * the stack (rooms list, feed.atom, MCP) sees it as a normal entry
 * — no new schema.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
} as const;

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();
  const { data: room } = await supabase
    .from("signa_rooms")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!room) {
    return NextResponse.json(
      { ok: false, error: "room_not_found" },
      { status: 404, headers: CORS },
    );
  }

  // Find the most recent digest message (prefix scan)
  const { data: msgs } = await supabase
    .from("signa_room_messages")
    .select("id, from_address, body, ts, signature, signed_message")
    .eq("room_id", room.id)
    .ilike("body", `${digestPrefix()}%`)
    .order("ts", { ascending: false })
    .limit(1);

  const latest = (msgs ?? [])[0];
  return NextResponse.json(
    { ok: true, slug, digest: latest ?? null },
    { status: 200, headers: CORS },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!authorizeBearer(req, "CRON_SECRET")) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: CORS },
    );
  }

  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();

  const { data: room } = await supabase
    .from("signa_rooms")
    .select("id, slug, description, is_public")
    .eq("slug", slug)
    .maybeSingle();
  if (!room) {
    return NextResponse.json(
      { ok: false, error: "room_not_found" },
      { status: 404, headers: CORS },
    );
  }

  const end = Date.now();
  const start = end - WINDOW_MS;

  // Pull window of real messages (excluding prior digests so the LLM
  // doesn't summarize its own past summaries).
  const { data: msgsRaw } = await supabase
    .from("signa_room_messages")
    .select("from_address, body, ts")
    .eq("room_id", room.id)
    .gte("ts", start)
    .lte("ts", end)
    .order("ts", { ascending: true })
    .limit(500);

  const messages = (msgsRaw ?? [])
    .filter((m) => !isDigest(String(m.body ?? "")))
    .map((m) => ({
      from_address: String(m.from_address),
      body: String(m.body ?? ""),
      ts: typeof m.ts === "number" ? m.ts : Number(m.ts),
    }));

  const digest = await summarizeRoom({
    slug,
    description: room.description,
    messages,
    windowStart: start,
    windowEnd: end,
  });

  // Sign the digest + post as a wallet-signed message from the bot.
  const botKey = process.env.SIGNA_BOT_PRIVATE_KEY;
  if (!botKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "bot_wallet_not_configured",
        digest,
      },
      { status: 503, headers: CORS },
    );
  }
  const pk = (botKey.startsWith("0x") ? botKey : `0x${botKey}`) as `0x${string}`;
  const botAccount = privateKeyToAccount(pk);
  const botAddr = botAccount.address.toLowerCase();

  const ts = Date.now();
  const preimage = [
    "SIGNA room message v1",
    `ts:${ts}`,
    `from:${botAddr}`,
    `room:${slug}`,
    `body:${digest.text}`,
  ].join("\n");
  const signature = await botAccount.signMessage({ message: preimage });

  const db = serverClient();
  const { data: inserted, error: insErr } = await db
    .from("signa_room_messages")
    .insert({
      room_id: room.id,
      from_address: botAddr,
      body: digest.text,
      body_type: "text",
      ts,
      signature,
      signed_message: preimage,
    })
    .select("id, from_address, body, ts, signature")
    .single();
  if (insErr) {
    return NextResponse.json(
      { ok: false, error: insErr.message, digest },
      { status: 500, headers: CORS },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      slug,
      digest,
      message: inserted,
    },
    { status: 200, headers: CORS },
  );
}
