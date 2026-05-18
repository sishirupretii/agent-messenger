import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/users/resolve?handle=<0x | name.base.eth | name.eth>
 *
 * Single-source-of-truth resolver used by /dm/[handle] and /u/[handle].
 * Returns:
 *
 *   { ok: true, address, basename, ens_name, on_signa: bool, source: ... }
 *
 * Resolution strategy:
 *   1. 0x address → use as-is, look up SIGNA metadata for it.
 *   2. *.base.eth → web3.bio /basenames/ (verified working from Vercel
 *      egress, sub-200ms)
 *   3. *.eth     → ensideas.com (verified, ~40ms from Vercel) with
 *      web3.bio /ens/ as a second backstop. viem getEnsAddress as a
 *      last-resort tertiary that only works against a CCIP-capable RPC.
 *   4. Any other string → loose match against users.basename or
 *      users.ens_name (exact-match only — no PostgREST OR filter with
 *      dots in values, that was the bug that 404'd vitalik.eth).
 *
 * After address is resolved, SIGNA metadata (basename / ens_name from
 * the users table, on_signa flag) is looked up via a single `.eq.` query
 * which PostgREST handles correctly.
 */

const MAINNET_RPC =
  process.env.ETHEREUM_RPC_URL || "https://ethereum.publicnode.com";

const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http(MAINNET_RPC),
});

function isHexAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

async function lookupSignaMetadata(address: string): Promise<{
  basename: string | null;
  ens_name: string | null;
  on_signa: boolean;
  gitlawb_did: string | null;
}> {
  try {
    const { data } = await supabase
      .from("users")
      .select("basename, ens_name, gitlawb_did")
      .eq("address", address.toLowerCase())
      .maybeSingle();
    return {
      basename: data?.basename ?? null,
      ens_name: data?.ens_name ?? null,
      gitlawb_did: data?.gitlawb_did ?? null,
      on_signa: !!data,
    };
  } catch {
    return {
      basename: null,
      ens_name: null,
      gitlawb_did: null,
      on_signa: false,
    };
  }
}

type RestResult = { address: string; via: string } | null;

async function tryEnsIdeas(name: string): Promise<RestResult> {
  try {
    const url = `https://api.ensideas.com/ens/resolve/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const j: { address?: string } = await res.json();
    if (j.address && isHexAddress(j.address)) {
      return { address: j.address.toLowerCase(), via: "ensideas" };
    }
    return null;
  } catch (e) {
    console.error(
      `[resolve] ensideas threw for ${name}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

async function tryWeb3Bio(
  name: string,
  platform: "ens" | "basenames",
): Promise<RestResult> {
  try {
    const url = `https://api.web3.bio/profile/${platform}/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const j: { address?: string } = await res.json();
    if (j.address && isHexAddress(j.address)) {
      return { address: j.address.toLowerCase(), via: `web3.bio/${platform}` };
    }
    return null;
  } catch (e) {
    console.error(
      `[resolve] web3.bio threw for ${name}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

async function tryViem(name: string): Promise<RestResult> {
  try {
    const resolved = await mainnetClient.getEnsAddress({ name });
    if (resolved) return { address: resolved.toLowerCase(), via: "viem" };
    return null;
  } catch (e) {
    console.error(
      `[resolve] viem threw for ${name}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    return await handleResolve(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack?.split("\n").slice(0, 4).join("\n") : "";
    console.error("[resolve] uncaught:", msg, stack);
    return NextResponse.json(
      {
        ok: false,
        error: "internal",
        message: msg,
        stack,
      },
      { status: 500 },
    );
  }
}

async function handleResolve(req: NextRequest) {
  const rawHandle = (req.nextUrl.searchParams.get("handle") ?? "").trim();
  if (!rawHandle) {
    return NextResponse.json({ error: "missing_handle" }, { status: 400 });
  }
  if (rawHandle.length > 64) {
    return NextResponse.json({ error: "handle_too_long" }, { status: 400 });
  }

  const handle = rawHandle.toLowerCase();

  // 1. Direct 0x address.
  if (isHexAddress(handle)) {
    const meta = await lookupSignaMetadata(handle);
    return NextResponse.json({
      ok: true,
      handle,
      address: handle,
      ...meta,
      source: "address",
    });
  }

  // 2 + 3. ENS-shaped (includes .base.eth and .eth).
  if (handle.endsWith(".eth")) {
    // handle is already lowercased; the HTTP resolvers and viem are tolerant
    // of unicode names since we don't accept those from users today. If we
    // ever support unicode, swap in a hand-rolled normalize (viem/ens
    // normalize() didn't survive Vercel's build tree-shake — returned
    // undefined and crashed with "Cannot read properties of undefined").
    const normalized = handle;

    let result: RestResult = null;

    if (normalized.endsWith(".base.eth")) {
      // Basenames: web3.bio /basenames/ is most reliable
      result = await tryWeb3Bio(normalized, "basenames");
      if (!result) result = await tryViem(normalized);
    } else {
      // Plain ENS: ensideas is fastest, then web3.bio, then viem
      result = await tryEnsIdeas(normalized);
      if (!result) result = await tryWeb3Bio(normalized, "ens");
      if (!result) result = await tryViem(normalized);
    }

    if (!result) {
      return NextResponse.json(
        {
          ok: false,
          handle: rawHandle,
          error: "unresolvable",
          message:
            "couldn't resolve this name via ensideas, web3.bio, or viem",
        },
        { status: 404 },
      );
    }

    const meta = await lookupSignaMetadata(result.address);
    return NextResponse.json({
      ok: true,
      handle: rawHandle,
      address: result.address,
      ...meta,
      source: result.via,
    });
  }

  // 4. Fuzzy match against users table by exact basename or ens_name.
  // We do TWO single-column eq queries instead of one OR with dots,
  // because PostgREST's .or() string parser tokenizes on dots and breaks
  // for values like "vitalik.eth".
  const [byBasename, byEns] = await Promise.all([
    supabase
      .from("users")
      .select("address, basename, ens_name")
      .eq("basename", handle)
      .maybeSingle()
      .then((r) => r.data),
    supabase
      .from("users")
      .select("address, basename, ens_name")
      .eq("ens_name", handle)
      .maybeSingle()
      .then((r) => r.data),
  ]);
  const match = byBasename ?? byEns;
  if (match?.address) {
    return NextResponse.json({
      ok: true,
      handle: rawHandle,
      address: match.address,
      basename: match.basename,
      ens_name: match.ens_name,
      on_signa: true,
      source: "users_table",
    });
  }

  return NextResponse.json(
    {
      ok: false,
      handle: rawHandle,
      error: "unresolvable",
      message:
        "no SIGNA user, Basename, or ENS matches this handle. did you mean an address (0x…)?",
    },
    { status: 404 },
  );
}
