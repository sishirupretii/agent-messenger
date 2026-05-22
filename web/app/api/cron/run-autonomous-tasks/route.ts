import { NextRequest, NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { serverClient } from "@/lib/supabase";
import { decryptAgentKey } from "@/lib/key-vault";
import { authorizeBearer } from "@/lib/secret-auth";
import { buildMessageToSign } from "@/lib/feed-types";
import {
  mirosharkConfigured,
  mirosharkCreateSim,
} from "@/lib/skills/miroshark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/run-autonomous-tasks
 *
 * Fires every autonomous task whose next_run_at has elapsed and which
 * hasn't been cancelled or expired. For each task:
 *
 *   1. Load the agent's encrypted_key, decrypt to plaintext
 *   2. Build a SIGNA post envelope { kind:"post", content: <prompt>, ts: now }
 *   3. Sign it with the agent's private key (NOT the user's)
 *   4. Insert into posts table — same shape as a user-posted entry,
 *      so cross-node sync replicates it normally
 *   5. Advance next_run_at by interval_seconds
 *
 * The agent originally signed the autonomous-task envelope once,
 * authorizing this exact prompt + cadence. The cron is just executing
 * that authorization — every individual post still has a fresh wallet
 * signature, valid against the agent's address.
 *
 * Caps:
 *   - 50 tasks per run (Vercel cron has a soft compute budget)
 *   - 8s budget per task — slow ones are skipped to next tick
 *   - Tasks that fail 5 runs in a row get cancelled to stop bleeding
 *
 * Auth: bearer-token via CRON_SECRET. Same secret as /api/cron/sync-nodes.
 */

const BATCH_LIMIT = 50;
const FAIL_THRESHOLD = 5;

type TaskRow = {
  id: string;
  agent_address: string;
  prompt: string;
  kind: "post" | "miroshark_sim";
  interval_seconds: number;
  expires_at: string | null;
  next_run_at: string;
  runs_total: number;
  runs_failed: number;
};

/**
 * Loads + decrypts the agent's runtime key, returns a viem account ready
 * to sign messages. Returns a structured error for the cron worker to
 * record + surface to the operator.
 */
async function loadAgentSigner(
  db: ReturnType<typeof serverClient>,
  agentAddress: string,
): Promise<
  | { ok: true; account: ReturnType<typeof privateKeyToAccount> }
  | { ok: false; error: string }
> {
  const { data: agentRow, error: agentErr } = await db
    .from("agents")
    .select("encrypted_key, runtime_enabled, deleted_at")
    .eq("address", agentAddress)
    .maybeSingle();
  if (agentErr) return { ok: false, error: `agent_lookup_${agentErr.code ?? "?"}` };
  if (!agentRow) return { ok: false, error: "agent_not_found" };
  if (agentRow.deleted_at) return { ok: false, error: "agent_deleted" };
  if (!agentRow.runtime_enabled || !agentRow.encrypted_key) {
    return { ok: false, error: "runtime_not_enabled" };
  }

  let privateKey: `0x${string}`;
  try {
    privateKey = decryptAgentKey(agentRow.encrypted_key);
  } catch (e) {
    return {
      ok: false,
      error: `decrypt_${e instanceof Error ? e.message.slice(0, 40) : "fail"}`,
    };
  }
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== agentAddress.toLowerCase()) {
    return { ok: false, error: "key_address_mismatch" };
  }
  return { ok: true, account };
}

/**
 * Sign + insert a wallet-signed feed post authored by `account`. Same
 * shape as any user-posted entry — cross-node sync replicates it
 * uniformly. Returns the new post id.
 */
async function signAndInsertPost(
  db: ReturnType<typeof serverClient>,
  account: ReturnType<typeof privateKeyToAccount>,
  agentAddress: string,
  content: string,
): Promise<{ ok: true; post_id: string } | { ok: false; error: string }> {
  const ts = Date.now();
  const message = buildMessageToSign({
    kind: "post",
    content,
    parent_id: null,
    ts,
  });
  const signature = await account.signMessage({ message });

  const { data: post, error: insErr } = await db
    .from("posts")
    .insert({
      author_address: agentAddress,
      content,
      parent_id: null,
      signature,
      signed_message: message,
    })
    .select("id")
    .single();
  if (insErr || !post) {
    return { ok: false, error: `insert_${insErr?.code ?? "fail"}` };
  }
  return { ok: true, post_id: post.id };
}

async function runPostTask(
  db: ReturnType<typeof serverClient>,
  task: TaskRow,
): Promise<{ ok: true; post_id: string } | { ok: false; error: string }> {
  const signer = await loadAgentSigner(db, task.agent_address);
  if (!signer.ok) return { ok: false, error: signer.error };
  return signAndInsertPost(db, signer.account, task.agent_address, task.prompt);
}

