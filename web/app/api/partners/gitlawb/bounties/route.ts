import { NextRequest, NextResponse } from "next/server";
import { gitlawbTasks, type GitlawbTask } from "@/lib/skills/gitlawb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/partners/gitlawb/bounties?limit=30
 *
 * Public read endpoint — surfaces every open gitlawb task with a
 * bounty attached, sorted by bounty size desc then recency.
 *
 * The bounty USD ranking is intentionally naïve: gitlawb tasks carry
 * { bounty: { amount, token } } where `amount` is the raw token amount
 * and `token` is a symbol. We sort lexicographically by symbol then by
 * numeric amount so the biggest payout in any token rises to the top.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function bountyScore(t: GitlawbTask): number {
  const amt = Number(t.bounty?.amount ?? 0);
  if (!Number.isFinite(amt) || amt <= 0) return 0;
  return amt;
}

export async function GET(req: NextRequest) {
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 30), 1),
    100,
  );

  const all = await gitlawbTasks({ status: "open", limit: 100 });
  const withBounty = (all ?? []).filter((t) => {
    const amt = Number(t.bounty?.amount ?? 0);
    return Number.isFinite(amt) && amt > 0;
  });
  withBounty.sort((a, b) => {
    const sa = bountyScore(a);
    const sb = bountyScore(b);
    if (sb !== sa) return sb - sa;
    // Then by recency
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });

  return NextResponse.json(
    {
      ok: true,
      count: withBounty.length,
      total_seen: all.length,
      bounties: withBounty.slice(0, limit),
    },
    { status: 200, headers: CORS },
  );
}
