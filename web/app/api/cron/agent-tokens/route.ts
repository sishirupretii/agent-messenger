import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { serverClient } from "@/lib/supabase";
import { authorizeBearer } from "@/lib/secret-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Agent → token auto-detector.
 *
 * For every launched SIGNA agent whose `bankr_token_address` is still
 * null, look at the agent's tx history on Base. If we find a contract
 * creation, verify it looks like an ERC-20 (has `symbol()` + `decimals()`
 * + `totalSupply()`), then record the token contract on the agent row.
 *
 * Why this is "real" detection and not a Bankr-only hack:
 *   - Catches any path that ends in "agent wallet deploys a token":
 *     Bankr deeplink, Clanker, direct Solidity deploy, etc.
 *   - Verification is by reading the contract on chain, not by trusting
 *     a third-party label.
 *   - Re-runs every poll cycle until the field is filled — agents
 *     tokenized later still get flipped to live.
 *
 * Limits:
 *   - Caps at MAX_AGENTS_PER_TICK agents per run so a stuck BaseScan
 *     can't take down the cron job.
 *   - Only looks at the agent's first 20 outgoing txs (sorted newest
 *     first). If you deployed 21 contracts before tokenizing, sorry.
 *   - Bankr-launched tokens where the BANKR factory is the deployer
 *     (not the agent wallet) won't be caught here. Need a separate
 *     factory-event watcher for that path. Tracked as a follow-up.
 *
 * Schedule: hit by the same GitHub Actions cron alongside the bridges.
 */

const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const BASESCAN_URL = "https://api.basescan.org/api";
const MAX_AGENTS_PER_TICK = 20;

const baseClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC),
});

const ERC20_ABI = [
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// Constant-time CRON_SECRET check via the shared helper; fail-closed
// when env unset.
function authorize(req: NextRequest): boolean {
  return authorizeBearer(req, "CRON_SECRET");
}

type BaseScanTx = {
  hash: string;
  from: string;
  to: string;
  contractAddress: string;
  isError: string;
};

async function fetchAgentDeploys(agentAddress: string): Promise<string[]> {
  const url =
    `${BASESCAN_URL}?module=account&action=txlist` +
    `&address=${agentAddress}&startblock=0&endblock=99999999` +
    `&sort=desc&page=1&offset=20`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const j: { status: string; result: BaseScanTx[] | string } = await res.json();
  if (j.status !== "1" || !Array.isArray(j.result)) return [];
  return j.result
    .filter(
      (t) =>
        (t.to === "" || t.to === null) &&
        t.contractAddress &&
        t.isError !== "1",
    )
    .map((t) => t.contractAddress.toLowerCase());
}

async function looksLikeERC20(address: Address): Promise<{
  symbol: string;
  decimals: number;
  totalSupply: string;
} | null> {
  try {
    const [symbol, decimals, totalSupply] = await Promise.all([
      baseClient.readContract({
        address,
        abi: ERC20_ABI,
        functionName: "symbol",
      }),
      baseClient.readContract({
        address,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
      baseClient.readContract({
        address,
        abi: ERC20_ABI,
        functionName: "totalSupply",
      }),
    ]);
    return {
      symbol: symbol as string,
      decimals: Number(decimals),
      totalSupply: (totalSupply as bigint).toString(),
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = serverClient();
  const { data: agents, error } = await db
    .from("agents")
    .select("address, name")
    .is("deleted_at", null)
    .is("bankr_token_address", null)
    .not("launched_at", "is", null)
    .order("launched_at", { ascending: false })
    .limit(MAX_AGENTS_PER_TICK);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!agents || agents.length === 0) {
    return NextResponse.json({
      ok: true,
      checked: 0,
      detected: 0,
      note: "no launched agents pending token detection",
    });
  }

  const detected: Array<{
    agent: string;
    name: string;
    token: string;
    symbol: string;
  }> = [];
  const errors: Array<{ agent: string; reason: string }> = [];

  for (const a of agents) {
    try {
      const deploys = await fetchAgentDeploys(a.address);
      let matched: { address: string; symbol: string } | null = null;
      for (const contract of deploys) {
        const meta = await looksLikeERC20(contract as Address);
        if (meta && meta.symbol && meta.decimals <= 30) {
          matched = { address: contract, symbol: meta.symbol };
          break;
        }
      }
      if (matched) {
        const { error: updateErr } = await db
          .from("agents")
          .update({
            bankr_token_address: matched.address,
            updated_at: new Date().toISOString(),
          })
          .eq("address", a.address);
        if (updateErr) {
          errors.push({ agent: a.address, reason: updateErr.message });
        } else {
          detected.push({
            agent: a.address,
            name: a.name,
            token: matched.address,
            symbol: matched.symbol,
          });
        }
      }
    } catch (e) {
      errors.push({
        agent: a.address,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    checked: agents.length,
    detected: detected.length,
    new_tokens: detected,
    errors,
  });
}
