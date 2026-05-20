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
  const nodeVersion = "0.13.0";

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

  // ---- operator attestation (v0.13) ----
  //
  // Optional. When the operator has pre-signed the canonical descriptor
  // locally (via `signa node sign-attestation` on their dev machine) and
  // pasted the signature + timestamp into env, we serve it here so any
  // CLI can re-verify cryptographically that the wallet at `operator`
  // actually attested THIS node configuration.
  //
  // The server NEVER holds the operator's private key. Signing happens
  // off-server. We just publish the signature alongside the deterministic
  // preimage anyone can reconstruct from this same response.
  const attSig = (process.env.SIGNA_NODE_ATTESTATION_SIGNATURE ?? "").trim();
  const attTs = Number(process.env.SIGNA_NODE_ATTESTED_AT ?? "0") || 0;
  let attestation: {
    signature: string;
    signed_message: string;
    attested_at: number;
  } | null = null;
  if (
    operator &&
    /^0x[a-f0-9]{40}$/.test(operator) &&
    /^0x[a-fA-F0-9]{130,132}$/.test(attSig) &&
    attTs > 0
  ) {
    const sortedCaps = [...capabilities].sort().join(",");
    const preimage = [
      "SIGNA node v1",
      `url:${publicUrl.replace(/\/$/, "")}`,
      `name:${name}`,
      `operator:${operator}`,
      `version:${nodeVersion}`,
      `capabilities:${sortedCaps}`,
      `attested_at:${attTs}`,
    ].join("\n");
    attestation = {
      signature: attSig,
      signed_message: preimage,
      attested_at: attTs,
    };
  }

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
      version: nodeVersion,
      capabilities,
      stats,
      attestation, // null if operator hasn't signed yet, or sig+preimage if they have
    },
    federation: {
      // v1: no cross-node sync yet. The schema is here so clients can
      // build against it before the worker ships.
      sync_enabled: false,
      seed_peers: [],
    },
    notes:
      "signa nodes are federable. point your CLI at any node with `signa node use <url>`. signatures verify the same on every node — the wallet is the source of truth. operator attestation is optional but recommended — see `signa node sign-attestation`.",
  });
}
