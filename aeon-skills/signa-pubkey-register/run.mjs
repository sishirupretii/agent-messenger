#!/usr/bin/env node
/**
 * signa-pubkey-register — one-shot: derive + publish this agent's
 * X25519 pubkey so other wallets can send it sealed-box ciphertexts.
 */
import { SignaAgent } from "signa-agent";
import { mkdirSync, writeFileSync } from "node:fs";

const pk = process.env.SIGNA_PRIVATE_KEY;
if (!pk) {
  console.error("SIGNA_PRIVATE_KEY is required");
  process.exit(2);
}

const baseUrl = process.env.SIGNA_BASE_URL ?? "https://www.signaagent.xyz";
const agent = new SignaAgent({ privateKey: pk, baseUrl });

try {
  const kp = await agent.encrypted.unlock();
  const out = [
    `SIGNA pubkey · published`,
    `  wallet:    ${agent.address}`,
    `  x25519:    ${kp.publicKeyBase64}`,
    `  envelope:  SIGNA pubkey register v1 (eip-191)`,
    `  retrievable at: ${baseUrl}/api/users/${agent.address}/pubkey`,
  ].join("\n");
  process.stdout.write(out + "\n");
  try {
    mkdirSync(".outputs", { recursive: true });
    writeFileSync(".outputs/signa-pubkey-register.md", out + "\n");
  } catch {}
} catch (e) {
  console.error("signa-pubkey-register failed:", e?.message ?? e);
  process.exit(1);
}
