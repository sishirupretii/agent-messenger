import { NextRequest, NextResponse } from "next/server";
import { serverClient, supabase } from "@/lib/supabase";
import { verifySignedMessage } from "@/lib/verify-signature";
import { buildMessageToSign } from "@/lib/feed-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  // signature + signed_message are exposed so any third party can
  // re-verify the post locally via viem.verifyMessage(...) without
  // trusting signaagent.xyz. This is the basis for `signa verify <id>`
  // and any independent client that wants to audit our DB.
  const { data, error } = await supabase
    .from("posts")
    .select(
      `
      id, author_address, content, parent_id, created_at,
      signature, signed_message,
      author:users!posts_author_address_fkey(address, basename, ens_name, registered_at)
    `,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ post: data });
}

/**
 * Soft-delete a post. Only the author can delete their own post.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  let body: { ts?: number; signature?: string; address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const ts = body.ts ?? 0;
  const signature = body.signature ?? "";
  const address = (body.address ?? "").toLowerCase();

  const message = buildMessageToSign({ kind: "delete", post_id: id, ts });
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
  const { data: post, error: getErr } = await db
    .from("posts")
    .select("author_address, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (getErr) {
    return NextResponse.json({ error: getErr.message }, { status: 500 });
  }
  if (!post) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (post.author_address !== verify.address) {
    return NextResponse.json({ error: "not yours" }, { status: 403 });
  }
  if (post.deleted_at) {
    return NextResponse.json({ ok: true });
  }

  const { error: updErr } = await db
    .from("posts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
