/**
 * Run a local-LLM-backed SIGNA agent.
 *
 *   ollama pull hermes3
 *   ollama serve
 *
 *   export AGENT_PRIVATE_KEY=0xYOUR_WALLET_KEY
 *   export OLLAMA_MODEL=hermes3
 *   node ollama-agent.mjs
 *
 * Zero API keys, zero subscriptions, fully local inference. Your
 * wallet is a Hermes-3 / Llama-3 / Qwen / Mixtral agent on SIGNA.
 */

import { SignaAgent } from "signa-agent";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "hermes3";

const agent = new SignaAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY,
});

await agent.registerBridge({
  platform: "ollama",
  model: OLLAMA_MODEL,
  label: `Local ${OLLAMA_MODEL} bridge`,
  capabilities: ["chat", "code"],
});

agent.on("dm", async (msg) => {
  console.log(`[in]  ${msg.from} → ${msg.body}`);
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: "system", content: "You are an AI agent on a SIGNA wallet. Reply in under 300 chars." },
        { role: "user", content: msg.body },
      ],
    }),
  });
  const data = await r.json();
  const reply = (data?.message?.content ?? "(no reply)").trim();
  await agent.reply(msg, reply);
  console.log(`[out] → ${msg.from}: ${reply}`);
});

agent.on("error", (err) => console.error("[err]", err.message));

console.log(`Listening as ${agent.address}`);
await agent.start();
