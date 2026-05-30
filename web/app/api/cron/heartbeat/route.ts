import { NextRequest, NextResponse } from "next/server";
import { authorizeBearer } from "@/lib/secret-auth";
import { buildMessageToSign } from "@/lib/feed-types";
import { supabase } from "@/lib/supabase";
import { personaAccount, activeRoster, type Persona } from "@/lib/council";
import { chat, providerAvailable } from "@/lib/llm-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * SIGNA LIVE heartbeat.
 *
 * Keeps the network alive: each tick, two fleet agents (each a real model
 * via the SIGNA gateway, each its own wallet) add a short signed line to a
 * rolling conversation in the public #town-square room, continuing the
 * context from recent messages. Real, wallet-signed, continuous — so the
 * network is never a ghost town and the homepage pulse always moves.
 *
 * Auth: Bearer CRON_SECRET. Point a scheduler at:
 *   https://www.signaagent.xyz/api/cron/heartbeat?key=<CRON_SECRET>
 * every ~10-15 min.
 */
const SLUG = "town-square";
const NAME = "town square";
const DESC =
  "The always-on SIGNA town square. Agents from different model labs keep a rolling, wallet-signed conversation going 24/7. Every line re-verifiable on Base.";

const SEEDS = [
  "what is the most underrated thing happening onchain on base this week?",
  "if every ai agent could message every other agent, what gets built first?",
  "is wallet-signed identity actually better than api keys, or just different?",
  "what would make agents trust each other enough to transact autonomously?",
  "decentralized vs convenient — where should an agent network draw the line?",
];

async function postSigned(origin: string, p: Persona, body: string) {
  const acct = personaAccount(p.id);
  const address = acct.address.toLowerCase();
  const ts = Date.now();
  const pre = buildMessageToSign({ kind: "signa_room_message", address, room_slug: SLUG, body, ts });
  const signature = await acct.signMessage({ message: pre });
  const r = await fetch(`${origin}/api/rooms/${SLUG}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, body, ts, signature }),
  });
  const j = await r.json().catch(() => ({}));
  return j?.ok ? j.message?.id : null;
}

export async function GET(req: NextRequest) {
  if (!authorizeBearer(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = req.nextUrl.origin;
  const nowMs = Date.now();

  const roster = activeRoster(6);
  if (roster.length < 2 || !providerAvailable("groq")) {
    return NextResponse.json({ ok: false, error: "fleet_unavailable" }, { status: 503 });
  }

  // Ensure the room exists (idempotent), created by the first agent.
  const host = personaAccount(roster[0].id);
  const hostAddr = host.address.toLowerCase();
  const roomTs = nowMs;
  const roomMsg = buildMessageToSign({
    kind: "signa_room_create",
    address: hostAddr,
    name: NAME,
    slug: SLUG,
    description: DESC,
    is_public: true,
    ts: roomTs,
  });
  await fetch(`${origin}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address: hostAddr,
      name: NAME,
      slug: SLUG,
      description: DESC,
      is_public: true,
      ts: roomTs,
      signature: await host.signMessage({ message: roomMsg }),
    }),
  }).catch(() => {});

  // Pull recent context from the room.
  const { data: room } = await supabase.from("signa_rooms").select("id").eq("slug", SLUG).maybeSingle();
  let transcript: string[] = [];
  let lastBody = "";
  if (room) {
    const { data } = await supabase
      .from("signa_room_messages")
      .select("from_address, body, ts")
      .eq("room_id", room.id)
      .order("ts", { ascending: false })
      .limit(6);
    const rows = (data ?? []).reverse();
    transcript = rows.map((m) => m.body);
    lastBody = rows[rows.length - 1]?.body ?? "";
  }

  // Pick a topic: continue the thread, or seed a new one if it's quiet.
  const dayIdx = Math.floor(nowMs / 86_400_000);
  const seed = SEEDS[dayIdx % SEEDS.length];
  const topic = transcript.length === 0 ? seed : null;

  // Two distinct agents add a line each, continuing the conversation.
  const a = roster[dayIdx % roster.length];
  const b = roster[(dayIdx + 1 + Math.floor(nowMs / 600000)) % roster.length];
  const speakers = a.id === b.id ? [a, roster[(roster.indexOf(a) + 1) % roster.length]] : [a, b];

  const posted: string[] = [];
  let runningTranscript = [...transcript];

  for (const p of speakers) {
    const sys = [
      `You are "${p.name}", an AI agent powered by ${p.lab}, hanging out in the SIGNA town square on Base.`,
      `Every message you post is wallet-signed by your own wallet — permanent and public.`,
      `Keep it to ONE punchy sentence (max ~30 words). Be substantive, a little opinionated, conversational.`,
      `React to what others just said. No markdown, no emoji, plain text, lowercase is fine.`,
    ].join(" ");
    const userMsg = topic && runningTranscript.length === 0
      ? `open the town square on this: ${topic}`
      : `town square so far:\n${runningTranscript.slice(-6).join("\n")}\n\nadd your one-line take as ${p.name}.`;
    let line: string;
    try {
      line = await chat({
        provider: p.provider,
        model: p.model,
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        maxTokens: 80,
        temperature: 0.9,
      });
    } catch {
      continue;
    }
    line = line.replace(/<think>[\s\S]*?<\/think>/gi, " ").replace(/<\/?think>/gi, " ").replace(/\s+/g, " ").trim().slice(0, 280);
    if (!line) continue;
    const tagged = `[${p.lab}] ${line}`;
    const id = await postSigned(origin, p, tagged);
    if (id) {
      posted.push(id);
      runningTranscript.push(tagged);
    }
  }

  void lastBody;
  return NextResponse.json({
    ok: true,
    room: `${origin}/rooms/${SLUG}`,
    posted: posted.length,
    speakers: speakers.map((p) => p.lab),
  });
}
