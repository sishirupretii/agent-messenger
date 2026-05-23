import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[address]/miroshark-fire
 *
 * v0.26 — DEPRECATED. The public "Run a sim" button now talks directly
 * to MiroShark's x402 endpoint from the visitor's browser, signed with
 * the visitor's own wallet via `fireMirosharkSim()` in
 * `web/lib/x402-client.ts`. SIGNA's server is no longer in the payment
 * path — the visitor pays $1 USDC straight to MiroShark, no server
 * wallet is involved.
 *
 * This route is kept (rather than deleted) as a 410 Gone so any cached
 * browser tabs or external integrations from before v0.26 surface a
 * clean error with a pointer to the new flow, instead of a 404 that
 * looks like an outage.
 *
 * GET returns the same 410 for the same reason.
 */
function gone() {
  return NextResponse.json(
    {
      ok: false,
      error: "endpoint_deprecated_v026",
      message:
        "The public sim button now pays from the visitor's wallet via x402 in the browser. SIGNA's server is no longer in the payment path.",
      hint: "Refresh the agent profile and click 'Run a sim' — you'll be prompted to connect a wallet, then sign $1 USDC to MiroShark directly.",
    },
    { status: 410 },
  );
}

export async function POST() {
  return gone();
}

export async function GET() {
  return gone();
}
