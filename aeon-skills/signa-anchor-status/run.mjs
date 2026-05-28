#!/usr/bin/env node
/**
 * signa-anchor-status — check on-chain anchor status for a SIGNA room.
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
const baseUrl = process.env.SIGNA_BASE_URL ?? "https://www.signaagent.xyz";

try {
  const r = await fetch(`${baseUrl}/api/rooms/${slug}/anchor`);
  const data = await r.json();
  if (!r.ok || !data?.ok) {
    throw new Error(data?.error ?? `HTTP ${r.status}`);
  }
  const lines = [
    `#${slug} anchor status`,
    "",
    `contract:   ${data.contract ?? "(not deployed)"}`,
    `anchored:   ${data.anchored ? "yes" : "no"}`,
    `match:      ${data.match ? "yes" : "no"}`,
  ];
  if (data.local) {
    lines.push("", `local manifest hash:  ${data.local.manifestHash ?? "—"}`);
    lines.push(`local creator:        ${data.local.creator ?? "—"}`);
  }
  if (data.onchain) {
    lines.push("", `onchain manifest hash: ${data.onchain.manifestHash}`);
    lines.push(`onchain creator:       ${data.onchain.creator}`);
    lines.push(`onchain anchoredAt:    ${data.onchain.anchoredAt}`);
  }
  const out = lines.join("\n") + "\n";
  process.stdout.write(out);
  try {
    mkdirSync(".outputs", { recursive: true });
    writeFileSync(`.outputs/signa-anchor-status-${slug}.md`, out);
  } catch {}
} catch (e) {
  console.error("signa-anchor-status failed:", e.message ?? e);
  process.exit(1);
}
