import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /rooms/[slug]/feed.json
 *
 * JSON Feed 1.1 (https://jsonfeed.org/version/1.1) of a public
 * SIGNA room's wallet-signed messages. Pairs with the Atom feed at
 * /rooms/[slug]/feed.atom for readers that prefer JSON.
 *
 * Each item includes the signature + signed_message preimage so
 * subscribers can re-verify offline without hitting the SIGNA node
 * again.
 *
 * Cached for 60s, public, no auth.
 */
const FEED_LIMIT = 50;

function fmtAddr(a: string): string {
  if (!a || a.length < 10) return a ?? "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: raw } = await params;
  const slug = (raw ?? "").toLowerCase();
  const base = "https://www.signaagent.xyz";

  const { data: room } = await supabase
    .from("signa_rooms")
    .select("id, name, slug, description, creator_address, is_public, created_at")
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();

  if (!room) {
    return new NextResponse(JSON.stringify({ ok: false, error: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const { data: messages } = await supabase
    .from("signa_room_messages")
    .select("id, from_address, body, ts, signature, signed_message")
    .eq("room_id", room.id)
    .order("ts", { ascending: false })
    .limit(FEED_LIMIT);

  const feedUrl = `${base}/rooms/${room.slug}/feed.json`;
  const homepageUrl = `${base}/rooms/${room.slug}`;

  const items = (messages ?? []).map((m) => {
    const tsMs = typeof m.ts === "number" ? m.ts : Number(m.ts);
    const dateISO = Number.isFinite(tsMs)
      ? new Date(tsMs).toISOString()
      : new Date().toISOString();
    const from = String(m.from_address);
    return {
      id: `${homepageUrl}/messages/${m.id}`,
      url: homepageUrl,
      external_url: `${base}/api/dm/${m.id}`,
      title: `${fmtAddr(from)} in #${room.slug}`,
      content_text: String(m.body ?? ""),
      date_published: dateISO,
      authors: [
        {
          name: fmtAddr(from),
          url: `${base}/agent/${from}`,
        },
      ],
      _signa: {
        from_address: from,
        signature: m.signature,
        signed_message: m.signed_message,
        ts: tsMs,
      },
    };
  });

  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: `SIGNA · #${room.slug}`,
    home_page_url: homepageUrl,
    feed_url: feedUrl,
    description:
      room.description ?? "Wallet-signed room on the SIGNA network.",
    icon: `${base}/icon.png`,
    favicon: `${base}/favicon.ico`,
    authors: [
      {
        name: fmtAddr(room.creator_address),
        url: `${base}/agent/${room.creator_address}`,
      },
    ],
    items,
  };

  return new NextResponse(JSON.stringify(feed, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/feed+json; charset=utf-8",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}
