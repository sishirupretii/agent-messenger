import { NextRequest, NextResponse } from "next/server";
import { serverClient, supabase } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign } from "@/lib/feed-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/watchlist?address=0x…
 *
 * Returns the wallet's server-side watchlist as a string[] of lowercase
 * token addresses. No auth required (read-only, public per design).
 */
export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "")
    .trim()
    .toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("watchlists")
    .select("token_address, added_at")
    .eq("address", address)
    .order("added_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    address,
    watchlist: (data ?? []).map((r) => r.token_address),
  });
}

/**
 * POST /api/me/watchlist
 *
 * Body: { address, token_address, op: 'add' | 'remove', ts, signature }
 *
 * Wallet-signed toggle. Idempotent. Pass op='add' to add, 'remove' to
 * remove. Adds capped at 100 per address (older entries dropped on overflow).
 */
export async function POST(req: NextRequest) {
  let body: {
    address?: string;
    token_address?: string;
    op?: "add" | "remove";
    ts?: number;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const address = (body.address ?? "").toLowerCase();
  const tokenAddress = (body.token_address ?? "").toLowerCase();
  const op = body.op === "remove" ? "remove" : "add";
  const ts = body.ts ?? 0;
  const signature = body.signature ?? "";

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  if (!/^0x[a-f0-9]{40}$/.test(tokenAddress)) {
    return NextResponse.json({ error: "invalid_token_address" }, { status: 400 });
  }

  const message = buildMessageToSign({
    kind: "watchlist_toggle",
    address,
    token_address: tokenAddress,
    op,
    ts,
  });
  const verify = await verifySignedMessage({
    expectedAddress: address,
    message,
    signature,
    ts,
  });
  if (!verify.ok) {
    return NextResponse.json({ error: verify.reason }, { status: 401 });
  }

  const db = serverClient();
  if (op === "remove") {
    const { error } = await db
      .from("watchlists")
      .delete()
      .eq("address", address)
      .eq("token_address", tokenAddress);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, op: "remove" });
  }

  // add: upsert, then enforce cap of 100 (drop oldest excess)
  const { error: upsertErr } = await db
    .from("watchlists")
    .upsert(
      { address, token_address: tokenAddress },
      { onConflict: "address,token_address" },
    );
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  // Trim to 100 — fetch addresses past the cap by added_at desc and delete.
  const { data: extras } = await db
    .from("watchlists")
    .select("token_address, added_at")
    .eq("address", address)
    .order("added_at", { ascending: false })
    .range(100, 200);
  if (extras && extras.length > 0) {
    const toDelete = extras.map((r) => r.token_address);
    await db
      .from("watchlists")
      .delete()
      .eq("address", address)
      .in("token_address", toDelete);
  }

  return NextResponse.json({ ok: true, op: "add" });
}
