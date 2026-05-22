import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { gitlawbPlaygroundUrl } from "@/lib/skills/gitlawb";
import { botPost } from "@/lib/signa-bots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[address]/gitlawb-build
 *
 * Public, no-auth endpoint. Any visitor on a SIGNA agent profile can
 * click "Build on gitlawb", type a repo name + short pitch, and we
 * compose a deeplink to playground.gitlawb.app pre-seeded with the
 * agent's name, system_prompt, and a SIGNA backlink.
 *
 * Server-side we also publish a wallet-signed audit cast from
 * gitlawb.bot.signa to /feed/gitlawb so the SIGNA network sees that a
 * gitlawb-build was triggered against this agent. That makes the agent
 * profile a real funnel into gitlawb — when the gitlawb dev looks at
 * referrer traffic on playground.gitlawb.app they see signaagent.xyz
 * driving real users.
 *
 * No write access to gitlawb is needed — the user does the actual
 * repo creation in the playground using their own DID + UCAN. SIGNA
 * just plants the seed.
 *
 * Body: { repo_name: string, pitch?: string }
 *
 * Rate-limited per IP (10 builds per 10 min).
 * Returns: { ok, playground_url, audit_post_id?, agent_name }
 */

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const MAX_REPO_NAME = 64;
const MAX_PITCH = 280;

// IP -> list of fire timestamps within the window.
const rateLimitMap = new Map<string, number[]>();

function ipFrom(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(ip: string): {
  ok: boolean;
  remaining: number;
  retry_after_seconds?: number;
} {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const arr = (rateLimitMap.get(ip) ?? []).filter((t) => t > cutoff);
  if (arr.length >= RATE_LIMIT_MAX) {
    return {
      ok: false,
      remaining: 0,
      retry_after_seconds: Math.max(
        1,
        Math.ceil((arr[0] + RATE_LIMIT_WINDOW_MS - now) / 1000),
      ),
    };
  }
  arr.push(now);
  rateLimitMap.set(ip, arr);
  return { ok: true, remaining: RATE_LIMIT_MAX - arr.length };
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

  let body: { repo_name?: string; pitch?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const repo_name = (body.repo_name ?? "").trim();
  const pitch = (body.pitch ?? "").trim();
  if (repo_name.length < 2) {
    return NextResponse.json(
      { error: "repo_name_too_short_min_2_chars" },
      { status: 400 },
    );
  }
  if (repo_name.length > MAX_REPO_NAME) {
    return NextResponse.json(
      { error: `repo_name_too_long_max_${MAX_REPO_NAME}_chars` },
      { status: 400 },
    );
  }
  // Loose sanity check on repo name shape — gitlawb permits richer
  // names than git but we want something a human can read.
  if (!/^[a-zA-Z0-9._\- ]+$/.test(repo_name)) {
    return NextResponse.json(
      { error: "repo_name_must_be_alnum_dash_dot_underscore_space" },
      { status: 400 },
    );
  }
  if (pitch.length > MAX_PITCH) {
    return NextResponse.json(
      { error: `pitch_too_long_max_${MAX_PITCH}_chars` },
      { status: 400 },
    );
  }

  // Pull agent context so the playground deeplink can pre-fill the
  // builder with the agent's name + system_prompt. If the agent doesn't
  // exist we 404 so visitors can't generate URLs for fake addresses.
  const [{ data: agentRow, error: agentErr }, { data: userRow }] =
    await Promise.all([
      supabase
        .from("agents")
        .select("address, name, description, system_prompt, deleted_at")
        .eq("address", agent)
        .maybeSingle(),
      supabase
        .from("users")
        .select("gitlawb_did")
        .eq("address", agent)
        .maybeSingle(),
    ]);
  if (agentErr) {
    return NextResponse.json({ error: agentErr.message }, { status: 500 });
  }
  if (!agentRow || agentRow.deleted_at) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }

  const ip = ipFrom(req);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        retry_after_seconds: rl.retry_after_seconds,
      },
      {
        status: 429,
        headers: { "retry-after": String(rl.retry_after_seconds ?? 60) },
      },
    );
  }

  // Compose the playground deeplink. The agent's system_prompt is the
  // seed content; we let the gitlawbPlaygroundUrl helper handle the
  // URL encoding + 800-char cap. We prepend the user's repo_name +
  // pitch so the playground starts in the right project frame.
  const seedPrompt = [
    `Repo: ${repo_name}`,
    pitch ? `Pitch: ${pitch}` : null,
    `Seeded from SIGNA agent: ${agentRow.name}`,
    agentRow.description ? `Agent description: ${agentRow.description}` : null,
    agentRow.system_prompt
      ? `Agent system prompt: ${agentRow.system_prompt}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const playground_url = gitlawbPlaygroundUrl({
    prompt: seedPrompt,
    agentName: agentRow.name,
    agentAddress: agent,
    agentDid: userRow?.gitlawb_did ?? undefined,
  });

  // Audit cast from gitlawb.bot.signa so this build event lands on
  // /feed/gitlawb and cross-node federates. Soft-fail if the bot
  // wallet isn't configured — the playground URL is still useful.
  const auditBody =
    `🛠 proposed gitlawb repo "${repo_name}" seeded from SIGNA agent ${agentRow.name} (${agent}). ` +
    `open the playground: ${playground_url}`;
  let audit_post_id: string | null = null;
  const post = await botPost("gitlawb", auditBody);
  if (post.ok) {
    audit_post_id = post.postId;
  }

  return NextResponse.json({
    ok: true,
    agent_address: agent,
    agent_name: agentRow.name,
    playground_url,
    audit_post_id,
    feed_url: "/feed/gitlawb",
    rate_limit_remaining: rl.remaining,
  });
}
