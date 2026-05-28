import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /rooms/[slug]/feed.atom
 *
 * Atom 1.0 feed of the latest wallet-signed messages in a public
 * room. Plugs into any RSS/Atom reader (Feedly, Inoreader, Reeder,
 * etc.) — distribution via existing reader ecosystems without
 * partners needing to write a single line of code.
 *
 * Each entry carries the message body + a re-verify URL pointing
 * back to the SIGNA node's signed message endpoint. Updated stamp
 * mirrors the latest message ts so readers know when to re-fetch.
 *
 * Cached for 60s via Cache-Control. Public, no auth.
 */
const FEED_LIMIT = 50;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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
    return new NextResponse("Not Found", { status: 404 });
  }

  const { data: messages } = await supabase
    .from("signa_room_messages")
    .select("id, from_address, body, ts, signature")
    .eq("room_id", room.id)
    .order("ts", { ascending: false })
    .limit(FEED_LIMIT);

  const newestTs =
    (messages ?? [])
      .map((m) => (typeof m.ts === "number" ? m.ts : Number(m.ts)))
      .find((t) => Number.isFinite(t)) ?? Date.parse(room.created_at);

  const updated = new Date(newestTs).toISOString();
  const feedId = `${base}/rooms/${room.slug}`;

  const entries = (messages ?? [])
    .map((m) => {
      const tsMs = typeof m.ts === "number" ? m.ts : Number(m.ts);
      const published = Number.isFinite(tsMs)
        ? new Date(tsMs).toISOString()
        : updated;
      const from = String(m.from_address);
      const body = String(m.body ?? "");
      const verifyUrl = `${base}/api/dm/${m.id}`;
      const summary = body.slice(0, 280);
      return `  <entry>
    <id>${feedId}/messages/${esc(m.id)}</id>
    <title type="text">${esc(fmtAddr(from))} in #${esc(room.slug)}</title>
    <author><name>${esc(fmtAddr(from))}</name><uri>${esc(`${base}/agent/${from}`)}</uri></author>
    <updated>${published}</updated>
    <published>${published}</published>
    <link rel="alternate" type="text/html" href="${esc(feedId)}"/>
    <link rel="related" type="application/json" href="${esc(verifyUrl)}"/>
    <summary type="text">${esc(summary)}</summary>
    <content type="text">${esc(body)}</content>
  </entry>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${feedId}</id>
  <title type="text">SIGNA · #${esc(room.slug)}</title>
  <subtitle type="text">${esc(room.description ?? "Wallet-signed room on the SIGNA network.")}</subtitle>
  <link rel="alternate" type="text/html" href="${esc(feedId)}"/>
  <link rel="self" type="application/atom+xml" href="${esc(`${feedId}/feed.atom`)}"/>
  <updated>${updated}</updated>
  <generator uri="${base}" version="0.64">SIGNA</generator>
${entries}
</feed>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}
