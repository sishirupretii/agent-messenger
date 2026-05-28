import { NextRequest, NextResponse } from "next/server";
import { supabase, serverClient } from "@/lib/supabase";
import { gitlawbTasks } from "@/lib/skills/gitlawb";
import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bounties/[id]/room
 *
 * Lazy-create a wallet-signed SIGNA room for a gitlawb open bounty.
 * Bot wallet signs the room manifest + an intro message. Idempotent.
 *
 * Rooms are public by default so anyone can read the work going on, but
 * the underlying intent is: maintainers + claimants get a clean
 * cross-platform thread tied to the bounty ID.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function slugForBounty(id: string, title: string | undefined): string {
  const t = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  const tail = id.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase();
  if (t.length >= 2) return `b-${t}-${tail}`;
  return `bounty-${tail}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await params;
  const bountyId = String(raw ?? "").trim();
  if (!bountyId) {
    return NextResponse.json(
      { ok: false, error: "invalid_bounty_id" },
      { status: 400, headers: CORS },
    );
  }

  // Find the bounty in the open task feed
  const tasks = await gitlawbTasks({ status: "open", limit: 100 });
  const t = tasks.find((x) => String(x.id ?? "") === bountyId);
  if (!t) {
    return NextResponse.json(
      { ok: false, error: "bounty_not_in_open_tasks" },
      { status: 404, headers: CORS },
    );
  }

  const title = String(t.title ?? "untitled bounty").slice(0, 200);
  const amount = String(t.bounty?.amount ?? "0");
  const token = String(t.bounty?.token ?? "?");
  const assignee = t.assignee ? String(t.assignee) : null;
  const slug = slugForBounty(bountyId, title);

  // Idempotent lookup
  const { data: existing } = await supabase
    .from("signa_rooms")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { ok: true, slug: existing.slug, created: false, room: existing },
      { status: 200, headers: CORS },
    );
  }

  const botKey = process.env.SIGNA_BOT_PRIVATE_KEY;
  if (!botKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "bot_wallet_not_configured",
        hint: "SIGNA_BOT_PRIVATE_KEY must be set on the server.",
      },
      { status: 503, headers: CORS },
    );
  }

  const pk = (botKey.startsWith("0x") ? botKey : `0x${botKey}`) as `0x${string}`;
  const botAccount = privateKeyToAccount(pk);
  const botAddr = botAccount.address.toLowerCase();

  const description = [
    `Gitlawb bounty room · ${title}`,
    `Bounty: ${amount} ${token}`,
    `Powered by SIGNA wallet-signed chat.`,
  ].join(" · ").slice(0, 500);

  const roomTs = Date.now();
  const roomMessage = [
    "SIGNA room create v1",
    `ts:${roomTs}`,
    `address:${botAddr}`,
    `name:bounty · ${title.slice(0, 60)}`,
    `slug:${slug}`,
    `public:true`,
    `description:${description}`,
  ].join("\n");

  const roomSig = await botAccount.signMessage({ message: roomMessage });

  const db = serverClient();
  const { data: createdRoom, error: roomErr } = await db
    .from("signa_rooms")
    .insert({
      name: `bounty · ${title.slice(0, 60)}`,
      slug,
      description,
      creator_address: botAddr,
      is_public: true,
      ts: roomTs,
      signature: roomSig,
      signed_message: roomMessage,
    })
    .select("id, slug, name")
    .single();

  if (roomErr) {
    return NextResponse.json(
      { ok: false, error: roomErr.message },
      { status: 500, headers: CORS },
    );
  }

  // Post the intro message
  const ts = Date.now();
  const introBody = [
    `gitlawb bounty thread.`,
    ``,
    `bounty id:   ${bountyId}`,
    `title:       ${title}`,
    `reward:      ${amount} ${token}`,
    assignee ? `assignee:    ${assignee}` : null,
    ``,
    `wallet-signed thread for claimants + maintainers. anyone can read. signatures are receipts.`,
    `type / for slash commands.`,
  ].filter(Boolean).join("\n");

  const msgPreimage = [
    "SIGNA room message v1",
    `ts:${ts}`,
    `from:${botAddr}`,
    `room:${slug}`,
    `body:${introBody}`,
  ].join("\n");
  const msgSig = await botAccount.signMessage({ message: msgPreimage });

  await db.from("signa_room_messages").insert({
    room_id: createdRoom.id,
    from_address: botAddr,
    body: introBody,
    body_type: "text",
    ts,
    signature: msgSig,
    signed_message: msgPreimage,
  });

  return NextResponse.json(
    { ok: true, slug, created: true, room: createdRoom },
    { status: 200, headers: CORS },
  );
}
