import { NextRequest, NextResponse } from "next/server";
import { supabase, serverClient } from "@/lib/supabase";
import { bankrRecentLaunches } from "@/lib/skills/bankr";
import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/launches/[address]/room
 *
 * Lazy-create a wallet-signed SIGNA room for a Bankr-launched token,
 * using the SIGNA bot wallet as the room creator. Idempotent — if the
 * room already exists, returns it. If it's the first call, the bot
 * wallet signs the room manifest + a launch announcement message and
 * both persist.
 *
 * The room slug is derived from the token symbol when possible (with
 * a short suffix from the address to disambiguate), so the URL is
 * memorable.
 *
 * Returns { ok, slug, created }.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function slugify(symbol: string, address: string): string {
  const sym = symbol.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
  const tail = address.toLowerCase().replace(/^0x/, "").slice(-6);
  if (sym.length >= 2) return `${sym}-${tail}`;
  return `t-${tail}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const tokenAddress = (raw ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(tokenAddress)) {
    return NextResponse.json(
      { ok: false, error: "invalid_token_address" },
      { status: 400, headers: CORS },
    );
  }

  // Find the launch info in Bankr's feed
  const launches = await bankrRecentLaunches(50);
  const launch = launches.find(
    (l: any) =>
      (l.tokenAddress ?? l.address ?? "").toLowerCase() === tokenAddress,
  ) as any;

  if (!launch) {
    return NextResponse.json(
      { ok: false, error: "token_not_in_recent_launches" },
      { status: 404, headers: CORS },
    );
  }

  const symbol = String(launch.tokenSymbol ?? launch.symbol ?? "TOKEN");
  const name = String(launch.tokenName ?? launch.name ?? symbol);
  const chain = String(launch.chain ?? "base");
  const deployerAddr = String(launch.deployer?.walletAddress ?? "").toLowerCase();
  const deployerHandle = launch.feeRecipient?.xUsername
    ? `@${launch.feeRecipient.xUsername}`
    : null;

  const slug = slugify(symbol, tokenAddress);

  // Check if the room already exists — idempotent
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

  // Create the room using the SIGNA bot wallet
  const botKey = process.env.SIGNA_BOT_PRIVATE_KEY;
  if (!botKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "bot_wallet_not_configured",
        hint: "SIGNA_BOT_PRIVATE_KEY must be set on the server.",
      },
      { status: 503, headers: CORS },
    );
  }

  const pk = (botKey.startsWith("0x") ? botKey : `0x${botKey}`) as `0x${string}`;
  const botAccount = privateKeyToAccount(pk);
  const botAddr = botAccount.address.toLowerCase();

  const description = [
    `Holder room for $${symbol} · ${name}`,
    deployerHandle ? `Deployed by ${deployerHandle} via Bankr.` : "Deployed via Bankr.",
    `Powered by SIGNA wallet-signed chat.`,
  ].join(" · ").slice(0, 500);

  const roomTs = Date.now();
  const roomMessage = [
    "SIGNA room create v1",
    `ts:${roomTs}`,
    `address:${botAddr}`,
    `name:$${symbol} · ${name}`,
    `slug:${slug}`,
    `public:true`,
    `description:${description}`,
  ].join("\n");

  const roomSig = await botAccount.signMessage({ message: roomMessage });

  const db = serverClient();
  const { data: createdRoom, error: roomErr } = await db
    .from("signa_rooms")
    .insert({
      name: `$${symbol} · ${name}`,
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

  // Post the launch announcement as the first message
  const ts = Date.now();
  const launchedAt = launch.timestamp ? new Date(Number(launch.timestamp)).toISOString().slice(0, 16).replace("T", " ") : "—";
  const announcementBody = [
    `$${symbol} just launched on ${chain} via Bankr.`,
    ``,
    `name:        ${name}`,
    `chain:       ${chain}`,
    `address:     ${tokenAddress}`,
    deployerAddr ? `deployer:    ${deployerAddr}` : null,
    deployerHandle ? `deployer x:  ${deployerHandle}` : null,
    `launched:    ${launchedAt}`,
    ``,
    `wallet-signed room for $${symbol} holders + watchers. type / for slash commands.`,
  ].filter(Boolean).join("\n");

  const msgPreimage = [
    "SIGNA room message v1",
    `ts:${ts}`,
    `from:${botAddr}`,
    `room:${slug}`,
    `body:${announcementBody}`,
  ].join("\n");
  const msgSig = await botAccount.signMessage({ message: msgPreimage });

  await db.from("signa_room_messages").insert({
    room_id: createdRoom.id,
    from_address: botAddr,
    body: announcementBody,
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
