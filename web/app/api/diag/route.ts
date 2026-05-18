import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Temp diagnostic endpoint. Hits 3 external endpoints from Vercel
 * function egress and returns the raw status + body snippet so we
 * can tell which (if any) is blocked. Remove once we know.
 *
 * GET /api/diag
 */
export async function GET() {
  const targets = [
    "https://api.web3.bio/profile/ens/vitalik.eth",
    "https://api.web3.bio/profile/basenames/jesse.base.eth",
    "https://api.ensideas.com/ens/resolve/vitalik.eth",
  ];

  const results: Array<{
    url: string;
    ok: boolean;
    status?: number;
    body?: string;
    error?: string;
    duration_ms: number;
  }> = [];

  for (const url of targets) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const text = (await res.text()).slice(0, 200);
      results.push({
        url,
        ok: res.ok,
        status: res.status,
        body: text,
        duration_ms: Date.now() - t0,
      });
    } catch (e) {
      results.push({
        url,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - t0,
      });
    }
  }

  return NextResponse.json({ results });
}
