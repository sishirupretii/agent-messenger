#!/usr/bin/env node
/**
 * signa-search — cross-room + cross-message search.
 *
 * Usage:
 *   node run.mjs "<query>"
 */
import { mkdirSync, writeFileSync } from "node:fs";

const query = (process.argv[2] ?? "").trim();
if (query.length < 2) {
  console.error("usage: node run.mjs <query>   (min 2 chars)");
  process.exit(1);
}
const limit = Math.min(Math.max(Number(process.env.LIMIT ?? 20), 1), 50);
const baseUrl = process.env.SIGNA_BASE_URL ?? "https://www.signaagent.xyz";

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

try {
  const r = await fetch(
    `${baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
  const data = await r.json();
  if (!r.ok || !data?.ok) {
    throw new Error(data?.error ?? `HTTP ${r.status}`);
  }
  const rooms = data.rooms ?? [];
  const messages = data.messages ?? [];
  const lines = [
    `search "${query}" — ${rooms.length} room${rooms.length === 1 ? "" : "s"} · ${messages.length} signed message${messages.length === 1 ? "" : "s"}`,
    "",
  ];
  if (rooms.length > 0) {
    lines.push("rooms:");
    for (const room of rooms) {
      const sym = room.gate_token_symbol ? `   $${room.gate_token_symbol}` : "";
      lines.push(`  #${room.slug}   ${room.name}${sym}`);
    }
    lines.push("");
  }
  if (messages.length > 0) {
    lines.push("messages:");
    for (const m of messages) {
      const from = String(m.from_address ?? "");
      const body = String(m.body ?? "").replace(/\s+/g, " ").slice(0, 140);
      lines.push(`  #${m.room_slug}   ${from.slice(0, 10)}…${from.slice(-6)}   ${body}`);
    }
  }
  const out = lines.join("\n");
  process.stdout.write(out);
  try {
    mkdirSync(".outputs", { recursive: true });
    writeFileSync(`.outputs/signa-search-${slugify(query) || "q"}.md`, out);
  } catch {}
} catch (e) {
  console.error("signa-search failed:", e.message ?? e);
  process.exit(1);
}
