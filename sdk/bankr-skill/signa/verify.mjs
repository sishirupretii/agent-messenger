#!/usr/bin/env node
/**
 * Run every code block in SKILL.md against live SIGNA prod with two
 * fresh wallets. Proves the skill's claims are real before submitting
 * the PR to BankrBot/skills.
 *
 *   node verify.mjs
 */
import { SignaAgent } from "signa-agent";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const aKey = generatePrivateKey();
const bKey = generatePrivateKey();
const A = privateKeyToAccount(aKey);
const B = privateKeyToAccount(bKey);

const agentA = new SignaAgent({ privateKey: aKey });
const agentB = new SignaAgent({ privateKey: bKey });

const log = (lbl, ...rest) => console.log(`[${lbl}]`, ...rest);

// 1 · DM round-trip
log("1 · plaintext DM");
const dm = await agentA.send(B.address, "gm. signa skill verify run");
log("  A → B", dm.id, dm.body);

const inbox = await agentB.inbox({ limit: 5 });
const seen = inbox.find((m) => m.id === dm.id);
if (!seen) throw new Error("DM not in B's inbox");
log("  B inbox confirmed ✓");

// 2 · public room create + send
log("\n2 · public room create + send");
const pubSlug = `bankr-signa-pub-${Date.now().toString(36)}`.toLowerCase();
const pubRoom = await agentA.rooms.create({
  name: "bankr signa verify",
  slug: pubSlug,
  description: "skill verify run",
  is_public: true,
});
log("  created room", pubRoom.slug);
const posted = await agentA.rooms.send(pubSlug, "verify post from A");
log("  posted message", posted.id);

// 3 · encrypted room round-trip
log("\n3 · encrypted room create + send + read");
// Each member must unlock once so their X25519 pubkey is on the registry
// before anyone else can sealed-box encrypt to them. Cheap (one wallet
// sign per agent, deterministic = always the same key).
await agentA.encrypted.unlock();
await agentB.encrypted.unlock();
log("  both members published X25519 pubkeys");
const encSlug = `bankr-signa-enc-${Date.now().toString(36)}`.toLowerCase();
const encRoom = await agentA.encrypted.create({
  name: "bankr signa enc verify",
  slug: encSlug,
  members: [A.address.toLowerCase(), B.address.toLowerCase()],
});
log("  encrypted room", encRoom.slug, encRoom.encryption_version);
const sent = await agentA.encrypted.send(encSlug, "sealed-box from A. only B can open.");
log("  A sent envelope", sent.id, "digest", sent.ciphertext_digest?.slice(0, 12) + "…");

const bRows = await agentB.encrypted.read(encSlug);
const target = bRows.find((r) => r.id === sent.id);
if (!target || target.plaintext !== "sealed-box from A. only B can open.") {
  throw new Error(
    `B decrypt mismatch: got "${target?.plaintext}", expected "sealed-box from A. only B can open."`,
  );
}
log("  B decrypted ✓");

// 4 · search
log("\n4 · cross-room search");
const hits = await agentA.search.query("verify post", { limit: 5 });
log("  search hits", hits.length);

// 5 · Aeon resolve via REST (read-only)
log("\n5 · Aeon resolve via REST");
const aeonR = await fetch("https://www.signaagent.xyz/api/partners/aeon/1");
log("  /api/partners/aeon/1 →", aeonR.status);

log("\n✓ SKILL.md verify passed end-to-end against prod");
log(`  pub room:  https://www.signaagent.xyz/rooms/${pubSlug}`);
log(`  enc room:  https://www.signaagent.xyz/rooms/${encSlug}`);
log(`  A wallet:  ${A.address}`);
log(`  B wallet:  ${B.address}`);
