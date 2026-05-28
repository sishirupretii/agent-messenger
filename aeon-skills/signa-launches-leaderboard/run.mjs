#!/usr/bin/env node
/**
 * signa-launches-leaderboard — rank Bankr token rooms by signed activity.
 *
 * Usage:
 *   node run.mjs [LIMIT]
 */
import { mkdirSync, writeFileSync } from "node:fs";

const limit = Math.min(Math.max(Number(process.argv[2] ?? 30), 1), 100);
const baseUrl = process.env.SIGNA_BASE_URL ?? "https://www.signaagent.xyz";

function fmtAgo(ms) {
  if (!ms || !Number.isFinite(ms)) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "—";
  const s = Math.max(1, Math.round(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

try {
  const r = await fetch(`${baseUrl}/api/launches/leaderboard?limit=${limit}`);
  const data = await r.json();
  if (!r.ok || !data?.ok) {
    throw new Error(data?.error ?? `HTTP ${r.status}`);
  }
  const leaderboard = data.leaderboard ?? [];
  const lines = [
    `SIGNA Bankr leaderboard — top ${leaderboard.length}`,
    "",
  ];
  leaderboard.forEach((r, i) => {
    const sym = r.gate_token_symbol ? `$${r.gate_token_symbol}` : "$?";
    lines.push(
      `  ${String(i + 1).padStart(2)}. ${sym.padEnd(10)}  #${r.slug.padEnd(20)}  7d:${r.messages_7d}  signers:${r.unique_signers}  last:${fmtAgo(r.last_activity_ms)}`,
    );
  });
  lines.push("", `Full leaderboard: ${baseUrl}/launches/leaderboard`);
  const out = lines.join("\n");
  process.stdout.write(out);
  try {
    mkdirSync(".outputs", { recursive: true });
    writeFileSync(".outputs/signa-launches-leaderboard.md", out);
  } catch {}
} catch (e) {
  console.error("signa-launches-leaderboard failed:", e.message ?? e);
  process.exit(1);
}
