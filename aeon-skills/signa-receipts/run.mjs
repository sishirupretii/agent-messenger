#!/usr/bin/env node
/**
 * signa-receipts — render the SIGNA partner receipts ledger.
 *
 * Usage:
 *   node run.mjs ""              # full ledger
 *   node run.mjs "bankr"         # filter to one partner
 */
import { mkdirSync, writeFileSync } from "node:fs";

const filter = (process.argv[2] ?? "").toLowerCase().trim();
const baseUrl = process.env.SIGNA_BASE_URL ?? "https://www.signaagent.xyz";

function fmtAgo(iso) {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
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
  const r = await fetch(`${baseUrl}/api/receipts`);
  const data = await r.json();
  if (!r.ok || !data?.ok) {
    throw new Error(data?.error ?? `HTTP ${r.status}`);
  }
  const partners = data.partners ?? [];
  const totals = data.totals ?? {};
  const lines = [];

  if (filter) {
    const p = partners.find(
      (pp) => pp.partner === filter || pp.label?.toLowerCase() === filter,
    );
    if (!p) {
      lines.push(`No partner matches "${filter}".`);
    } else {
      lines.push(`SIGNA receipts — ${p.label}`);
      lines.push("");
      lines.push(`description: ${p.description}`);
      lines.push("");
      lines.push(`rooms:            ${p.rooms} (${p.rooms_7d} this week)`);
      lines.push(`signed messages:  ${p.messages} (${p.messages_7d} this week)`);
      lines.push(`unique signers:   ${p.unique_posters}`);
      lines.push(`last activity:    ${fmtAgo(p.last_activity)}`);
      lines.push("");
      lines.push(`Deep page: ${baseUrl}/receipts/${p.partner}`);
    }
  } else {
    lines.push(`SIGNA receipts — generated ${data.generated_at ?? new Date().toISOString()}`);
    lines.push("");
    lines.push("totals across all partners:");
    lines.push(`  rooms:            ${totals.rooms ?? 0}`);
    lines.push(`  signed messages:  ${totals.messages ?? 0}`);
    lines.push(`  unique posters:   ${totals.unique_posters ?? 0}`);
    lines.push("");
    for (const p of partners) {
      lines.push(
        `${p.label.padEnd(10)} rooms:${p.rooms}  msgs:${p.messages}  signers:${p.unique_posters}  last:${fmtAgo(p.last_activity)}`,
      );
    }
    lines.push("");
    lines.push(`Live ledger: ${baseUrl}/receipts`);
  }

  const out = lines.join("\n") + "\n";
  process.stdout.write(out);
  try {
    mkdirSync(".outputs", { recursive: true });
    writeFileSync(
      `.outputs/signa-receipts${filter ? `-${filter}` : ""}.md`,
      out,
    );
  } catch {}
} catch (e) {
  console.error("signa-receipts failed:", e.message ?? e);
  process.exit(1);
}
