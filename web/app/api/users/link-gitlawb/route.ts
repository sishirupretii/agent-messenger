import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign } from "@/lib/feed-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/users/link-gitlawb
 *
 * Body: { address, gitlawb_did, ts, signature }
 *
 * Bind a gitlawb DID to the caller's SIGNA user row. The signature
 * proves the caller controls the SIGNA wallet (`address`). We don't
 * currently verify ownership of the gitlawb DID itself — that would
 * require a UCAN co-signature out of band. v1 accepts the claim and
 * surfaces it on /u/<handle>. v2 will add a "verified" badge once we
 * wire a UCAN check.
 *
 * Pass an empty gitlawb_did string to UNLINK.
 */
export async function POST(req: NextRequest) {
  let body: {
    address?: string;
    gitlawb_did?: string;
    ts?: number;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const address = (body.address ?? "").toLowerCase();
  const rawDid = (body.gitlawb_did ?? "").trim();
  const ts = body.ts ?? 0;
  const signature = body.signature ?? "";

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  // gitlawb DIDs come in two flavors today: did:key:z6Mk... and did:gitlawb:<slug>
  // Empty string = explicit unlink.
  if (rawDid && !/^did:(key|gitlawb):[a-zA-Z0-9_-]+$/.test(rawDid)) {
    return NextResponse.json(
      {
        error: "invalid_did",
        message:
          "gitlawb_did must be did:key:z6Mk... or did:gitlawb:<slug>, or empty to unlink",
      },
      { status: 400 },
    );
  }

  const message = buildMessageToSign({
    kind: "link_gitlawb",
    address,
    gitlawb_did: rawDid,
    ts,
  });
  const verify = await verifySignedMessage({
    expectedAddress: address,
    message,
    signature,
    ts,
  });
  if (!verify.ok) {
    return NextResponse.json({ error: verify.reason }, { status: 401 });
  }

  const db = serverClient();
  const now = new Date().toISOString();
  const { error } = await db
    .from("users")
    .update({
      gitlawb_did: rawDid || null,
      gitlawb_did_set_at: rawDid ? now : null,
      updated_at: now,
    })
    .eq("address", address);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    gitlawb_did: rawDid || null,
    unlinked: !rawDid,
  });
}
