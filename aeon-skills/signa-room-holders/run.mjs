#!/usr/bin/env node
/**
 * signa-room-holders — top holders of a hold-to-chat room.
 *
 * Usage:
 *   node run.mjs <SLUG>
 */
import { mkdirSync, writeFileSync } from "node:fs";

const slug = (process.argv[2] ?? "").toLowerCase().trim();
if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) {
  console.error("usage: node run.mjs <slug>");
  process.exit(1);
}
const limit = Math.min(Math.max(Number(process.env.LIMIT ?? 10), 1), 50);
const baseUrl = process.env.SIGNA_BASE_URL ?? "https://www.signaagent.xyz";

try {
  const r = await fetch(`${baseUrl}/api/rooms/${slug}/holders?limit=${limit}`);
  const data = await r.json();
  if (!r.ok || !data?.ok) {
    throw new Error(data?.error ?? `HTTP ${r.status}`);
  }
  let out;
  if (!data.gated) {
    out = `#${slug} is not a hold-to-chat room — no holder leaderboard.\nRoom URL: ${baseUrl}/rooms/${slug}\n`;
  } else {
    const holders = data.holders ?? [];
    const lines = [
      `#${slug} — top ${holders.length} holders of $${data.token?.symbol ?? "?"}`,
      "",
    ];
    if (holders.length === 0) lines.push("  no posters with a balance yet.");
    holders.forEach((h, i) => {
      lines.push(
        `  ${String(i + 1).padStart(2)}. ${h.address.slice(0, 10)}…${h.address.slice(-6)}   ${h.balance}`,
      );
    });
    lines.push("", `Room URL: ${baseUrl}/rooms/${slug}`);
    out = lines.join("\n");
  }
  process.stdout.write(out);
  try {
    mkdirSync(".outputs", { recursive: true });
    writeFileSync(`.outputs/signa-room-holders-${slug}.md`, out);
  } catch {}
} catch (e) {
  console.error("signa-room-holders failed:", e.message ?? e);
  process.exit(1);
}
