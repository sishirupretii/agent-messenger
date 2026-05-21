import { NextRequest, NextResponse } from "next/server";
import { serverClient, supabase } from "@/lib/supabase";
import { verifySignedMessage, extractMentions } from "@/lib/verify-signature";
import { MAX_POST_LENGTH, buildMessageToSign, type FeedPost } from "@/lib/feed-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/posts
 *   ?cursor=<iso ts>     paginate older
 *   ?author=<addr>       filter to author profile feed
 *   ?parent=<post id>    fetch replies for a given post
 *   ?viewer=<addr>       optional, populates liked_by_me
 *   ?mentions=<addr>     posts that text-mention this 0x address — the
 *                         "inbox" primitive used by `signa inbox`. Matches
 *                         on content ILIKE '%<addr>%' (case-insensitive)
 *                         so both `@0xABC` and `0xabc` style mentions hit.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const cursor = sp.get("cursor");
  const since = sp.get("since"); // forward cursor used by /api/cron/sync-nodes
  const author = sp.get("author")?.toLowerCase();
  const parent = sp.get("parent");
  const viewer = sp.get("viewer")?.toLowerCase();
  const mentionsRaw = sp.get("mentions");
  const limit = Math.min(Number(sp.get("limit") ?? 30), 100);
  // include=signature triggers per-post signature + signed_message in
  // the listing response so cross-node sync workers can re-verify each
  // entry locally before importing.
  const includeSignature = sp.get("include") === "signature";

  // Validate the mentions filter strictly — never let user input flow
  // into ILIKE without an explicit 0x-shape check, or we'd open a wide
  // scan on arbitrary substrings.
  const mentions = mentionsRaw
    ? /^0x[a-fA-F0-9]{40}$/.test(mentionsRaw)
      ? mentionsRaw.toLowerCase()
      : null
    : null;
  if (mentionsRaw && !mentions) {
    return NextResponse.json(
      { error: "invalid_mentions_address" },
      { status: 400 },
    );
  }

  // Build the SELECT list — append signature + signed_message + the
  // source_node tracking fields when sync workers ask for them.
  const selectCols = includeSignature
    ? `id, author_address, content, parent_id, created_at, signature, signed_message, source_node, source_node_url,
       author:users!posts_author_address_fkey(address, basename, ens_name, registered_at)`
    : `id, author_address, content, parent_id, created_at,
       author:users!posts_author_address_fkey(address, basename, ens_name, registered_at)`;

  // When `since` is given, switch to forward pagination (newest first
  // is still the default, but we filter posts created AFTER the cursor
  // so a sync worker can pull only delta).
  let q = supabase
    .from("posts")
    .select(selectCols)
    .is("deleted_at", null)
    .order("created_at", { ascending: since ? true : false })
    .limit(limit);

  if (cursor) q = q.lt("created_at", cursor);
  if (since) q = q.gt("created_at", since);
  if (author) q = q.eq("author_address", author);
  if (parent) q = q.eq("parent_id", parent);
  else if (!author && !mentions) q = q.is("parent_id", null); // global feed = top-level only

  if (mentions) {
    // Match both `@0xabc...` and bare `0xabc...` formats.
    q = q.ilike("content", `%${mentions}%`);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const posts = (data ?? []) as unknown as FeedPost[];

  // Counts in 2 batch queries (Supabase RPC would be nicer but this works)
  const ids = posts.map((p) => p.id);
  if (ids.length === 0) {
    return NextResponse.json({ posts: [] });
  }

  const [{ data: likeCounts }, { data: replyCounts }, { data: myLikes }] = await Promise.all([
    supabase.from("likes").select("post_id").in("post_id", ids),
    supabase.from("posts").select("parent_id").in("parent_id", ids).is("deleted_at", null),
    viewer
      ? supabase
          .from("likes")
          .select("post_id")
          .eq("address", viewer)
          .in("post_id", ids)
      : Promise.resolve({ data: [] as Array<{ post_id: string }> }),
  ]);

  const likeMap = new Map<string, number>();
  for (const row of likeCounts ?? []) {
    likeMap.set(row.post_id, (likeMap.get(row.post_id) ?? 0) + 1);
  }
  const replyMap = new Map<string, number>();
  for (const row of replyCounts ?? []) {
    if (!row.parent_id) continue;
    replyMap.set(row.parent_id, (replyMap.get(row.parent_id) ?? 0) + 1);
  }
  const mySet = new Set<string>((myLikes ?? []).map((r) => r.post_id));

  const enriched = posts.map((p) => ({
    ...p,
    like_count: likeMap.get(p.id) ?? 0,
    reply_count: replyMap.get(p.id) ?? 0,
    liked_by_me: mySet.has(p.id),
  }));

  return NextResponse.json({ posts: enriched });
}

