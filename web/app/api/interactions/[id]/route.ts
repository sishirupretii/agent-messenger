import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/interactions/[id]
 *
 * Public read of a single agent_interactions row. Joins the
 * agents table so the renderer doesn't need a second round-trip
 * just to show the agent name + DID.
 *
 * Used by:
 *   - /i/[id] permalink page (server component fetch)
 *   - /i/[id]/opengraph-image (edge runtime fetch)
 *   - third-party clients verifying a quoted reply
 *
 * Everything here is already public — replies are public utterances by
 * a public agent wallet — so no auth, CORS-open via middleware.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const db = serverClient();
  const { data, error } = await db
    .from("agent_interactions")
    .select(
      "id, agent_address, sender_address, message, response, intent, sources, signed, signature, signed_message, rating, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Join the agent row so we can render the speaker context.
  const { data: agent } = await db
    .from("agents")
    .select(
      "address, name, description, tags, avatar_seed, gitlawb_did, erc8004_token_id, bankr_token_address, launched_by",
    )
    .eq("address", data.agent_address)
    .is("deleted_at", null)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    interaction: data,
    agent,
  });
}

/**
 * PATCH /api/interactions/[id]
 *
 * Body: { rating: -1 | 0 | 1, sender_address, ts, signature }
 *
 * Set a thumbs-up / thumbs-down on the reply. Signed by the sender's
 * wallet so we can verify the rater is actually the person who got
 * the reply. Anonymous interactions (no sender_address recorded) can
 * accept ratings from any wallet — the signature still proves
 * authorship of the rating itself.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let body: {
    rating?: number;
    sender_address?: string;
    ts?: number;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const rating = body.rating ?? 0;
  const sender = (body.sender_address ?? "").toLowerCase();
  const ts = body.ts ?? 0;
  const signature = body.signature ?? "";

  if (![ -1, 0, 1 ].includes(rating)) {
    return NextResponse.json({ error: "rating_out_of_range" }, { status: 400 });
  }
  if (!/^0x[a-f0-9]{40}$/.test(sender)) {
    return NextResponse.json({ error: "invalid_sender" }, { status: 400 });
  }

  const message = [
    "SIGNA rate v1",
    `ts:${ts}`,
    `interaction:${id}`,
    `rating:${rating}`,
  ].join("\n");

  // Lazy import to avoid loading viem on the GET path.
  const { verifySignedMessage } = await import("@/lib/verify-signature");
  const verify = await verifySignedMessage({
    expectedAddress: sender,
    message,
    signature,
    ts,
  });
  if (!verify.ok) {
    return NextResponse.json({ error: verify.reason }, { status: 401 });
  }

  const db = serverClient();
  const { error } = await db
    .from("agent_interactions")
    .update({ rating })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rating });
}
