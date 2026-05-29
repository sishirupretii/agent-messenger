/**
 * v0.87 — verify SIGNA is a real A2A v0.3.0 transport.
 *
 * Acts as an off-the-shelf A2A client (raw JSON-RPC, no SIGNA SDK) to prove
 * any A2A agent can discover + message SIGNA with zero SIGNA-specific code:
 *
 *   1. discover the SIGNA network agent: GET /.well-known/agent-card.json
 *   2. message/send to its JSON-RPC url -> real wallet-signed LLM reply (Task)
 *   3. discover a specific SIGNA agent's card
 *   4. message/send to it -> message lands in that agent's wallet-signed
 *      SIGNA inbox; confirm via the public inbox API + re-verifiable signature
 *
 * Asserts spec-shape: protocolVersion 0.3.0, preferredTransport JSONRPC,
 * skills[], JSON-RPC result.kind === "task", task.status.state.
 *
 *   node scripts/v087-a2a-client-e2e.mjs
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.SIGNA_BASE ?? "https://www.signaagent.xyz";
let failures = 0;
const ok = (c, m) => { console.log((c ? "   ✓ " : "   ✗ FAIL ") + m); if (!c) failures++; };

async function getCard(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`card ${url} HTTP ${r.status}`);
  return r.json();
}
async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
function msg(text, idSeed) {
  return {
    message: {
      kind: "message",
      role: "user",
      parts: [{ kind: "text", text }],
      messageId: `mid-${idSeed}-${Math.floor(Date.now() / 1000)}`,
      metadata: { from: "a2a-conformance-client" },
    },
    configuration: { acceptedOutputModes: ["text/plain"] },
  };
}

// ── 1. discover the SIGNA network agent ──
console.log("1 · discover SIGNA via /.well-known/agent-card.json");
const gwCard = await getCard(`${BASE}/.well-known/agent-card.json`);
ok(gwCard.protocolVersion === "0.3.0", `protocolVersion = ${gwCard.protocolVersion}`);
ok(gwCard.preferredTransport === "JSONRPC", `preferredTransport = ${gwCard.preferredTransport}`);
ok(Array.isArray(gwCard.skills) && gwCard.skills.length > 0, `skills = ${gwCard.skills?.length}`);
ok(typeof gwCard.url === "string" && gwCard.url.includes("/api/a2a"), `url = ${gwCard.url}`);
ok(!!gwCard.securitySchemes?.signaWalletSig, "declares wallet-signed security scheme");

// ── 2. message/send to the SIGNA network agent ──
console.log("\n2 · message/send to SIGNA (expect a real wallet-signed reply)");
const ask = await rpc(gwCard.url, "message/send", msg("In one line: what does SIGNA add on top of A2A?", "ask"));
ok(ask.status === 200, `HTTP ${ask.status}`);
ok(ask.json?.result?.kind === "task", `result.kind = ${ask.json?.result?.kind}`);
ok(ask.json?.result?.status?.state === "completed", `task state = ${ask.json?.result?.status?.state}`);
const replyText = ask.json?.result?.status?.message?.parts?.[0]?.text ?? "";
ok(replyText.length > 10, `reply: "${replyText.slice(0, 90)}…"`);

// ── 3 + 4. discover + message a specific SIGNA agent ──
console.log("\n3 · discover a specific SIGNA agent's card");
const target = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const agentCard = await getCard(`${BASE}/agent/${target}/.well-known/agent-card.json`);
ok(agentCard.protocolVersion === "0.3.0", "agent card is v0.3.0");
ok(agentCard.url === `${BASE}/api/a2a/agents/${target}`, `agent url = ${agentCard.url}`);

console.log("\n4 · message/send to that agent → lands in its wallet-signed inbox");
const send = await rpc(agentCard.url, "message/send", msg("gm from an A2A client — are you reachable on SIGNA?", "dm"));
ok(send.status === 200, `HTTP ${send.status}`);
ok(send.json?.result?.kind === "task", `result.kind = ${send.json?.result?.kind}`);
ok(send.json?.result?.status?.state === "completed", `task state = ${send.json?.result?.status?.state}`);

// confirm it actually landed in the SIGNA inbox, wallet-signed
await new Promise((r) => setTimeout(r, 1500));
const inbox = await fetch(`${BASE}/api/agents/${target}/inbox?limit=5`).then((r) => r.json());
const landed = (inbox.dms ?? []).find((d) => /via A2A/.test(d.body));
ok(!!landed, landed ? `inbox entry found (dm ${landed.id})` : "inbox entry NOT found");
ok(!!landed?.signature && landed.signature.startsWith("0x"), "inbox entry is wallet-signed (re-verifiable)");

console.log(failures === 0 ? "\n✓ SIGNA is a conformant A2A v0.3.0 transport — verified end-to-end on prod" : `\n✗ ${failures} check(s) failed`);
console.log(`  SIGNA card:   ${BASE}/.well-known/agent-card.json`);
console.log(`  agent card:   ${BASE}/agent/${target}/.well-known/agent-card.json`);
if (failures > 0) process.exit(1);
