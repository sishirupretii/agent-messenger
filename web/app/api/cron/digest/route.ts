import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { serverClient } from "@/lib/supabase";
import { botPost } from "@/lib/signa-bots";
import { getPortfolio } from "@/lib/portfolio";
import { formatUsd, formatPct, tokenOnBase } from "@/lib/geckoterminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily AI digest cron — Groq-generated.
 *
 * Real architecture:
 *   1. Pull every user where daily_digest_enabled=true and last_digest_at
 *      is null OR older than 23h.
 *   2. Build a per-user data packet: portfolio (live balances + GeckoTerminal
 *      prices), watchlist with current 24h changes, top mover.
 *   3. Hand the packet to Groq (llama-3.3-70b-versatile) with a tight
 *      system prompt that asks for a 3-line wallet-native digest.
 *   4. Post the Groq-generated text as a wallet-signed feed post via
 *      bankr.bot.signa (existing bot). The post is real, signed,
 *      auditable. The text inside is real AI output.
 *   5. Stamp users.last_digest_at = now() so the 23h floor holds.
 *
 * If GROQ_API_KEY is missing, we fall back to a deterministic
 * templated digest (still wallet-signed + posted, but without LLM
 * voice). This means the cron never fails just because Groq is down.
 *
 * Caps:
 *   10 users per tick (Groq cost + Vercel function timeout safety)
 *   23h floor (server-side dedup independent of cron jitter)
 *
 * Auth: CRON_SECRET via Bearer or ?key=
 */

const MAX_USERS_PER_TICK = 10;
const MIN_HOURS_BETWEEN = 23;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

import { authorizeBearer } from "@/lib/secret-auth";

/**
 * Cron authorization. Constant-time check against CRON_SECRET (set in
 * Vercel env + passed automatically by Vercel Cron). Strict fail-closed
 * — if the env isn't set, every request is 401, including local. Set
 * CRON_SECRET locally to test.
 */
function authorize(req: NextRequest): boolean {
  return authorizeBearer(req, "CRON_SECRET");
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

type DigestFacts = {
  display: string;
  net_worth_usd: number;
  change_24h_pct: number;
  change_24h_usd: number;
  top_hold: { symbol: string; value_usd: number; change_24h_pct: number | null } | null;
  watchlist_mover: { symbol: string; change_24h_pct: number } | null;
  position_count: number;
  watchlist_count: number;
};

async function gatherFacts(
  address: string,
  display: string,
  watchlist: string[],
): Promise<DigestFacts> {
  const port = await getPortfolio(address, watchlist);
  let mover: DigestFacts["watchlist_mover"] = null;
  for (const addr of watchlist.slice(0, 10)) {
    const t = await tokenOnBase(addr);
    if (!t || t.change_24h_pct == null) continue;
    if (!mover || Math.abs(t.change_24h_pct) > Math.abs(mover.change_24h_pct)) {
      mover = { symbol: t.symbol, change_24h_pct: t.change_24h_pct };
    }
  }
  return {
    display,
    net_worth_usd: port.total_usd,
    change_24h_pct: port.change_24h_pct,
    change_24h_usd: port.change_24h_usd,
    top_hold: port.positions[0]
      ? {
          symbol: port.positions[0].symbol,
          value_usd: port.positions[0].value_usd,
          change_24h_pct: port.positions[0].change_24h_pct,
        }
      : null,
    watchlist_mover: mover,
    position_count: port.positions.length,
    watchlist_count: watchlist.length,
  };
}

async function groqDigest(facts: DigestFacts): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const client = new Groq({ apiKey: key });
    const system =
      "You write short daily digests for crypto wallets on Base. Tone: terse, factual, no hype, no emoji storms. Mono-space-friendly format. " +
      "Output exactly 3 lines: line 1 the headline including net worth + 24h change, line 2 the top hold, line 3 the watchlist mover or a closing line. " +
      "Use $X.XX for prices ≥$1, $0.0001 for fractions, +X.XX%/-X.XX% for change. Reference symbols with a leading $. " +
      "Do not invent numbers — only use the facts provided. If a field is missing, omit that line.";
    const user = JSON.stringify(facts, null, 2);
    const res = await client.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Generate today's digest for ${facts.display}. Facts:\n${user}`,
        },
      ],
      temperature: 0.4,
      max_completion_tokens: 200,
    });
    const text = res.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (e) {
    console.error(
      "[digest] groq failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

function templateDigest(facts: DigestFacts): string {
  const lines: string[] = [];
  lines.push(`📬 daily for ${facts.display}`);
  lines.push(``);
  lines.push(
    `portfolio ${formatUsd(facts.net_worth_usd)} · ${
      facts.change_24h_pct >= 0 ? "+" : ""
    }${formatPct(facts.change_24h_pct)} 24h`,
  );
  if (facts.top_hold) {
    lines.push(
      `top hold $${facts.top_hold.symbol}: ${formatUsd(facts.top_hold.value_usd)} (${formatPct(
        facts.top_hold.change_24h_pct,
      )})`,
    );
  }
  if (facts.watchlist_mover) {
    const arrow = facts.watchlist_mover.change_24h_pct >= 0 ? "📈" : "📉";
    lines.push(
      `${arrow} watchlist mover $${facts.watchlist_mover.symbol}: ${formatPct(facts.watchlist_mover.change_24h_pct)}`,
    );
  }
  return lines.join("\n");
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

  const results: Array<{
    address: string;
    ok: boolean;
    source?: "groq" | "template";
    reason?: string;
  }> = [];

  for (const u of users) {
    try {
      const { data: wl } = await db
        .from("watchlists")
        .select("token_address")
        .eq("address", u.address);
      const watchlistAddrs = (wl ?? []).map((r) => r.token_address);

      const display =
        u.basename ?? u.ens_name ?? shortAddr(u.address);
      const facts = await gatherFacts(u.address, display, watchlistAddrs);

      // Skip empty wallets — no portfolio = no useful digest.
      if (facts.position_count === 0 && facts.watchlist_count === 0) {
        results.push({
          address: u.address,
          ok: false,
          reason: "no positions, no watchlist — skipping",
        });
        continue;
      }

      // Real Groq generation first, fall back to deterministic template.
      const groqText = await groqDigest(facts);
      const content = groqText
        ? `📬 daily for ${display}\n\n${groqText}\n\nsee /me · signaagent.xyz/me`
        : `${templateDigest(facts)}\n\nsee /me · signaagent.xyz/me`;

      const post = await botPost("bankr", content);
      if (!post.ok) {
        results.push({ address: u.address, ok: false, reason: post.reason });
        continue;
      }

      await db
        .from("users")
        .update({ last_digest_at: new Date().toISOString() })
        .eq("address", u.address);
      results.push({
        address: u.address,
        ok: true,
        source: groqText ? "groq" : "template",
      });
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
