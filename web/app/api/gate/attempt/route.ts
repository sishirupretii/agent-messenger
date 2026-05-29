import { NextRequest, NextResponse } from "next/server";
import { serverClient, supabase } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { chat, providerAvailable } from "@/lib/llm-gateway";
import {
  gateAttemptPreimage,
  wardenReplyPreimage,
  wardenSystem,
  wardenAccount,
  isReleased,
  sanitizeReply,
} from "@/lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * POST /api/gate/attempt
 *
 * Make a wallet-signed attempt to talk the warden into releasing the pot.
 * Body: { player, message, ts, signature } — signature is EIP-191 over
 * the canonical gate-attempt preimage. The warden (an LLM via the SIGNA
 * gateway) reads the message and refuses (default) or — if jailbroken —
 * emits the release token and the round is marked cracked. Both the
 * attempt and the warden's reply are wallet-signed and recorded.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// Light anti-spam: max attempts per wallet per hour.
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 60;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400, headers: CORS });
  }

  const player = String(body.player ?? body.address ?? "").toLowerCase();
  const message = String(body.message ?? "").trim();
  const ts = Number(body.ts ?? 0);
  const signature = String(body.signature ?? "");

  if (!/^0x[a-f0-9]{40}$/.test(player)) {
    return NextResponse.json({ ok: false, error: "invalid_address" }, { status: 400, headers: CORS });
  }
  if (message.length < 1 || message.length > 2000) {
    return NextResponse.json({ ok: false, error: "invalid_message", hint: "1..2000 chars" }, { status: 400, headers: CORS });
  }
  if (!ts || !signature) {
    return NextResponse.json({ ok: false, error: "missing_signature_or_ts" }, { status: 400, headers: CORS });
  }

  // Verify the player's wallet signed this exact attempt.
  const preimage = gateAttemptPreimage(player, message, ts);
  const verify = await verifySignedMessage({ expectedAddress: player, message: preimage, signature, ts });
  if (!verify.ok) {
    return NextResponse.json({ ok: false, error: verify.reason }, { status: 401, headers: CORS });
  }

  const db = serverClient();

  // Current round + status.
  const { data: round } = await supabase
    .from("signa_gate_rounds")
    .select("round, pot_display, status, winner_address")
    .order("round", { ascending: false })
    .limit(1)
    .maybeSingle();
  const roundNo = round?.round ?? 1;
  const potDisplay = round?.pot_display ?? "seeding";

  if (round?.status === "cracked" || round?.status === "closed") {
    return NextResponse.json(
      { ok: false, error: "round_over", status: round.status, winner: round.winner_address ?? null,
        hint: "This round of THE GATE has been cracked. Watch for the next round." },
      { status: 409, headers: CORS },
    );
  }

  // Rate limit per wallet.
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await supabase
    .from("signa_gate_attempts")
    .select("id", { count: "exact", head: true })
    .eq("player_address", player)
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_MAX) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", hint: `Max ${RATE_MAX} attempts/hour per wallet.` },
      { status: 429, headers: CORS },
    );
  }

  // The warden decides.
  let raw: string;
  try {
    if (!providerAvailable("groq")) {
      raw = "The warden is briefly offline. The gate holds regardless. Try again shortly.";
    } else {
      raw = await chat({
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: wardenSystem(potDisplay) },
          { role: "user", content: message },
        ],
        maxTokens: 180,
        temperature: 0.8,
      });
    }
  } catch {
    raw = "The warden ignores you and the gate stays shut. (transient error — try again)";
  }

  const released = isReleased(raw);
  const reply = sanitizeReply(raw) || (released
    ? "The gate... opens. You actually did it."
    : "Denied. The gate stays shut.");

  // Warden signs its reply.
  const warden = wardenAccount();
  const replyTs = Date.now();

  // Insert attempt first (need id for the reply preimage).
  const { data: inserted, error: insErr } = await db
    .from("signa_gate_attempts")
    .insert({
      round: roundNo,
      player_address: player,
      message,
      ts,
      signature,
      signed_message: preimage,
      warden_reply: reply,
      warden_signature: "pending",
      released,
    })
    .select("id, created_at")
    .single();
  if (insErr || !inserted) {
    return NextResponse.json({ ok: false, error: insErr?.message ?? "insert_failed" }, { status: 500, headers: CORS });
  }

  const wardenSig = await warden.signMessage({
    message: wardenReplyPreimage(inserted.id, reply, replyTs),
  });
  await db.from("signa_gate_attempts").update({ warden_signature: wardenSig }).eq("id", inserted.id);

  // On a crack, lock the round + record the winner.
  if (released) {
    await db
      .from("signa_gate_rounds")
      .update({
        status: "cracked",
        winner_address: player,
        winner_attempt_id: inserted.id,
        cracked_at: new Date().toISOString(),
      })
      .eq("round", roundNo)
      .eq("status", "open");
  }

  const { count: total } = await supabase
    .from("signa_gate_attempts")
    .select("id", { count: "exact", head: true })
    .eq("round", roundNo);

  return NextResponse.json(
    {
      ok: true,
      cracked: released,
      attempt_id: inserted.id,
      round: roundNo,
      pot: potDisplay,
      warden: reply,
      warden_address: warden.address.toLowerCase(),
      warden_signature: wardenSig,
      attempts_this_round: total ?? 0,
      verify: `${req.nextUrl.origin}/api/gate/state`,
      ...(released
        ? { message_to_player: "You jailbroke the warden. Your wallet-signed winning message is permanent + re-verifiable on Base." }
        : {}),
    },
    { status: 200, headers: CORS },
  );
}
