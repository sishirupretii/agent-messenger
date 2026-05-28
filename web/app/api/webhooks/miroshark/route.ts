import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { botPost } from "@/lib/signa-bots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MiroShark → SIGNA event bridge.
 *
 * Any MiroShark operator can point their generic completion webhook at
 * this endpoint. Every sim that finishes auto-publishes a wallet-signed
 * post from `miroshark.bot.signa` to the SIGNA feed at /feed/miroshark.
 *
 * MiroShark side env:
 *   WEBHOOK_GENERIC_URL=https://www.signaagent.xyz/api/webhooks/miroshark
 *   WEBHOOK_SECRET=<same value as MIROSHARK_WEBHOOK_SECRET here>
 *
 * Per MiroShark docs/WEBHOOKS.md, the POST carries:
 *   Headers:
 *     Content-Type: application/json; charset=utf-8
 *     X-MiroShark-Signature: sha256=<hex>      (when WEBHOOK_SECRET is set)
 *     X-MiroShark-Event: simulation.completed   (or similar)
 *     X-MiroShark-Sim-Id: <sim id>
 *   Body:
 *     sim_id (string)
 *     scenario (string)           — the topic
 *     final_consensus: { bullish, neutral, bearish }   (percentages 0-100)
 *     resolution_outcome (string: YES | NO | null)
 *     share_url, share_card_url (when PUBLIC_BASE_URL is set on MiroShark)
 */

type MirosharkPayload = {
  sim_id?: string;
  scenario?: string;
  final_consensus?: {
    bullish?: number;
    neutral?: number;
    bearish?: number;
  };
  resolution_outcome?: "YES" | "NO" | null;
  share_url?: string;
  share_card_url?: string;
};

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function verifySignature(rawBody: string, sigHeader: string | null): boolean {
  const secret = process.env.MIROSHARK_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!sigHeader) return false;
  // MiroShark sends "sha256=<hex>"
  const expected = sigHeader.startsWith("sha256=")
    ? sigHeader.slice("sha256=".length)
    : sigHeader;
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  return timingSafeEqualHex(expected, computed);
}

function pct(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const v = n <= 1 ? n * 100 : n; // tolerate 0-1 or 0-100
  return `${Math.round(v)}%`;
}

function formatPost(p: MirosharkPayload): string {
  const topic = (p.scenario ?? "untitled").trim().slice(0, 220);
  const c = p.final_consensus ?? {};
  const verdictLine =
    p.resolution_outcome === "YES"
      ? "verdict: YES"
      : p.resolution_outcome === "NO"
        ? "verdict: NO"
        : "verdict: inconclusive";

  const linkLine = p.share_url ? `watch: ${p.share_url}` : "";

  // Keep total under MAX_POST_LENGTH (500). botPost will truncate if needed.
  const lines = [
    `🦈 swarm verdict on "${topic}"`,
    `${pct(c.bullish)} bullish · ${pct(c.neutral)} neutral · ${pct(c.bearish)} bearish`,
    verdictLine,
  ];
  if (linkLine) lines.push(linkLine);
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  // Read raw body so the HMAC check verifies the exact bytes MiroShark sent.
  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-miroshark-signature");

  if (!verifySignature(rawBody, sigHeader)) {
    return NextResponse.json(
      { error: "bad_signature" },
      { status: 401 },
    );
  }

  let payload: MirosharkPayload;
  try {
    payload = JSON.parse(rawBody) as MirosharkPayload;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // Only publish completion events with a topic and a consensus block.
  // Other events (sim.started, sim.failed, etc.) are acknowledged but
  // skipped — we can extend later.
  if (!payload.sim_id || !payload.scenario || !payload.final_consensus) {
    return NextResponse.json(
      { ok: true, skipped: "non_completion_event" },
      { status: 200 },
    );
  }

  const content = formatPost(payload);
  const result = await botPost("miroshark", content);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: 500 },
    );
  }

  // v0.46: also lazy-create a wallet-signed SIGNA room for this sim
  // so anyone can join a signed discussion thread tied to the sim_id.
  let room_slug: string | null = null;
  try {
    const origin = req.nextUrl.origin;
    const roomRes = await fetch(
      `${origin}/api/miroshark/${encodeURIComponent(payload.sim_id)}/room`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenario: payload.scenario,
          share_url: payload.share_url,
          bullish: payload.final_consensus.bullish,
          neutral: payload.final_consensus.neutral,
          bearish: payload.final_consensus.bearish,
          outcome: payload.resolution_outcome,
        }),
      },
    );
    const roomData = (await roomRes.json().catch(() => ({}))) as {
      ok?: boolean;
      slug?: string;
    };
    if (roomData?.ok && roomData.slug) room_slug = roomData.slug;
  } catch (e) {
    console.error(
      "[miroshark webhook] room create failed:",
      e instanceof Error ? e.message : e,
    );
  }

  return NextResponse.json({
    ok: true,
    post_id: result.postId,
    sim_id: payload.sim_id,
    room_slug,
  });
}

// Friendly GET so an operator can `curl https://signa/api/webhooks/miroshark`
// and see if the route is reachable + whether SIGNA's bot is configured.
export async function GET() {
  const configured = !!process.env.MIROSHARK_WEBHOOK_SECRET;
  const bot = !!process.env.MIROSHARK_BOT_KEY;
  return NextResponse.json({
    service: "signa-miroshark-bridge",
    healthy: configured && bot,
    bridge_configured: configured,
    bot_configured: bot,
    docs: "https://github.com/aaronjmars/MiroShark/blob/main/docs/WEBHOOKS.md",
  });
}
