import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { botPost } from "@/lib/signa-bots";
import { getPortfolio } from "@/lib/portfolio";
import { formatUsd, formatPct, tokenOnBase } from "@/lib/geckoterminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily AI digest cron.
 *
 * For every user with daily_digest_enabled=true whose last_digest_at
 * is null OR older than 23h, generate a personalized summary and
 * post it to the SIGNA feed via the bankr.bot.signa bot (the most
 * generic "system" bot we already have keys for — v2 would mint a
 * dedicated digest.bot.signa via /generate-bot-keys).
 *
 * Content includes:
 *   - net worth + 24h change
 *   - top holding
 *   - watchlist's biggest mover
 *   - footer link back to /me
 *
 * Caps:
 *   - 10 users per tick (Vercel function timeout safety)
 *   - 23h floor so a re-fire within 24h doesn't double-send
 *
 * Auth: CRON_SECRET via Bearer or ?key=
 *
 * Scheduling:
 *   - Don't ship in vercel.json (Hobby tier blocks 10-min crons).
 *   - GitHub Actions workflow OR cron-job.org hits this once per
 *     hour. The 23h floor handles dedup.
 */

const MAX_USERS_PER_TICK = 10;
const MIN_HOURS_BETWEEN = 23;

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  return false;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = serverClient();
  const sinceIso = new Date(
    Date.now() - MIN_HOURS_BETWEEN * 60 * 60 * 1000,
  ).toISOString();

  const { data: users, error } = await db
    .from("users")
    .select("address, basename, ens_name, last_digest_at")
    .eq("daily_digest_enabled", true)
    .or(`last_digest_at.is.null,last_digest_at.lt.${sinceIso}`)
    .limit(MAX_USERS_PER_TICK);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!users || users.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      note: "no users due for a digest",
    });
  }

  const results: Array<{ address: string; ok: boolean; reason?: string }> = [];

  for (const u of users) {
    try {
      const { data: wl } = await db
        .from("watchlists")
        .select("token_address")
        .eq("address", u.address);
      const watchlistAddrs = (wl ?? []).map((r) => r.token_address);

      const port = await getPortfolio(u.address, watchlistAddrs);

      let topMover: {
        symbol: string;
        change: number;
      } | null = null;
      for (const addr of watchlistAddrs.slice(0, 10)) {
        const t = await tokenOnBase(addr);
        if (!t || t.change_24h_pct == null) continue;
        if (
          !topMover ||
          Math.abs(t.change_24h_pct) > Math.abs(topMover.change)
        ) {
          topMover = { symbol: t.symbol, change: t.change_24h_pct };
        }
      }

      const display = u.basename ?? u.ens_name ?? shortAddr(u.address);
      const lines: string[] = [];
      lines.push(`📬 daily for ${display}`);
      lines.push(``);
      lines.push(
        `portfolio ${formatUsd(port.total_usd)} · ${
          port.change_24h_pct >= 0 ? "+" : ""
        }${formatPct(port.change_24h_pct)} 24h`,
      );
      if (port.positions.length > 0) {
        const top = port.positions[0];
        lines.push(
          `top hold $${top.symbol}: ${formatUsd(top.value_usd)} (${formatPct(top.change_24h_pct)})`,
        );
      }
      if (topMover) {
        const arrow = topMover.change >= 0 ? "📈" : "📉";
        lines.push(
          `${arrow} watchlist mover $${topMover.symbol}: ${formatPct(topMover.change)}`,
        );
      }
      lines.push(``);
      lines.push(`see /me · signaagent.xyz/me`);

      const content = lines.join("\n");
      const post = await botPost("bankr", content);
      if (!post.ok) {
        results.push({ address: u.address, ok: false, reason: post.reason });
        continue;
      }

      await db
        .from("users")
        .update({ last_digest_at: new Date().toISOString() })
        .eq("address", u.address);
      results.push({ address: u.address, ok: true });
    } catch (e) {
      results.push({
        address: u.address,
        ok: false,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: users.length,
    results,
  });
}
