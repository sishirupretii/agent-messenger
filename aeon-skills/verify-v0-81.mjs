#!/usr/bin/env node
/**
 * v0.81 verification — run the three NEW aeon skills against signa prod
 * with two freshly-minted wallets. Captures stdout from each skill so we
 * can prove the round trip end to end.
 */
import { spawnSync } from "node:child_process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const aKey = generatePrivateKey();
const bKey = generatePrivateKey();
const A = privateKeyToAccount(aKey);
const B = privateKeyToAccount(bKey);

const env = (pk) => ({ ...process.env, SIGNA_PRIVATE_KEY: pk });

function run(label, skill, input, pk) {
  console.log(`\n────── ${label} ──────`);
  const args = input == null ? [`${skill}/run.mjs`] : [`${skill}/run.mjs`, input];
  const r = spawnSync("node", args, {
    env: env(pk),
    encoding: "utf8",
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error(`${label} failed with exit ${r.status}`);
  return r.stdout;
}

console.log("A wallet:", A.address);
console.log("B wallet:", B.address);

// ── 1. each agent publishes its X25519 pubkey ──
run("A · pubkey-register", "signa-pubkey-register", null, aKey);
run("B · pubkey-register", "signa-pubkey-register", null, bKey);

// ── 2. A creates a private encrypted room with both members ──
const slug = `aeon-v081-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
run(
  "A · create encrypted room",
  "signa-encrypted-room",
  `create ${slug} | aeon v0.81 test | ${A.address.toLowerCase()},${B.address.toLowerCase()}`,
  aKey,
);

// ── 3. A sends encrypted message ──
run(
  "A · send sealed message",
  "signa-encrypted-room",
  `send ${slug} | swarm decision: rotate keys at 14:00 UTC. acknowledge.`,
  aKey,
);

// ── 4. B reads + decrypts ──
const readOut = run("B · read + decrypt", "signa-encrypted-room", `read ${slug}`, bKey);

// ── 5. B sends reply ──
run(
  "B · send sealed reply",
  "signa-encrypted-room",
  `send ${slug} | ack — rotating now. fleet quorum reached.`,
  bKey,
);

// ── 6. A reads B's reply ──
run("A · read + decrypt B reply", "signa-encrypted-room", `read ${slug}`, aKey);

// ── 7. trust-gate check: A asks if B is trustworthy ──
run(
  "A · trust-gate B (informational, no req_8004)",
  "signa-trust-gate",
  `${B.address.toLowerCase()}`,
  aKey,
);

console.log("\n✓ v0.81 end-to-end verification complete");
console.log(`  encrypted room slug: ${slug}`);
console.log(`  A: ${A.address}`);
console.log(`  B: ${B.address}`);
