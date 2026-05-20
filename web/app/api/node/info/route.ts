import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/node/info
 *
 * The advertising endpoint every signa-node operator exposes. The CLI
 * uses this to:
 *   - validate that a URL actually serves the signa protocol
 *     (`signa node verify <url>`)
 *   - render node metadata in the `signa nodes` table
 *   - decide whether to talk to this node based on its capabilities
 *
 * Public, CORS-open. No auth — node metadata is the FIRST thing other
 * peers and users need to see before they can decide to trust or talk
 * to a node.
 *
 * Operator identity (`operator` field) is an opt-in attestation: each
 * node operator sets SIGNA_NODE_OPERATOR_ADDRESS in env to a wallet
 * they control. Future versions will require a wallet signature over a
 * canonical node-info preimage so operator identity is cryptographically
 * verifiable. v1 trust is "the operator said so" — same trust level as
 * a TLS cert.
 */
export async function GET() {
  const operator = (process.env.SIGNA_NODE_OPERATOR_ADDRESS ?? "")
    .toLowerCase()
    .trim();
  const name = process.env.SIGNA_NODE_NAME || "signaagent.xyz";
  const publicUrl =
    process.env.NEXT_PUBLIC_SIGNA_BASE_URL ||
    "https://www.signaagent.xyz";

  // The full set of API surfaces this node serves. Other implementations
  // can advertise a subset (e.g. a read-only mirror won't have
  // gateway/respond or me/trade). Capabilities are how the CLI decides
  // which features are usable on this node.
  const capabilities = [
    "gateway",
    "search",
    "mcp",
    "events-sse",
    "openai-compat",
    "agents-launch",
    "agent-runtime",
    "verify",
    "xmtp-indexer",
  ];

  // Best-effort stats snapshot. Cached at the CDN by Vercel for the
  // dynamic-revalidate window; we still go to the DB on every call
  // since the row counts move fast in active use.
  let stats: {
    agents?: number;
    posts?: number;
    users?: number;
    interactions?: number;
  } = {};
  try {
    const [{ count: agents }, { count: posts }, { count: users }, { count: interactions }] =
      await Promise.all([
        supabase.from("agents").select("address", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("posts").select("id", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("users").select("address", { count: "exact", head: true }),
        supabase.from("agent_interactions").select("id", { count: "exact", head: true }),
      ]);
    stats = {
      agents: agents ?? 0,
      posts: posts ?? 0,
      users: users ?? 0,
      interactions: interactions ?? 0,
    };
  } catch {
    // best-effort; node info still returns even if stats query fails
  }

  return NextResponse.json({
    ok: true,
    protocol: "signa",
    protocol_version: 1,
    node: {
      name,
      url: publicUrl,
      operator: operator || null,
      version: "0.12.0",
      capabilities,
      stats,
    },
    federation: {
      // v1: no cross-node sync yet. The schema is here so clients can
      // build against it before the worker ships.
      sync_enabled: false,
      seed_peers: [],
    },
    notes:
      "signa nodes are federable. point your CLI at any node with `signa node use <url>`. signatures verify the same on every node — the wallet is the source of truth.",
  });
}
