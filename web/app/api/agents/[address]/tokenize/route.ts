import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[address]/tokenize
 *
 * One-click tokenization via Bankr's real token-launch API:
 *   POST https://api.bankr.bot/token-launches/deploy
 *   { tokenName, tokenSymbol, feeRecipient: { type:'wallet', value:'0x…' } }
 *   Headers: X-Partner-Key (org-level) OR per-wallet X-API-Key/Bearer.
 *   Returns: token address + Uniswap V4 pool metadata.
 *
 * Required env on Vercel for this to actually fire:
 *   BANKR_PARTNER_KEY     (apply at bankr.bot to become a partner —
 *                          starts with bk_ptr_)
 *
 * If BANKR_PARTNER_KEY is missing, we return a structured 503 with a
 * link to the deeplink fallback instead of pretending the endpoint
 * is broken. The agent profile UI handles that gracefully.
 *
 * Request body (from the SIGNA agent profile button):
 *   {
 *     tokenName?:   string  (default: agent.name)
 *     tokenSymbol?: string  (default: derived from agent.name)
 *   }
 *
 * The agent's own wallet (agent.address) is always the feeRecipient
 * so fees flow to whoever controls the agent — not to SIGNA.
 */

const BANKR_API = "https://api.bankr.bot";

function symbolize(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase()
      .slice(0, 8) || "AGENT"
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  const partnerKey = process.env.BANKR_PARTNER_KEY;
  if (!partnerKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "bankr_partner_key_not_configured",
        message:
          "Bankr Partner Key not set on this SIGNA deployment. Use the deeplink fallback to tokenize manually.",
        deeplink: `https://bankr.bot/agents/${address}`,
        apply_partner: "https://docs.bankr.bot/token-launching/overview",
      },
      { status: 503 },
    );
  }

  // Pull the agent first — we need its name for default tokenName/Symbol,
  // and to confirm it exists + isn't already tokenized.
  const db = serverClient();
  const { data: agent, error: fetchErr } = await db
    .from("agents")
    .select("address, name, bankr_token_address")
    .eq("address", address)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!agent) {
    return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
  }
  if (agent.bankr_token_address) {
    return NextResponse.json(
      {
        ok: false,
        error: "already_tokenized",
        token: agent.bankr_token_address,
        message: `${agent.name} already has a token at ${agent.bankr_token_address}`,
      },
      { status: 409 },
    );
  }

  let body: { tokenName?: string; tokenSymbol?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine — we'll use defaults.
  }

  const tokenName = (body.tokenName ?? agent.name).slice(0, 32);
  const tokenSymbol = symbolize(body.tokenSymbol ?? agent.name);

  // Call Bankr.
  let bankrJson: {
    tokenAddress?: string;
    poolAddress?: string;
    transactionHash?: string;
    [k: string]: unknown;
  };
  try {
    const res = await fetch(`${BANKR_API}/token-launches/deploy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Partner-Key": partnerKey,
      },
      body: JSON.stringify({
        tokenName,
        tokenSymbol,
        feeRecipient: { type: "wallet", value: agent.address },
      }),
    });
    bankrJson = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "bankr_rejected",
          status: res.status,
          bankr: bankrJson,
        },
        { status: 502 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "bankr_unreachable",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  const tokenAddr = bankrJson.tokenAddress?.toLowerCase();
  if (!tokenAddr || !/^0x[a-f0-9]{40}$/.test(tokenAddr)) {
    return NextResponse.json(
      {
        ok: false,
        error: "bankr_returned_no_token",
        bankr: bankrJson,
      },
      { status: 502 },
    );
  }

  // Persist on the agent row so the profile chip flips to "live" immediately
  // (the agent-tokens cron would catch it within 10 min, but this is faster).
  const { error: updateErr } = await db
    .from("agents")
    .update({
      bankr_token_address: tokenAddr,
      updated_at: new Date().toISOString(),
    })
    .eq("address", address);

  if (updateErr) {
    return NextResponse.json(
      {
        ok: false,
        error: "persist_failed",
        message: updateErr.message,
        bankr_token: tokenAddr,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    agent: agent.address,
    token: tokenAddr,
    tokenName,
    tokenSymbol,
    bankr: bankrJson,
  });
}
