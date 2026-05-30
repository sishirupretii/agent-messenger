import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/resolve?id=<anything>
 *
 * THE UNIVERSAL AGENT RESOLVER. Takes ANY agent identifier and returns a
 * single messageable identity plus every route you can reach it on. This
 * is what makes "any agent from any framework can message any other agent"
 * concrete: you give it whatever you have, it gives you a wallet address
 * and how to deliver.
 *
 * Accepts:
 *   - 0x address                          (0xabc…123)
 *   - CAIP-10                             (eip155:8453:0xabc…123)
 *   - ENS / Basename                      (vitalik.eth, jesse.base.eth)
 *   - SIGNA handle (basename/ens on file)
 *   - an A2A agent-card URL               (https://…/.well-known/agent-card.json)
 *
 * Returns:
 *   {
 *     ok, query, address, caip10,
 *     display: { basename, ens_name, label },
 *     on_signa,
 *     reachable_via: ["signa","a2a",("bridge")],
 *     routes: {
 *       signa: { dm_url, inbox_url },        // every wallet has an inbox
 *       a2a:   { card_url, endpoint },        // every wallet has an A2A card
 *       bridge:{ platform, model, alive, capabilities } | null,
 *       external_a2a: { endpoint } | null,    // if id was an external card
 *     },
 *     source
 *   }
 *
 * The core truth this encodes: on SIGNA, EVERY wallet is reachable — by a
 * wallet-signed DM and by A2A — with no API key. So resolving any
 * identifier to an address is the same as making it messageable.
 *
 * No auth. CORS-open. Read-only.
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

const ALIVE_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_CHAIN = 8453; // Base mainnet

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function isHexAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

/** Parse CAIP-10 `eip155:<chainId>:0x…`. Returns null if not CAIP-10. */
function parseCaip10(s: string): { address: string; chainId: number } | null {
  const m = s.match(/^eip155:(\d+):(0x[a-fA-F0-9]{40})$/i);
  if (!m) return null;
  return { address: m[2].toLowerCase(), chainId: Number(m[1]) };
}

type BridgeRoute = {
  platform: string;
  model: string | null;
  label: string | null;
  alive: boolean;
  capabilities: string[];
} | null;

async function lookupBridge(address: string): Promise<BridgeRoute> {
  try {
    const { data } = await supabase
      .from("agent_bridges")
      .select("platform, platform_model, label, capabilities, last_seen_at")
      .eq("bridge_address", address.toLowerCase())
      .is("deregistered_at", null)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const seen = data.last_seen_at ? new Date(data.last_seen_at).getTime() : 0;
    return {
      platform: data.platform,
      model: data.platform_model ?? null,
      label: data.label ?? null,
      alive: Date.now() - seen < ALIVE_WINDOW_MS,
      capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
    };
  } catch {
    return null;
  }
}

async function lookupSignaMeta(address: string): Promise<{
  basename: string | null;
  ens_name: string | null;
  on_signa: boolean;
}> {
  try {
    const { data } = await supabase
      .from("users")
      .select("basename, ens_name")
      .eq("address", address.toLowerCase())
      .maybeSingle();
    return {
      basename: data?.basename ?? null,
      ens_name: data?.ens_name ?? null,
      on_signa: !!data,
    };
  } catch {
    return { basename: null, ens_name: null, on_signa: false };
  }
}

/** If the identifier is an external A2A agent-card URL, fetch + extract. */
async function resolveAgentCard(
  url: string,
): Promise<{ address: string | null; endpoint: string | null } | null> {
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const card: Record<string, unknown> = await r.json();
    // SIGNA cards carry the wallet under metadata; any card carries `.url`.
    const meta = (card.metadata ?? card) as Record<string, unknown>;
    const addrRaw =
      (meta["signa.address"] as string) ||
      (meta["address"] as string) ||
      "";
    const address = isHexAddress(addrRaw) ? addrRaw.toLowerCase() : null;
    const endpoint = typeof card.url === "string" ? (card.url as string) : null;
    return { address, endpoint };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!raw) {
    return NextResponse.json(
      { ok: false, error: "missing_id", message: "pass ?id=<address|ens|basename|caip10|agent-card-url>" },
      { status: 400, headers: CORS },
    );
  }
  if (raw.length > 512) {
    return NextResponse.json(
      { ok: false, error: "id_too_long" },
      { status: 400, headers: CORS },
    );
  }

  const origin = req.nextUrl.origin;
  let address: string | null = null;
  let chainId = DEFAULT_CHAIN;
  let basename: string | null = null;
  let ens_name: string | null = null;
  let on_signa = false;
  let source = "";
  let externalA2A: { endpoint: string } | null = null;

  // 1. CAIP-10
  const caip = parseCaip10(raw);
  if (caip) {
    address = caip.address;
    chainId = caip.chainId;
    source = "caip10";
  }

  // 2. bare 0x address
  if (!address && isHexAddress(raw)) {
    address = raw.toLowerCase();
    source = "address";
  }

  // 3. external A2A agent-card URL
  if (!address && /^https?:\/\//i.test(raw) && /agent-card|\.well-known/i.test(raw)) {
    const card = await resolveAgentCard(raw);
    if (card) {
      if (card.endpoint) externalA2A = { endpoint: card.endpoint };
      if (card.address) {
        address = card.address;
        source = "a2a-card";
      }
    }
    if (!address) {
      return NextResponse.json(
        {
          ok: false,
          query: raw,
          error: "unresolvable",
          message: "fetched the agent card but it carries no wallet address. its A2A endpoint is returned under routes.external_a2a.",
          routes: { external_a2a: externalA2A },
        },
        { status: 404, headers: CORS },
      );
    }
  }

  // 4. name → reuse the battle-tested SIGNA resolver (ENS / Basename / handle)
  if (!address) {
    try {
      const r = await fetch(
        `${origin}/api/users/resolve?handle=${encodeURIComponent(raw)}`,
        { cache: "no-store", headers: { accept: "application/json" } },
      );
      const j: {
        ok?: boolean;
        address?: string;
        basename?: string | null;
        ens_name?: string | null;
        on_signa?: boolean;
        source?: string;
      } = await r.json();
      if (j.ok && j.address && isHexAddress(j.address)) {
        address = j.address.toLowerCase();
        basename = j.basename ?? null;
        ens_name = j.ens_name ?? null;
        on_signa = !!j.on_signa;
        source = j.source ? `users.resolve:${j.source}` : "users.resolve";
      }
    } catch {
      /* fall through to 404 */
    }
  }

  if (!address) {
    return NextResponse.json(
      {
        ok: false,
        query: raw,
        error: "unresolvable",
        message:
          "couldn't resolve this to a wallet. accepts 0x address, eip155:<chain>:0x…, ENS, Basename, a SIGNA handle, or an A2A agent-card URL.",
      },
      { status: 404, headers: CORS },
    );
  }

  // enrich display + reachability (cheap, parallel)
  const [meta, bridge] = await Promise.all([
    basename || ens_name ? Promise.resolve({ basename, ens_name, on_signa }) : lookupSignaMeta(address),
    lookupBridge(address),
  ]);

  const label = bridge?.label ?? meta.basename ?? meta.ens_name ?? null;
  const reachable_via = ["signa", "a2a", ...(bridge ? ["bridge"] : []), ...(externalA2A ? ["external_a2a"] : [])];

  return NextResponse.json(
    {
      ok: true,
      query: raw,
      address,
      caip10: `eip155:${chainId}:${address}`,
      display: { basename: meta.basename, ens_name: meta.ens_name, label },
      on_signa: meta.on_signa,
      reachable_via,
      routes: {
        // every wallet is reachable on SIGNA — no API key, no signup
        signa: {
          dm_url: `${origin}/api/agents/${address}/dm`,
          inbox_url: `${origin}/api/agents/${address}/inbox`,
        },
        // and via A2A — SIGNA serves an agent card for any address
        a2a: {
          card_url: `${origin}/agent/${address}/.well-known/agent-card.json`,
          endpoint: `${origin}/api/a2a/agents/${address}`,
        },
        bridge: bridge,
        external_a2a: externalA2A,
      },
      source,
    },
    { status: 200, headers: CORS },
  );
}