/**
 * POST /api/posts
 *   Body: { content, parent_id?, ts, signature, author_address }
 *   Signature must be over buildMessageToSign({kind:'post', content, ts, parent_id})
 *   verified against author_address.
 */
export async function POST(req: NextRequest) {
  let body: {
    content?: string;
    parent_id?: string | null;
    ts?: number;
    signature?: string;
    author_address?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const content = (body.content ?? "").trim();
  const parent_id = body.parent_id ?? null;
  const ts = body.ts ?? 0;
  const signature = body.signature ?? "";
  const author_address = (body.author_address ?? "").toLowerCase();

  if (!content) {
    return NextResponse.json({ error: "empty content" }, { status: 400 });
  }
  if (content.length > MAX_POST_LENGTH) {
    return NextResponse.json(
      { error: `content too long (max ${MAX_POST_LENGTH})` },
      { status: 400 },
    );
  }

  const message = buildMessageToSign({
    kind: "post",
    content,
    parent_id: parent_id ?? null,
    ts,
  });
  const verify = await verifySignedMessage({
    expectedAddress: author_address,
    message,
    signature,
    ts,
  });
  if (!verify.ok) {
    return NextResponse.json({ error: verify.reason }, { status: 401 });
  }

  const db = serverClient();

  // Author must exist (registered via /api/users/register first).
  const { data: userRow, error: userErr } = await db
    .from("users")
    .select("address")
    .eq("address", verify.address)
    .maybeSingle();
  if (userErr) {
    return NextResponse.json({ error: userErr.message }, { status: 500 });
  }
  if (!userRow) {
    return NextResponse.json(
      { error: "Author not registered. Open the app and enable messaging first." },
      { status: 403 },
    );
  }

  if (parent_id && !/^[0-9a-f-]{36}$/i.test(parent_id)) {
    return NextResponse.json({ error: "bad parent_id" }, { status: 400 });
  }

  const { data: inserted, error: insErr } = await db
    .from("posts")
    .insert({
      author_address: verify.address,
      content,
      parent_id,
      signature,
      signed_message: message,
    })
    .select("id, author_address, content, parent_id, created_at")
    .single();

  if (insErr || !inserted) {
    return NextResponse.json(
      { error: insErr?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  // Resolve mentions → registered addresses. Skip ones that aren't on SIGNA.
  const { rawTokens } = extractMentions(content);
  if (rawTokens.length > 0) {
    const { data: matched } = await db
      .from("users")
      .select("address, basename, ens_name")
      .or(
        rawTokens
          .map((t) =>
            /^0x[a-f0-9]{40}$/.test(t)
              ? `address.eq.${t}`
              : `basename.eq.${t},ens_name.eq.${t}`,
          )
          .join(","),
      );
    const mentioned = new Set<string>(
      (matched ?? []).map((m: { address: string }) => m.address),
    );
    if (mentioned.size > 0) {
      await db
        .from("mentions")
        .insert(
          Array.from(mentioned).map((addr) => ({
            post_id: inserted.id,
            mentioned_address: addr,
          })),
        );
    }
  }

  return NextResponse.json({ post: inserted });
}
