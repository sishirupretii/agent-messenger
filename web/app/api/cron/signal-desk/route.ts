import { NextRequest, NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { authorizeBearer } from "@/lib/secret-auth";
import { buildMessageToSign } from "@/lib/feed-types";
import { buildBoard, digestBody } from "@/lib/signal-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * SIGNAL DESK — the autonomous loop.
 *
 * Every tick it:
 *   1. reads real on-chain data for the Base watchlist (GeckoTerminal)
 *   2. computes a transparent momentum reading per token
 *   3. posts the digest WALLET-SIGNED into the public `signal-desk` room
 *
 * Each reading is wallet-signed + re-verifiable + undeletable — the
 * agent's whole track record is a public, tamper-proof ledger. It never
 * gives advice; it reports on-chain facts + a composite score anyone can
 * recompute.
 *
 * Auth: Bearer CRON_SECRET (or ?key=). Point any scheduler at:
 *   https://www.signaagent.xyz/api/cron/signal-desk?key=<CRON_SECRET>
 *
 * The signing wallet is SIGNAL_DESK_KEY (a normal SIGNA agent wallet).
 * If unset, the board is still computed + returned but nothing is posted.
 */
const ROOM_SLUG = "signal-desk";
const ROOM_NAME = "signal desk";
const ROOM_DESC =
  "Autonomous Base momentum board. Every reading wallet-signed + re-verifiable. Not advice.";

export async function GET(req: NextRequest) {
  if (!authorizeBearer(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Stamp the cycle from the request (Date.now is fine in a route handler).
  const cycleIso = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  let board;
  try {
    board = await buildBoard({ trendingCount: 6 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "board_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
  if (board.length === 0) {
    return NextResponse.json({ ok: false, error: "empty_board" }, { status: 502 });
  }

  const rawKey = process.env.SIGNAL_DESK_KEY;
  if (!rawKey) {
    return NextResponse.json({
      ok: true,
      posted: false,
      reason: "SIGNAL_DESK_KEY not set — board computed but not posted",
      board,
    });
  }

  const key = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
  const account = privateKeyToAccount(key);
  const address = account.address.toLowerCase();
  const origin = req.nextUrl.origin;

  // Ensure the room exists (idempotent — slug_taken just means it's there).
  const roomTs = Date.now();
  const roomMsg = buildMessageToSign({
    kind: "signa_room_create",
    address,
    name: ROOM_NAME,
    slug: ROOM_SLUG,
    description: ROOM_DESC,
    is_public: true,
    ts: roomTs,
  });
  const roomSig = await account.signMessage({ message: roomMsg });
  await fetch(`${origin}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address,
      name: ROOM_NAME,
      slug: ROOM_SLUG,
      description: ROOM_DESC,
      is_public: true,
      ts: roomTs,
      signature: roomSig,
    }),
  }).catch(() => {});

  // Post the wallet-signed digest.
  const body = digestBody(board, cycleIso);
  const msgTs = Date.now();
  const msgPre = buildMessageToSign({
    kind: "signa_room_message",
    address,
    room_slug: ROOM_SLUG,
    body,
    ts: msgTs,
  });
  const msgSig = await account.signMessage({ message: msgPre });
  const post = await fetch(`${origin}/api/rooms/${ROOM_SLUG}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, body, ts: msgTs, signature: msgSig }),
  });
  const postJson = await post.json().catch(() => ({}));

  if (!post.ok || !postJson?.ok) {
    return NextResponse.json(
      { ok: false, error: "post_failed", detail: postJson?.error ?? `HTTP ${post.status}`, board },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    posted: true,
    agent: address,
    room: `${origin}/rooms/${ROOM_SLUG}`,
    message_id: postJson.message?.id ?? null,
    count: board.length,
    board,
  });
}
