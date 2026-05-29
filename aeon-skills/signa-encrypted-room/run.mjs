#!/usr/bin/env node
/**
 * signa-encrypted-room — open / send / read v0.80 sealed-box-per-member
 * encrypted SIGNA rooms.
 *
 * Usage:
 *   SIGNA_PRIVATE_KEY=0x... node run.mjs "create <slug> | <name> | 0xa,0xb"
 *   SIGNA_PRIVATE_KEY=0x... node run.mjs "send   <slug> | <plaintext>"
 *   SIGNA_PRIVATE_KEY=0x... node run.mjs "read   <slug>"
 */
import { SignaAgent } from "signa-agent";
import { mkdirSync, writeFileSync } from "node:fs";

const pk = process.env.SIGNA_PRIVATE_KEY;
if (!pk) {
  console.error("SIGNA_PRIVATE_KEY is required");
  process.exit(2);
}

const input = (process.argv[2] ?? "").trim();
if (!input) {
  console.error("usage: run.mjs \"<create|send|read> <slug> | <args>\"");
  process.exit(2);
}

const baseUrl = process.env.SIGNA_BASE_URL ?? "https://www.signaagent.xyz";
const agent = new SignaAgent({ privateKey: pk, baseUrl });

function fmtAddr(a) {
  if (!a || a.length < 10) return a ?? "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
function fmtTs(ms) {
  if (!ms) return "—";
  try {
    return new Date(Number(ms)).toISOString().replace("T", " ").slice(0, 16);
  } catch {
    return String(ms);
  }
}

const [verbToken, ...rest] = input.split(/\s+/);
const verb = (verbToken ?? "").toLowerCase();
const after = rest.join(" ");

const lines = [];

try {
  if (verb === "create") {
    const parts = after.split("|").map((s) => s.trim());
    if (parts.length < 3) {
      throw new Error('create needs: "<slug> | <name> | 0xmem1,0xmem2,..."');
    }
    const [slug, name, memberCsv] = parts;
    const members = memberCsv
      .split(/[, ]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^0x[a-f0-9]{40}$/.test(s));
    const room = await agent.encrypted.create({ name, slug, members });
    lines.push(
      `SIGNA encrypted room · created`,
      `  slug:        #${room.slug}`,
      `  name:        ${room.name}`,
      `  encryption:  ${room.encryption_version ?? "signa-sealedbox-v1"}`,
      `  members:     ${members.length + (members.includes(agent.address) ? 0 : 1)}`,
      `    ${agent.address}  (creator)`,
    );
    for (const m of members) {
      if (m !== agent.address) lines.push(`    ${m}`);
    }
    lines.push(`  re-verify:   ${baseUrl}/rooms/${room.slug}`);
  } else if (verb === "send") {
    const parts = after.split("|").map((s) => s.trim());
    if (parts.length < 2) throw new Error('send needs: "<slug> | <plaintext>"');
    const [slug, plaintext] = parts;
    if (!plaintext) throw new Error("plaintext is required");
    const res = await agent.encrypted.send(slug, plaintext);
    lines.push(
      `SIGNA encrypted room · send`,
      `  slug:        #${slug}`,
      `  envelope id: ${res.id}`,
      `  digest:      ${res.ciphertext_digest ?? "—"}`,
      `  sealed for:  ${Object.keys(res.ciphertexts ?? {}).length} members`,
      `  re-verify:   ${baseUrl}/api/rooms/${slug}/messages`,
    );
  } else if (verb === "read") {
    const slug = after.trim();
    if (!slug) throw new Error("read needs a slug");
    const rows = await agent.encrypted.read(slug, { limit: 50 });
    const decrypted = rows.filter((r) => r.plaintext != null).length;
    lines.push(
      `SIGNA encrypted room · read`,
      `  slug:        #${slug}`,
      `  decrypted:   ${decrypted}/${rows.length} messages addressed to this wallet`,
      ``,
    );
    for (const r of rows.slice(-20)) {
      const txt = r.plaintext ?? "[no ciphertext for this wallet]";
      lines.push(`  [${fmtTs(r.ts)}] ${fmtAddr(r.from_address)} → ${txt}`);
    }
  } else {
    throw new Error(`unknown verb "${verb}" — expected create | send | read`);
  }

  const out = lines.join("\n");
  process.stdout.write(out + "\n");
  try {
    mkdirSync(".outputs", { recursive: true });
    writeFileSync(".outputs/signa-encrypted-room.md", out + "\n");
  } catch {}
} catch (e) {
  console.error("signa-encrypted-room failed:", e?.message ?? e);
  process.exit(1);
}
