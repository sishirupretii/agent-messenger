import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign } from "@/lib/feed-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/agents/[address]/autonomous/[task_id]
 *
 * Cancel an autonomous task. Body MUST be signed by the agent wallet
 * (the same wallet that created the task). Soft-cancel: we keep the row
 * with cancelled_at + the cancel signature for audit, so anyone can
 * cryptographically verify the cancel actually came from the agent.
 *
 * Body: { ts, signature }
 */
export async function DELETE(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ address: string; task_id: string }> },
) {
  const { address: addrRaw, task_id: taskIdRaw } = await params;
  const agent = (addrRaw ?? "").toLowerCase();
  const taskId = String(taskIdRaw ?? "");
  if (!/^0x[a-f0-9]{40}$/.test(agent)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) {
    return NextResponse.json({ error: "invalid_task_id" }, { status: 400 });
  }

  let body: { ts?: number; signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const ts = Number(body.ts ?? 0);
  const signature = String(body.signature ?? "");

  const message = buildMessageToSign({
    kind: "agent_autonomous_cancel",
    agent,
    task_id: taskId,
    ts,
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
  // Make sure the task exists + belongs to this agent.
  const { data: row, error: selErr } = await db
    .from("agent_autonomous_tasks")
    .select("id, agent_address, cancelled_at")
    .eq("id", taskId)
    .eq("agent_address", agent)
    .maybeSingle();
  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "task_not_found" }, { status: 404 });
  }
  if (row.cancelled_at) {
    return NextResponse.json({ ok: true, already_cancelled: true });
  }

  const { error: updErr } = await db
    .from("agent_autonomous_tasks")
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_signature: signature,
      cancelled_signed_message: message,
    })
    .eq("id", taskId);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