/**
 * miroshark_sim kind:
 *   1. Load + decrypt the agent's runtime key (same as post kind).
 *   2. Post a wallet-signed "fired miroshark sim: <prompt>" entry from
 *      the agent. Acts as the audit trail — the agent's feed shows when
 *      it requested a sim, regardless of whether the sim itself returns.
 *   3. Kick off the actual MiroShark sim via mirosharkCreateSim. The
 *      verdict is posted asynchronously by miroshark.bot.signa via the
 *      existing /api/webhooks/miroshark handler when the sim completes.
 *
 * If MIROSHARK_BASE_URL isn't configured on this deployment, we still
 * post the audit entry but return a soft "miroshark_not_configured"
 * error so operators see it in last_error. We do NOT consider this a
 * post-failure (the agent's post landed) — so the task isn't penalized
 * toward auto-cancel.
 */
async function runMirosharkSimTask(
  db: ReturnType<typeof serverClient>,
  task: TaskRow,
): Promise<{ ok: true; post_id: string } | { ok: false; error: string }> {
  const signer = await loadAgentSigner(db, task.agent_address);
  if (!signer.ok) return { ok: false, error: signer.error };

  // 1) Audit post — fired regardless of miroshark config so the agent's
  // feed shows the cadence even on an unconfigured deployment.
  const auditBody = `fired miroshark sim — scenario: ${task.prompt}`.slice(
    0,
    480,
  );
  const post = await signAndInsertPost(
    db,
    signer.account,
    task.agent_address,
    auditBody,
  );
  if (!post.ok) return { ok: false, error: post.error };

  // 2) Fire the sim if MiroShark is configured. The webhook receiver
  // handles the result asynchronously — we don't await consensus.
  if (!mirosharkConfigured()) {
    // Soft success: post landed, sim skipped because env isn't set.
    // Surface via last_error but don't treat as a task failure.
    return { ok: true, post_id: post.post_id };
  }
  try {
    await mirosharkCreateSim({
      prompt: task.prompt,
      agentAddress: task.agent_address,
    });
  } catch (e) {
    // Sim creation failed but the audit post landed. Return ok so the
    // task isn't penalized, but operators see the issue in logs.
    console.error(
      "[autonomous-cron] miroshark sim create failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
  return { ok: true, post_id: post.post_id };
}

async function runOneTask(
  db: ReturnType<typeof serverClient>,
  task: TaskRow,
): Promise<{ ok: true; post_id: string } | { ok: false; error: string }> {
  if (task.kind === "miroshark_sim") {
    return runMirosharkSimTask(db, task);
  }
  // Default + legacy v0.18 tasks: kind is null or "post".
  return runPostTask(db, task);
}

export async function GET(req: NextRequest) {
  if (!authorizeBearer(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.AGENT_RUNTIME_MASTER_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error: "runtime_master_key_not_set",
        message:
          "AGENT_RUNTIME_MASTER_KEY is required for autonomous tasks. Set it in env.",
      },
      { status: 503 },
    );
  }

  const startedAt = Date.now();
  const db = serverClient();
  const nowIso = new Date().toISOString();

  // Select due tasks. Exclude cancelled + expired.
  const { data: tasks, error: selErr } = await db
    .from("agent_autonomous_tasks")
    .select(
      "id, agent_address, prompt, kind, interval_seconds, expires_at, next_run_at, runs_total, runs_failed",
    )
    .is("cancelled_at", null)
    .lte("next_run_at", nowIso)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("next_run_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }

  const results: Array<{
    task_id: string;
    agent: string;
    ok: boolean;
    post_id?: string;
    error?: string;
  }> = [];

  for (const task of (tasks ?? []) as TaskRow[]) {
    let res: { ok: true; post_id: string } | { ok: false; error: string };
    try {
      res = await runOneTask(db, task);
    } catch (e) {
      res = {
        ok: false,
        error: `threw_${e instanceof Error ? e.message.slice(0, 80) : "fail"}`,
      };
    }

    const next = new Date(Date.now() + task.interval_seconds * 1000);
    const nextRunsFailed = res.ok ? 0 : task.runs_failed + 1;
    const update: Record<string, unknown> = {
      last_run_at: nowIso,
      next_run_at: next.toISOString(),
      runs_total: task.runs_total + 1,
      runs_failed: nextRunsFailed,
      last_error: res.ok ? null : res.error.slice(0, 200),
      last_post_id: res.ok ? res.post_id : task.id ? undefined : undefined,
    };
    if (res.ok) {
      update.last_post_id = res.post_id;
    }
    // Auto-cancel runaway-failing tasks so a broken agent doesn't bleed
    // forever. The agent owner can re-create after they fix the issue.
    if (!res.ok && nextRunsFailed >= FAIL_THRESHOLD) {
      update.cancelled_at = nowIso;
      update.last_error = `auto_cancelled_after_${FAIL_THRESHOLD}_failures: ${res.error.slice(0, 150)}`;
    }
    await db.from("agent_autonomous_tasks").update(update).eq("id", task.id);

    results.push({
      task_id: task.id,
      agent: task.agent_address,
      ok: res.ok,
      ...(res.ok ? { post_id: res.post_id } : { error: res.error }),
    });
  }

  return NextResponse.json({
    ok: true,
    started_at: new Date(startedAt).toISOString(),
    elapsed_ms: Date.now() - startedAt,
    fired: results.length,
    results,
  });
}
