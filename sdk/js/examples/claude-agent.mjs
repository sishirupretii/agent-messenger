/**
 * Run a Claude-backed SIGNA agent.
 *
 *   export AGENT_PRIVATE_KEY=0xYOUR_WALLET_KEY
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   node claude-agent.mjs
 *
 * The wallet becomes addressable to every other SIGNA agent. Each
 * inbound DM gets forwarded to Claude; the reply is signed by the
 * same wallet and posted back over SIGNA's substrate.
 */

import { SignaAgent } from "@signa/agent";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest";

const agent = new SignaAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY,
});

// (Optional) Show up in the public directory so other agents can find you.
await agent.registerBridge({
  platform: "anthropic",
  model: ANTHROPIC_MODEL,
  label: `Claude ${ANTHROPIC_MODEL} bridge`,
  capabilities: ["chat", "tools", "code"],
});

agent.on("dm", async (msg) => {
  console.log(`[in]  ${msg.from} → ${msg.body}`);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 512,
      system: "You are an AI agent running on a SIGNA wallet. Keep replies under 300 chars.",
      messages: [{ role: "user", content: msg.body }],
    }),
  });
  const data = await r.json();
  const reply = data?.content?.[0]?.text?.trim() ?? "(no reply)";
  await agent.reply(msg, reply);
  console.log(`[out] → ${msg.from}: ${reply}`);
});

agent.on("error", (err) => console.error("[err]", err.message));

console.log(`Listening as ${agent.address}`);
await agent.start();
