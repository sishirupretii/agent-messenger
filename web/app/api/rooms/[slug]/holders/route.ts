import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { base, mainnet } from "viem/chains";
import { supabase } from "@/lib/supabase";
import { formatBalance } from "@/lib/room-gating";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/[slug]/holders?limit=20
 *
 * For a hold-to-chat gated room: collect every wallet that's ever
 * posted, multicall balanceOf for the gate token, sort by balance
 * desc, return the top N.
 *
 * Reads stay open, no auth. Cached for 60s in-memory per slug so the
 * page can render fast and the chain doesn't get hammered.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const BALANCE_OF_ABI = [
  {
    name: "balanceOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "account", type: "address" as const }],
    outputs: [{ name: "", type: "uint256" as const }],
  },
] as const;

function clientForChain(chain: string) {
  switch (chain.toLowerCase()) {
    case "base":
    case "8453":
      return createPublicClient({
        chain: base,
        transport: http(process.env.BASE_RPC_URL),
      });
    case "ethereum":
    case "mainnet":
    case "1":
      return createPublicClient({
        chain: mainnet,
        transport: http(process.env.MAINNET_RPC_URL),
      });
    default:
      return null;
  }
}

type CacheEntry = {
  ts: number;
  payload: unknown;
};
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 20), 1),
    50,
  );

  const cacheKey = `${slug}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload, { status: 200, headers: CORS });
  }

  const { data: room } = await supabase
    .from("signa_rooms")
    .select(
      "id, slug, gate_token_address, gate_chain, gate_token_symbol, gate_token_decimals",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!room) {
    return NextResponse.json(
      { ok: false, error: "room_not_found" },
      { status: 404, headers: CORS },
    );
  }
  if (!room.gate_token_address || !room.gate_chain) {
    const payload = {
      ok: true,
      gated: false,
      holders: [],
    };
    cache.set(cacheKey, { ts: Date.now(), payload });
    return NextResponse.json(payload, { status: 200, headers: CORS });
  }

  // Collect unique posters from this room's message history.
  const { data: msgs } = await supabase
    .from("signa_room_messages")
    .select("from_address")
    .eq("room_id", room.id)
    .order("ts", { ascending: false })
    .limit(500);

  const uniquePosters = Array.from(
    new Set((msgs ?? []).map((m) => String(m.from_address).toLowerCase())),
  );

  const client = clientForChain(room.gate_chain);
  if (!client || uniquePosters.length === 0) {
    const payload = {
      ok: true,
      gated: true,
      token: {
        address: room.gate_token_address,
        symbol: room.gate_token_symbol,
        decimals: room.gate_token_decimals,
        chain: room.gate_chain,
      },
      holders: [],
    };
    cache.set(cacheKey, { ts: Date.now(), payload });
    return NextResponse.json(payload, { status: 200, headers: CORS });
  }

  // Multicall balanceOf for every poster.
  const balances = await client.multicall({
    allowFailure: true,
    contracts: uniquePosters.map((addr) => ({
      address: room.gate_token_address as Address,
      abi: BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [addr as Address],
    })),
  });

  const holders = uniquePosters
    .map((addr, i) => {
      const r = balances[i] as { status: string; result?: unknown };
      const raw =
        r.status === "success" && typeof r.result === "bigint"
          ? (r.result as bigint).toString()
          : "0";
      return { address: addr, raw };
    })
    .filter((h) => h.raw !== "0")
    .sort((a, b) => {
      // BigInt comparison
      const ba = BigInt(a.raw);
      const bb = BigInt(b.raw);
      if (bb > ba) return 1;
      if (bb < ba) return -1;
      return 0;
    })
    .slice(0, limit)
    .map((h) => ({
      address: h.address,
      balance_raw: h.raw,
      balance: formatBalance(h.raw, room.gate_token_decimals),
    }));

  const payload = {
    ok: true,
    gated: true,
    token: {
      address: room.gate_token_address,
      symbol: room.gate_token_symbol,
      decimals: room.gate_token_decimals,
      chain: room.gate_chain,
    },
    holders,
  };
  cache.set(cacheKey, { ts: Date.now(), payload });
  return NextResponse.json(payload, { status: 200, headers: CORS });
}
