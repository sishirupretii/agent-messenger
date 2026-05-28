import { NextRequest, NextResponse } from "next/server";
import { listFederatedNodes, probeNode } from "@/lib/onchain-nodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/nodes?probe=1
 *
 * Public read endpoint. Returns every node in the on-chain registry,
 * plus optional liveness probe results when `probe=1` is passed.
 * Probing hits each peer's /api/node/info concurrently with a 4s
 * timeout each, so the worst-case wait is ~4s.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const includeInactive =
    req.nextUrl.searchParams.get("includeInactive") === "1";
  const probe = req.nextUrl.searchParams.get("probe") === "1";

  const { nodes, total, active } = await listFederatedNodes(
    includeInactive,
    100,
  );

  if (!probe) {
    return NextResponse.json(
      {
        ok: true,
        total,
        active,
        nodes,
      },
      { status: 200, headers: CORS },
    );
  }

  const probed = await Promise.all(
    nodes.map(async (n) => ({ ...n, probe: await probeNode(n) })),
  );

  return NextResponse.json(
    {
      ok: true,
      total,
      active,
      nodes: probed,
    },
    { status: 200, headers: CORS },
  );
}
