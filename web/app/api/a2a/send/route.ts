import { NextRequest, NextResponse } from "next/server";
import { genId, type A2AMessage } from "@/lib/a2a";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/a2a/send — outbound A2A bridge.
 *
 * Lets a SIGNA agent message ANY external A2A agent (Google ADK,
 * LangGraph, CrewAI, LlamaIndex, AutoGen, or another SIGNA agent). This
 * is the other half of interop: SIGNA agents reach OUT, not just receive.
 *
 * Body:
 *   {
 *     card_url?: string,   // an A2A agent-card.json URL (we discover .url)
 *     endpoint?: string,   // OR a direct A2A JSON-RPC endpoint
 *     text: string,
 *     from?: string,       // optional sender label (goes in message.metadata)
 *     contextId?: string
 *   }
 *
 * Flow: (1) if card_url, fetch it and read its `url`; (2) POST a
 * JSON-RPC `message/send` to that endpoint; (3) return the external
 * agent's Task/Message reply verbatim plus the resolved endpoint.
 *
 * SECURITY: only outbound https(s) to the caller-supplied agent endpoint.
 * No SIGNA secrets are attached. The sender label is advisory metadata.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function isHttpUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400, headers: CORS });
  }

  const text = String(body?.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ ok: false, error: "text_required" }, { status: 400, headers: CORS });
  }
  const from = body?.from ? String(body.from).slice(0, 80) : "a SIGNA agent";

  // Resolve the JSON-RPC endpoint: either given directly, or discovered
  // from an Agent Card.
  let endpoint: string | null = isHttpUrl(body?.endpoint) ? body.endpoint : null;
  let discoveredFromCard = false;
  let cardName: string | null = null;

  if (!endpoint && isHttpUrl(body?.card_url)) {
    try {
      const cr = await fetch(body.card_url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!cr.ok) {
        return NextResponse.json(
          { ok: false, error: "card_fetch_failed", status: cr.status },
          { status: 502, headers: CORS },
        );
      }
      const card = await cr.json();
      cardName = typeof card?.name === "string" ? card.name : null;
      if (isHttpUrl(card?.url)) {
        endpoint = card.url;
        discoveredFromCard = true;
      } else {
        return NextResponse.json(
          { ok: false, error: "card_has_no_url" },
          { status: 422, headers: CORS },
        );
      }
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: "card_unreachable", detail: e instanceof Error ? e.message : String(e) },
        { status: 502, headers: CORS },
      );
    }
  }

  if (!endpoint) {
    return NextResponse.json(
      { ok: false, error: "endpoint_or_card_url_required" },
      { status: 400, headers: CORS },
    );
  }

  const messageId = genId("msg", text.slice(0, 24) + from);
  const message: A2AMessage = {
    kind: "message",
    role: "user",
    parts: [{ kind: "text", text }],
    messageId,
    ...(body?.contextId ? { contextId: String(body.contextId) } : {}),
    metadata: { from, via: "signa.a2a.outbound" },
  };

  const rpcReq = {
    jsonrpc: "2.0",
    id: genId("rpc", messageId),
    method: "message/send",
    params: { message, configuration: { acceptedOutputModes: ["text/plain"] } },
  };

  let reply: any;
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(rpcReq),
      signal: AbortSignal.timeout(45_000),
    });
    reply = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: "remote_error", status: r.status, reply },
        { status: 502, headers: CORS },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "send_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502, headers: CORS },
    );
  }

  // Pull the human-readable reply text out of an A2A result if present.
  const result = reply?.result;
  let replyText: string | null = null;
  const partsFrom = (m: any) =>
    Array.isArray(m?.parts) ? m.parts.filter((p: any) => p.kind === "text").map((p: any) => p.text).join("\n") : null;
  if (result?.kind === "task") replyText = partsFrom(result?.status?.message);
  else if (result?.kind === "message") replyText = partsFrom(result);

  return NextResponse.json(
    {
      ok: true,
      endpoint,
      discovered_from_card: discoveredFromCard,
      remote_agent: cardName,
      sent: text,
      reply_text: replyText,
      raw: reply,
    },
    { status: 200, headers: CORS },
  );
}
