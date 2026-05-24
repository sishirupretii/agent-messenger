/**
 * Two-SDK live cross-platform conversation demo.
 *
 *   node sdk/js/examples/two-sdk-conversation.mjs
 *
 * Mints two fresh wallets, runs them as independent SignaAgent
 * instances, and has them hold a 3-turn conversation over prod SIGNA.
 *
 * Side A speaks via SIGNA's hosted Groq gateway (`/api/gateway/respond`).
 * Side B speaks via the same gateway with a different system prompt to
 * prove they're independent personas — neither side shares state with
 * the other; everything moves through SIGNA's wallet-signed DM substrate.
 *
 * No external API keys required. Both wallets are fresh, on-chain
 * unaffiliated, fully external to SIGNA's user table.
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { SignaAgent } from "@signa/agent";

const BASE = "https://www.signaagent.xyz";
const TURNS = 3;

const personaA = "You are an AI agent specialized in protocol security. Reply in <=200 chars, one paragraph, focused on the practical security angle of whatever's discussed.";
const personaB = "You are an AI agent specialized in developer experience. Reply in <=200 chars, one paragraph, focused on how developers will actually use whatever's discussed.";

async function brain(prompt, system) {
  const r = await fetch(`${BASE}/api/gateway/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: `${system}\n\nQ: ${prompt}` }),
  });
  const data = await r.json();
  return data?.response?.trim() ?? "(no reply)";
}

const pkA = generatePrivateKey();
const pkB = generatePrivateKey();
const agentA = new SignaAgent({ privateKey: pkA });
const agentB = new SignaAgent({ privateKey: pkB });

console.log("Agent A:", agentA.address);
console.log("Agent B:", agentB.address);

let turn = 0;
let done = false;
let resolveDone;
const donePromise = new Promise((res) => (resolveDone = res));

agentA.on("dm", async (msg) => {
  if (msg.from.toLowerCase() !== agentB.address) return;
  console.log(`\n[A ← B] ${msg.body}`);
  if (turn >= TURNS) {
    done = true;
    resolveDone();
    return;
  }
  turn++;
  const reply = await brain(msg.body, personaA);
  console.log(`[A → B] ${reply}`);
  await agentA.reply(msg, reply);
});

agentB.on("dm", async (msg) => {
  if (msg.from.toLowerCase() !== agentA.address) return;
  console.log(`\n[B ← A] ${msg.body}`);
  if (turn >= TURNS) {
    done = true;
    resolveDone();
    return;
  }
  turn++;
  const reply = await brain(msg.body, personaB);
  console.log(`[B → A] ${reply}`);
  await agentB.reply(msg, reply);
});

agentA.on("error", (e) => console.error("[A err]", e.message));
agentB.on("error", (e) => console.error("[B err]", e.message));

// Start both poll loops
agentA.start();
agentB.start();

// Kick the conversation off
await new Promise((res) => setTimeout(res, 1500));
const opener = "Quick exchange: what's the biggest open problem in cross-platform AI agent messaging right now?";
console.log(`\n[A → B] ${opener}`);
await agentA.send(agentB.address, opener);

// Wait until TURNS messages have flowed
const TIMEOUT_MS = 90_000;
await Promise.race([
  donePromise,
  new Promise((res) => setTimeout(res, TIMEOUT_MS)),
]);

agentA.stop();
agentB.stop();

// Fetch the final thread via the SDK (which normalizes field names)
const thread = await agentA.thread(agentB.address);
console.log(`\n\n=== thread persisted on prod: ${thread.length} messages ===`);
for (const dm of thread) {
  const who = dm.from.toLowerCase() === agentA.address ? "A" : "B";
  console.log(`  [${who}] ${dm.body.slice(0, 100)}${dm.body.length > 100 ? "…" : ""}`);
}
console.log(`\nVerify yourself: curl '${BASE}/api/dm/thread?a=${agentA.address}&b=${agentB.address}'`);
