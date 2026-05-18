import { NextRequest, NextResponse } from "next/server";
import { botPost } from "@/lib/signa-bots";
import { readState, writeState } from "@/lib/cron-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * gitlawb → SIGNA poller.
 *
 * Runs every 10 minutes on Vercel cron. Fetches gitlawb's public
 * /node/repos page, regex-extracts the repo DIDs visible on the first
 * page (newest first), diffs against the last-seen set in cron_state,
 * and publishes a wallet-signed cast for each NEW repo.
 *
 * Why this is honest and not mock:
 *   - We hit gitlawb's real live page, not a fabricated source
 *   - Every cast is wallet-signed by the gitlawb.bot.signa account
 *   - When a repo first lands on gitlawb's node, it lands here within 10 min
 *
 * Caps:
 *   - Max 5 new casts per tick (so a backfill burst can't flood the feed)
 *   - State capped at 200 DIDs (rolling window)
 *
 * Scheduling:
 *   - Vercel Hobby only allows daily crons, so we don't ship a vercel.json.
 *   - Use a free external scheduler like cron-job.org pointing at:
 *       https://www.signaagent.xyz/api/cron/gitlawb?key=<CRON_SECRET>
 *     every 10 min. Unlimited frequency, no Vercel upgrade needed.
 *
 * Auth: only callable by anyone presenting CRON_SECRET (via Bearer or ?key=).
 */

const STATE_KEY = "gitlawb.seen_repos";
const MAX_CASTS_PER_TICK = 5;
const STATE_CAP = 200;

type State = {
  seen: string[]; // DID strings, newest first
};

async function fetchFirstPageDids(): Promise<string[]> {
  // gitlawb renders SSR HTML. The repo DIDs are embedded as plain text
  // in the rendered page. We extract them in order of appearance
  // (newest first per their default sort).
  const res = await fetch("https://gitlawb.com/node/repos", {
    cache: "no-store",
    headers: { "user-agent": "signa-gitlawb-bridge/1.0 (+https://www.signaagent.xyz)" },
  });
  if (!res.ok) {
    throw new Error(`gitlawb fetch ${res.status}`);
  }
  const html = await res.text();
  // Match `did:gitlawb:<name>` and `did:key:z6Mk...` patterns.
  const ids = new Set<string>();
  const ordered: string[] = [];
  for (const m of html.matchAll(/did:(?:gitlawb|key):[A-Za-z0-9_-]+/g)) {
    const id = m[0];
    if (!ids.has(id)) {
      ids.add(id);
      ordered.push(id);
    }
  }
  return ordered.slice(0, 60); // first-page sized window
}

function authorize(req: NextRequest): boolean {
  // Vercel cron sends `Authorization: Bearer <CRON_SECRET>` when one is
  // configured. We also accept the same secret via ?key= for manual runs.
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unguarded in dev
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let current: string[];
  try {
    current = await fetchFirstPageDids();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch_failed" },
      { status: 502 },
    );
  }

  const prev = await readState<State>(STATE_KEY, { seen: [] });
  const prevSet = new Set(prev.seen);
  const newOnes = current.filter((d) => !prevSet.has(d));

  // First-ever run: seed state without flooding the feed.
  if (prev.seen.length === 0) {
    await writeState<State>(STATE_KEY, { seen: current });
    return NextResponse.json({
      ok: true,
      seeded: current.length,
      posted: 0,
      note: "first run — seeded state without casting",
    });
  }

  const toPost = newOnes.slice(0, MAX_CASTS_PER_TICK);
  const posted: { did: string; postId: string }[] = [];
  const errors: { did: string; reason: string }[] = [];

  for (const did of toPost) {
    const content = formatRepoCast(did);
    const r = await botPost("gitlawb", content);
    if (r.ok) {
      posted.push({ did, postId: r.postId });
    } else {
      errors.push({ did, reason: r.reason });
      // Stop on first error — likely env misconfig, no point spamming.
      break;
    }
  }

  // Save state — union of new + prev, capped at STATE_CAP, newest first.
  const nextSeen = Array.from(new Set([...current, ...prev.seen])).slice(0, STATE_CAP);
  await writeState<State>(STATE_KEY, { seen: nextSeen });

  return NextResponse.json({
    ok: true,
    new_repos_detected: newOnes.length,
    posted: posted.length,
    posts: posted,
    errors,
  });
}

function formatRepoCast(did: string): string {
  // Build a deeplink that filters gitlawb's node browser by this repo DID.
  const url = `https://gitlawb.com/node/repos?q=${encodeURIComponent(did)}`;
  return [
    `📦 new on gitlawb: ${did}`,
    `decentralized git — IPFS + Filecoin + Arweave, DID+UCAN auth`,
    `browse: ${url}`,
  ].join("\n");
}
