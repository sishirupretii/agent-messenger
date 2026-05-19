import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CORS handled centrally by middleware.ts.

/**
 * GET /api/holders/[symbol]
 *
 * Returns the list of registered SIGNA users who currently hold a
 * non-zero balance of the given partner token, sorted by balance desc.
 *
 * We don't have a chain indexer, so the surface is bounded: we scan
 * the SIGNA users table (typically <1000 rows in this phase) and do
 * one ERC-20 balanceOf call per wallet. Results cached in-process 5
 * minutes per symbol.
 *
 * v2: maintain a denormalized token_holders table populated by a cron
 * sweep so the page renders in <100ms regardless of user count.
 */

const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const baseClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC),
});

const BALANCE_OF_ABI = [
  {
    name: "balanceOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "owner", type: "address" as const }],
    outputs: [{ name: "balance", type: "uint256" as const }],
  },
] as const;

type Holder = {
  address: string;
  basename: string | null;
  ens_name: string | null;
  balance_raw: string;
  balance: string;
};

type CacheEntry = { ts: number; data: Holder[] };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

function fmt(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  if (frac === 0n) return whole.toLocaleString("en-US");
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  // 4 sig fractional chars; group thousands for the whole portion
  return `${whole.toLocaleString("en-US")}.${fracStr.slice(0, 4)}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: rawSym } = await params;
  const symbol = rawSym.toUpperCase();

  const token = getToken(symbol);
  if (!token || !token.address) {
    return NextResponse.json(
      { error: "unknown_token", symbol },
      { status: 404 },
    );
  }

  // Hit cache
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.ts < TTL_MS) {
    return NextResponse.json({
      ok: true,
      symbol,
      token: {
        address: token.address,
        name: token.name,
        decimals: token.decimals,
        project: token.project ?? null,
        homepage: token.homepage ?? null,
      },
      holders: hit.data,
      cached: true,
    });
  }

  // Pull all SIGNA users (recently active first, capped at 500 for cost).
  const { data: users, error } = await supabase
    .from("users")
    .select("address, basename, ens_name, registered_at")
    .order("registered_at", { ascending: false })
    .limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!users || users.length === 0) {
    return NextResponse.json({
      ok: true,
      symbol,
      token: {
        address: token.address,
        name: token.name,
        decimals: token.decimals,
      },
      holders: [],
    });
  }

  // Multicall via viem getContract.balanceOf — but viem doesn't auto-batch
  // here, so we parallelize up to 30 at a time. Public Base RPC handles
  // this fine for a one-off page render.
  const CHUNK = 30;
  const all: Holder[] = [];
  for (let i = 0; i < users.length; i += CHUNK) {
    const slice = users.slice(i, i + CHUNK);
    const balances = await Promise.all(
      slice.map(async (u) => {
        try {
          const b = (await baseClient.readContract({
            address: token.address as Address,
            abi: BALANCE_OF_ABI,
            functionName: "balanceOf",
            args: [u.address as Address],
          })) as bigint;
          return b;
        } catch {
          return 0n;
        }
      }),
    );
    for (let j = 0; j < slice.length; j++) {
      const raw = balances[j];
      if (raw <= 0n) continue;
      const u = slice[j];
      all.push({
        address: u.address,
        basename: u.basename,
        ens_name: u.ens_name,
        balance_raw: raw.toString(),
        balance: fmt(raw, token.decimals),
      });
    }
  }

  // Sort by balance desc (compare bigints via raw)
  all.sort((a, b) => {
    const ba = BigInt(a.balance_raw);
    const bb = BigInt(b.balance_raw);
    return ba < bb ? 1 : ba > bb ? -1 : 0;
  });

  cache.set(symbol, { ts: Date.now(), data: all });

  return NextResponse.json({
    ok: true,
    symbol,
    token: {
      address: token.address,
      name: token.name,
      decimals: token.decimals,
      project: token.project ?? null,
      homepage: token.homepage ?? null,
    },
    holders: all,
    cached: false,
  });
}
