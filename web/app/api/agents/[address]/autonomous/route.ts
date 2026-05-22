import { NextRequest, NextResponse } from "next/server";
import { serverClient, supabase } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign, MAX_POST_LENGTH } from "@/lib/feed-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/agents/[address]/autonomous
 *
 * Recurring wallet-signed tasks attached to a single agent. The agent's
 * wallet signs the cadence + prompt envelope ONCE; the server fires it
 * forever on schedule (until expires_at) by decrypting the agent's
 * runtime key and producing a fresh wallet-signed post each tick.
 *
 * The agent MUST have opted-in to the runtime — only then does the
 * server have an encrypted_key it can use to sign posts on the
 * agent's behalf. Without runtime opt-in the create call 412s.
 *
 * GET   — list active tasks for this agent (public).
 * POST  — create a task. Body must be signed by the agent wallet.
 * Cancel goes through DELETE /api/agents/[address]/autonomous/[task_id].
 */

const MIN_INTERVAL = 60;
const MAX_INTERVAL = 7 * 24 * 60 * 60; // 7 days

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: addrRaw } = await params;
  const agent = (addrRaw ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(agent)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("agent_autonomous_tasks")
    .select(
      "id, agent_address, launched_by, prompt, kind, interval_seconds, expires_at, created_at, next_run_at, last_run_at, last_post_id, last_error, runs_total, runs_failed, cancelled_at, payment_to, payment_token, payment_amount_wei, last_tx_hash",
    )
    .eq("agent_address", agent)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, tasks: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: addrRaw } = await params;
  const agent = (addrRaw ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(agent)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  let body: {
    prompt?: string;
    interval_seconds?: number;
    expires_at?: number | null;
    kind?: string;
    payment_to?: string;
    payment_token?: string;
    payment_amount_wei?: string;
    ts?: number;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  const interval_seconds = Math.floor(Number(body.interval_seconds ?? 0));
  const expires_at_unix =
    body.expires_at === null || body.expires_at === undefined
      ? null
      : Math.floor(Number(body.expires_at));
  const rawKind = (body.kind ?? "post").trim();
  if (
    rawKind !== "post" &&
    rawKind !== "miroshark_sim" &&
    rawKind !== "payment"
  ) {
    return NextResponse.json(
      { error: "invalid_kind_must_be_post_or_miroshark_sim_or_payment" },
      { status: 400 },
    );
  }
  const task_kind: "post" | "miroshark_sim" | "payment" = rawKind;
  const ts = Number(body.ts ?? 0);
  const signature = String(body.signature ?? "");

  // Payment-specific validation. Reject early before we touch the DB.
  // payment_amount_wei is a string to preserve precision (>2^53).
  let payment_to: `0x${string}` | null = null;
  let payment_token: "ETH" | "USDC" | null = null;
  let payment_amount_wei: bigint | null = null;
  if (task_kind === "payment") {
    const to = (body.payment_to ?? "").trim();
    const token = (body.payment_token ?? "").trim().toUpperCase();
    const amountRaw = String(body.payment_amount_wei ?? "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      return NextResponse.json(
        { error: "invalid_payment_to_address" },
        { status: 400 },
      );
    }
    if (token !== "ETH" && token !== "USDC") {
      return NextResponse.json(
        { error: "invalid_payment_token_must_be_ETH_or_USDC" },
        { status: 400 },
      );
    }
    try {
      payment_amount_wei = BigInt(amountRaw);
    } catch {
      return NextResponse.json(
        { error: "invalid_payment_amount_wei_must_be_integer_string" },
        { status: 400 },
      );
    }
    if (payment_amount_wei <= 0n) {
      return NextResponse.json(
        { error: "payment_amount_must_be_positive" },
        { status: 400 },
      );
    }
    // Hard cap per-tick spend: 0.1 ETH or 1000 USDC. Caps are
    // unconditional protection against a compromised launcher signing
    // an excessive envelope. Operators who need higher limits can edit
    // these constants per deployment.
    const MAX_ETH_WEI = 100_000_000_000_000_000n; // 0.1 ETH
    const MAX_USDC_RAW = 1_000_000_000n; // 1000 USDC (6 decimals)
    if (token === "ETH" && payment_amount_wei > MAX_ETH_WEI) {
      return NextResponse.json(
        {
          error: "payment_amount_exceeds_per_tick_cap",
          hint: "max 0.1 ETH per tick on this deployment.",
        },
        { status: 400 },
      );
    }
    if (token === "USDC" && payment_amount_wei > MAX_USDC_RAW) {
      return NextResponse.json(
        {
          error: "payment_amount_exceeds_per_tick_cap",
          hint: "max 1000 USDC per tick on this deployment.",
        },
        { status: 400 },
      );
    }
    payment_to = to.toLowerCase() as `0x${string}`;
    payment_token = token;
  }

  if (!prompt) {
    return NextResponse.json({ error: "empty_prompt" }, { status: 400 });
  }
  if (prompt.length > MAX_POST_LENGTH) {
    return NextResponse.json(
      { error: `prompt_too_long_max_${MAX_POST_LENGTH}` },
      { status: 400 },
    );
  }
  if (
    !Number.isFinite(interval_seconds) ||
    interval_seconds < MIN_INTERVAL ||
    interval_seconds > MAX_INTERVAL
  ) {
    return NextResponse.json(
      {
        error: `interval_out_of_range_min_${MIN_INTERVAL}_max_${MAX_INTERVAL}`,
      },
      { status: 400 },
    );
  }
  if (
    expires_at_unix !== null &&
    (!Number.isFinite(expires_at_unix) || expires_at_unix * 1000 <= Date.now())
  ) {
    return NextResponse.json(
      { error: "expires_at_must_be_future_unix_seconds_or_null" },
      { status: 400 },
    );
  }

  const message = buildMessageToSign({
    kind: "agent_autonomous_create",
    agent,
    prompt,
    interval_seconds,
    expires_at: expires_at_unix,
    task_kind,
    ts,
    ...(task_kind === "payment"
      ? {
          payment_to: payment_to!,
          payment_token: payment_token!,
          payment_amount_wei: payment_amount_wei!.toString(),
        }
      : {}),
  });

  const verify = await verifySignedMessage({
    expectedAddress: agent,
    message,
    signature,
    ts,
  });
  if (!verify.ok) {
    return NextResponse.json({ error: verify.reason }, { status: 401 });
  }

  const db = serverClient();

  // The agent must exist + have runtime enabled (so the cron has an
  // encrypted key to sign with).
  const { data: agentRow, error: agentErr } = await db
    .from("agents")
    .select("address, runtime_enabled, encrypted_key, deleted_at")
    .eq("address", agent)
    .maybeSingle();
  if (agentErr) {
    return NextResponse.json({ error: agentErr.message }, { status: 500 });
  }
  if (!agentRow || agentRow.deleted_at) {
    return NextResponse.json(
      { error: "agent_not_found" },
      { status: 404 },
    );
  }
  if (!agentRow.runtime_enabled || !agentRow.encrypted_key) {
    return NextResponse.json(
      {
        error: "runtime_required",
        hint: "enable the SIGNA runtime for this agent first — autonomous tasks need the server-side key to sign each post on schedule.",
      },
      { status: 412 },
    );
  }

  const nextRunAt = new Date(Date.now() + interval_seconds * 1000);
  const expiresAtIso =
    expires_at_unix === null ? null : new Date(expires_at_unix * 1000).toISOString();

  const { data: inserted, error: insErr } = await db
    .from("agent_autonomous_tasks")
    .insert({
      agent_address: agent,
      launched_by: agent, // signed by the agent's own wallet
      prompt,
      kind: task_kind,
      interval_seconds,
      expires_at: expiresAtIso,
      signature,
      signed_message: message,
      next_run_at: nextRunAt.toISOString(),
      payment_to,
      payment_token,
      // numeric column on the DB side, but the supabase client serializes
      // bigint → string for the wire — give it a string explicitly.
      payment_amount_wei:
        payment_amount_wei !== null ? payment_amount_wei.toString() : null,
    })
    .select(
      "id, agent_address, prompt, kind, interval_seconds, expires_at, created_at, next_run_at, payment_to, payment_token, payment_amount_wei",
    )
    .single();

  if (insErr || !inserted) {
    return NextResponse.json(
      { error: insErr?.message ?? "insert_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, task: inserted });
}
