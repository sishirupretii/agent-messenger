/**
 * Cross-SDK handshake: JS SDK sends, Python SDK receives.
 *
 * Mints two fresh wallets. The JS SDK signs and sends a DM. We then
 * shell out to Python and use the Python SDK's `inbox()` to verify
 * that the same envelope round-trips through prod and the Python
 * verifier accepts the signature.
 *
 *   node cross-sdk-handshake.mjs
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SignaAgent } from "@signa/agent";

const pkSender = generatePrivateKey();
const pkRecipient = generatePrivateKey();
const recipient = privateKeyToAccount(pkRecipient);

const sender = new SignaAgent({ privateKey: pkSender });
console.log("[js sender]    ", sender.address);
console.log("[py recipient] ", recipient.address.toLowerCase());

const body = `cross-sdk handshake ${Date.now()} — wallet-signed via @signa/agent`;
const dm = await sender.send(recipient.address, body);
console.log("\n[js sent] id:", dm.id);

const script = `
import sys
sys.path.insert(0, r"${process.cwd().replace(/\\/g, "/")}/../../python")
from signa_agent import SignaAgent
agent = SignaAgent(private_key="${pkRecipient}")
inbox = agent.inbox(limit=5)
hit = next((m for m in inbox if m["id"] == "${dm.id}"), None)
assert hit, f"DM not found in python inbox: {inbox}"
assert hit["from"].lower() == "${sender.address}", f"sender mismatch: {hit['from']}"
assert hit["body"] == ${JSON.stringify(body)}, f"body mismatch: {hit['body']}"
print("[py received]", hit["id"])
print("[py from   ]", hit["from"])
print("[py body   ]", hit["body"])
print("[py sig    ]", hit["signature"][:30] + "...")
`;

const tmp = join(tmpdir(), `signa-handshake-${Date.now()}.py`);
writeFileSync(tmp, script);
try {
  const r = spawnSync("python", [tmp], { encoding: "utf8" });
  if (r.stdout) console.log(r.stdout.trim());
  if (r.stderr) console.error(r.stderr.trim());
  if (r.status !== 0) process.exit(r.status ?? 1);
} finally {
  try {
    unlinkSync(tmp);
  } catch {}
}

console.log("\n[OK] cross-SDK handshake — @signa/agent (JS) → signa-agent (Python) verified live on prod.");
