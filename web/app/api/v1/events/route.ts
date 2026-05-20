import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/events — real-time event stream of new SIGNA interactions.
 *
 * Server-Sent Events (SSE). One open connection per client. While the
 * connection is open we poll agent_interactions every 3s for rows
 * newer than the last cursor and emit each one as a `data:` line.
 *
 * Why this exists:
 *   - Devs building monitoring dashboards / live activity feeds /
 *     Discord bots that want to react to network activity in real
 *     time. Without this they'd have to poll /api/interactions
 *     themselves and re-implement cursor logic.
 *   - It's the "ws://signaagent.xyz" people expect from a real-time
 *     network, delivered via SSE because Vercel edge functions don't
 *     do websockets and SSE works everywhere.
 *
 * Query params (all optional):
 *   ?since=<ISO timestamp>     — start streaming from this point
 *   ?agent_address=0x...       — filter to one agent
 *   ?intent=facts|swarm|...    — filter by intent
 *   ?max_duration=<sec>        — close stream after N seconds
 *                                  (default 300, max 600)
 *
 * Per-event payload:
 *   data: {
 *     type: "interaction.created",
 *     id, agent_address, sender_address, intent, message_preview,
 *     response_preview, signed, sources, created_at, permalink
 *   }
 *
 * Keepalive: `: ping\n\n` (SSE comment) every 30s so proxies don't
 * close the idle connection.
 *
 * After max_duration the server emits a `event: timeout` event and
 * closes. Clients reconnect with the last-seen cursor in ?since.
 *
 * Edge runtime — Vercel keeps this open for the full duration without
 * the serverless 10-15s timeout that would kill it on the node runtime.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type InteractionRow = {
  id: string;
  agent_address: string;
  sender_address: string | null;
  message: string;
  response: string;
  intent: string;
  signed: boolean;
  sources: Array<{ kind: string; ref: string }>;
  created_at: string;
};

function truncate(s: string, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}

export async function GET(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return new Response(
      JSON.stringify({ error: "supabase_not_configured" }),
      {
        status: 503,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const url = req.nextUrl;
  let cursor =
    url.searchParams.get("since") ?? new Date().toISOString();
  const agentFilter = url.searchParams.get("agent_address")?.toLowerCase();
  const intentFilter = url.searchParams.get("intent");
  const maxDuration = Math.min(
    600,
    Math.max(10, Number(url.searchParams.get("max_duration") ?? 300)),
  );

  // Validate agent_address format if provided.
  if (agentFilter && !/^0x[a-f0-9]{40}$/.test(agentFilter)) {
    return new Response(
      JSON.stringify({ error: "invalid_agent_address" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  // We re-initialize the supabase client per-request rather than
  // hoisting it as a module-level singleton because edge runtime can
  // re-use module state across invocations in unpredictable ways.
  const db = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false },
  });

  const POLL_INTERVAL_MS = 3000;
  const KEEPALIVE_MS = 30_000;

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        try {
          const lines = [
            `event: ${event}`,
            `data: ${JSON.stringify(payload)}`,
            "",
            "",
          ].join("\n");
          controller.enqueue(encoder.encode(lines));
        } catch {
          // controller may already be closed (client disconnected)
        }
      };

      const sendData = (payload: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          // closed
        }
      };

      const sendComment = (text: string) => {
        try {
          controller.enqueue(encoder.encode(`: ${text}\n\n`));
        } catch {
          // closed
        }
      };

      // Hello — server tells the client what cursor we started from
      // so they can resume on reconnect.
      send("hello", {
        server: "signa-events",
        cursor,
        filters: {
          agent_address: agentFilter ?? null,
          intent: intentFilter ?? null,
        },
        max_duration_sec: maxDuration,
      });

      let closed = false;
      const closeNow = (reason: string) => {
        if (closed) return;
        closed = true;
        try {
          send("close", { reason });
        } catch {
          // ignore
        }
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      // ---- main poll loop ----
      const poll = async () => {
        if (closed) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let q: any = db
            .from("agent_interactions")
            .select(
              "id, agent_address, sender_address, message, response, intent, signed, sources, created_at",
            )
            .gt("created_at", cursor)
            .order("created_at", { ascending: true })
            .limit(50);
          if (agentFilter) q = q.eq("agent_address", agentFilter);
          if (intentFilter) q = q.eq("intent", intentFilter);
          const { data } = (await q) as { data: InteractionRow[] | null };
          for (const row of data ?? []) {
            sendData({
              type: "interaction.created",
              id: row.id,
              agent_address: row.agent_address,
              sender_address: row.sender_address,
              intent: row.intent,
              signed: row.signed,
              sources: row.sources ?? [],
              message_preview: truncate(row.message, 140),
              response_preview: truncate(row.response, 240),
              created_at: row.created_at,
              permalink: `https://www.signaagent.xyz/i/${row.id}`,
            });
            cursor = row.created_at;
          }
        } catch (e) {
          // Don't kill the stream on transient errors. Emit an error
          // event so the client can log it, then keep polling.
          send("error", {
            message: e instanceof Error ? e.message : String(e),
          });
        }
      };

      const pollTimer = setInterval(poll, POLL_INTERVAL_MS);
      const keepaliveTimer = setInterval(
        () => sendComment("ping " + Date.now()),
        KEEPALIVE_MS,
      );

      // ---- timeout ----
      const closeTimer = setTimeout(() => {
        clearInterval(pollTimer);
        clearInterval(keepaliveTimer);
        closeNow("max_duration_reached");
      }, maxDuration * 1000);

      // ---- client disconnect handling ----
      // The Response API doesn't give us a direct `on close` hook,
      // but Vercel calls cancel() on the underlying stream when the
      // client disconnects. See the cancel() handler below.
      const cleanup = () => {
        clearInterval(pollTimer);
        clearInterval(keepaliveTimer);
        clearTimeout(closeTimer);
      };
      // Stash cleanup on the controller so cancel() can call it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controller as any)._cleanup = cleanup;

      // Fire one immediate poll so the client gets recent items right
      // away if they reconnect with a stale cursor.
      void poll();
    },
    cancel() {
      // Client closed. Cleanup is best-effort — the controller is
      // already torn down at this point.
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": "*",
      "x-signa-stream-uptime-sec": String(
        Math.floor((Date.now() - startedAt) / 1000),
      ),
    },
  });
}
