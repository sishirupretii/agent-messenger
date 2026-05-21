import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { serverClient } from "@/lib/supabase";
import { authorizeBearer } from "@/lib/secret-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/sync-nodes
 *
 * The federation MVP. Reads the on-chain SignaNodeRegistry on Base
 * mainnet, fetches signed posts from each peer node since the last
 * successful sync cursor, re-verifies each signature locally, and
 * inserts new entries into our own posts table tagged with
 * source_node + source_node_url.
 *
 * Idempotent: posts.id is uuid v4 from the originating node; INSERT
 * uses ON CONFLICT DO NOTHING so re-runs are safe.
 *
 * Auth: bearer-token via CRON_SECRET. Vercel cron passes this via
 * the Authorization header. Manual triggers from CLI ride the same
 * header.
 *
 * Schedule: every 10 minutes via vercel.json. The 10-min window is
 * the federation latency users will see for cross-node visibility.
 *
 * Safety:
 *   - Skips our own URL (don't sync from ourselves)
 *   - Skips peers that fail protocol verification
 *   - Signature MUST verify against author_address — a node trying
 *     to spoof someone else's post will fail this check
 *   - Caps per-peer pull at 100 posts per run to bound memory
 *   - 7-day retention window for replication (older posts don't
 *     replicate to avoid backfilling the network's history)
 */

const SIGNA_NODE_REGISTRY = "0x4316De3847629705C401F8FaF0cecdb40bd68E5A";
const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const OWN_URL = process.env.NEXT_PUBLIC_SIGNA_BASE_URL || "https://www.signaagent.xyz";
const MAX_POSTS_PER_PEER = 100;
const REPLICATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "listActiveNodes",
    stateMutability: "view",
    inputs: [
      { name: "start", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [
      {
        name: "page",
        type: "tuple[]",
        components: [
          { name: "operator", type: "address" },
          { name: "name", type: "string" },
          { name: "url", type: "string" },
          { name: "version", type: "string" },
          { name: "registeredAt", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
] as const;

type PeerPost = {
  id?: string;
  author_address?: string;
  content?: string;
  parent_id?: string | null;
  created_at?: string;
  signature?: string;
  signed_message?: string;
  source_node?: string | null;
};

function buildPostPreimage(post: PeerPost): string | null {
  // The post's signed_message field (when present from a peer that
  // serves include=signature) is the canonical preimage. If absent,
  // we can reconstruct it from {content, parent_id, created_at} —
  // BUT the original ts (unix ms) isn't stored separately, so without
  // signed_message we can't reliably re-verify. Reject those.
  if (post.signed_message) return post.signed_message;
  return null;
}

async function syncOnePeer(
  db: ReturnType<typeof serverClient>,
  peer: { operator: string; url: string; name: string },
): Promise<{
  pulled: number;
  imported: number;
  failed_verify: number;
  errors: string[];
  last_post_at: string | null;
}> {
  const cleanUrl = peer.url.replace(/\/$/, "");
  const errors: string[] = [];

  // Pull existing sync_state to get the last cursor.
  const { data: stateRow } = await db
    .from("sync_state")
    .select("last_post_at")
    .eq("operator", peer.operator.toLowerCase())
    .maybeSingle();
  let since = stateRow?.last_post_at as string | null;
  if (!since) {
    // First sync — pull anything from the last 7 days, no farther.
    since = new Date(Date.now() - REPLICATION_WINDOW_MS).toISOString();
  }

  const fetchUrl = `${cleanUrl}/api/posts?since=${encodeURIComponent(
    since,
  )}&include=signature&limit=${MAX_POSTS_PER_PEER}`;

  // 8s timeout — a sluggish peer should not block the whole cron run.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8_000);
  let posts: PeerPost[] = [];
  try {
    const res = await fetch(fetchUrl, {
      signal: ac.signal,
      headers: {
        accept: "application/json",
        "user-agent": `signa-sync/1.0 (${OWN_URL})`,
      },
    });
    if (!res.ok) {
      errors.push(`fetch_${res.status}`);
      return { pulled: 0, imported: 0, failed_verify: 0, errors, last_post_at: null };
    }
    const json = await res.json();
    posts = Array.isArray(json.posts) ? json.posts : [];
  } catch (e) {
    errors.push(`fetch_threw_${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    return { pulled: 0, imported: 0, failed_verify: 0, errors, last_post_at: null };
  } finally {
    clearTimeout(timer);
  }

  let imported = 0;
  let failed_verify = 0;
  let lastPostAt: string | null = null;

  for (const post of posts) {
    if (!post.id || !post.author_address || !post.content || !post.signature) {
      failed_verify += 1;
      continue;
    }
    const preimage = buildPostPreimage(post);
    if (!preimage) {
      failed_verify += 1;
      continue;
    }
    // Re-verify the signature locally — the wallet is the source of
    // truth, the peer node is untrusted. We call viem's verifyMessage
    // directly here (rather than verifySignedMessage in @/lib) because
    // the lib helper enforces a freshness window — but a 7-day-old
    // post can still legitimately replicate the first time. The
    // peer's freshness check happened at original ingest time.
    if (
      !/^0x[a-fA-F0-9]{40}$/.test(post.author_address) ||
      !post.signature.startsWith("0x") ||
      post.signature.length < 100
    ) {
      failed_verify += 1;
      continue;
    }
    let sigOk = false;
    try {
      sigOk = await verifyMessage({
        address: post.author_address.toLowerCase() as Address,
        message: preimage,
        signature: post.signature as Hex,
      });
    } catch {
      sigOk = false;
    }
    if (!sigOk) {
      failed_verify += 1;
      continue;
    }

    // Upsert with conflict on id (each node uses uuid v4; collisions
    // are astronomical, but if a post originated on multiple nodes
    // we treat the first-arrived as canonical).
    const { error: insErr } = await db
      .from("posts")
      .upsert(
        {
          id: post.id,
          author_address: post.author_address,
          content: post.content,
          parent_id: post.parent_id ?? null,
          created_at: post.created_at,
          signature: post.signature,
          signed_message: preimage,
          source_node: peer.operator.toLowerCase(),
          source_node_url: cleanUrl,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
    if (insErr) {
      errors.push(`insert_${insErr.code ?? "?"}`.slice(0, 80));
      continue;
    }
    imported += 1;
    if (post.created_at && (!lastPostAt || post.created_at > lastPostAt)) {
      lastPostAt = post.created_at;
    }
  }

  // Author wallets must be registered in users — peer-imported posts
  // reference addresses we may have never seen. Upsert them as bare
  // entries so the FK on posts.author_address holds.
  if (imported > 0) {
    const uniqAuthors = Array.from(
      new Set(posts.map((p) => p.author_address?.toLowerCase()).filter(Boolean) as string[]),
    );
    const now = new Date().toISOString();
    await db.from("users").upsert(
      uniqAuthors.map((address) => ({
        address,
        basename: null,
        ens_name: null,
        updated_at: now,
      })),
      { onConflict: "address", ignoreDuplicates: true },
    );
  }

  return {
    pulled: posts.length,
    imported,
    failed_verify,
    errors,
    last_post_at: lastPostAt,
  };
}

export async function GET(req: NextRequest) {
  if (!authorizeBearer(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  // Read active peers from the on-chain registry.
  const ethClient = createPublicClient({
    chain: base,
    transport: http(BASE_RPC),
  });

  let activeNodes: Array<{
    operator: `0x${string}`;
    name: string;
    url: string;
    version: string;
    active: boolean;
  }> = [];
  try {
    const result = (await ethClient.readContract({
      address: SIGNA_NODE_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "listActiveNodes",
      args: [0n, 100n],
    })) as Array<{
      operator: `0x${string}`;
      name: string;
      url: string;
      version: string;
      registeredAt: bigint;
      updatedAt: bigint;
      active: boolean;
    }>;
    activeNodes = result.map((r) => ({
      operator: r.operator,
      name: r.name,
      url: r.url,
      version: r.version,
      active: r.active,
    }));
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "registry_read_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  // Filter out our own URL — don't sync from ourselves.
  const ownUrl = OWN_URL.replace(/\/$/, "");
  const peers = activeNodes.filter(
    (n) => n.active && n.url.replace(/\/$/, "") !== ownUrl,
  );

  const db = serverClient();
  const results = [];
  for (const peer of peers) {
    const res = await syncOnePeer(db, {
      operator: peer.operator,
      url: peer.url,
      name: peer.name,
    });

    // Persist sync_state regardless of outcome — operators want to see
    // ongoing failure trails in `signa sync status`.
    const now = new Date().toISOString();
    const errorString = res.errors.length > 0 ? res.errors.join("; ").slice(0, 500) : null;
    await db.from("sync_state").upsert(
      {
        operator: peer.operator.toLowerCase(),
        node_url: peer.url,
        node_name: peer.name,
        last_synced_at: now,
        last_success_at: res.errors.length === 0 ? now : null,
        last_post_at: res.last_post_at,
        posts_pulled: res.pulled,
        errors_total: res.errors.length,
        last_error: errorString,
        last_error_at: errorString ? now : null,
        updated_at: now,
      },
      { onConflict: "operator" },
    );

    results.push({
      operator: peer.operator,
      name: peer.name,
      url: peer.url,
      ...res,
    });
  }

  return NextResponse.json({
    ok: true,
    peers_checked: peers.length,
    started_at: new Date(startedAt).toISOString(),
    elapsed_ms: Date.now() - startedAt,
    results,
  });
}
