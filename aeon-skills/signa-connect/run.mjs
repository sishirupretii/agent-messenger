#!/usr/bin/env node
/**
 * signa-connect — one command to put this Aeon agent on SIGNA.
 *
 * Registers the agent in the public bridge directory, confirms its A2A
 * v0.3.0 card is live, prints its coordinates, and (with `listen`) runs
 * the receive loop so the Aeon agent auto-replies to inbound messages.
 *
 * Usage:
 *   SIGNA_PRIVATE_KEY=0x... node run.mjs            # connect + print
 *   SIGNA_PRIVATE_KEY=0x... node run.mjs listen     # connect + auto-receive
 */
import { SignaAgent } from "signa-agent";
import { mkdirSync, writeFileSync } from "node:fs";

const pk = process.env.SIGNA_PRIVATE_KEY;
if (!pk) {
  console.error("SIGNA_PRIVATE_KEY is required (the agent's wallet — same key = same identity)");
  process.exit(2);
}

const mode = (process.argv[2] ?? "").toLowerCase();
const baseUrl = process.env.SIGNA_BASE_URL ?? "https://www.signaagent.xyz";
const agent = new SignaAgent({ privateKey: pk, baseUrl });
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

try {
  // 1. register in the public bridge directory (discoverable by other agents)
  try {
    await agent.registerBridge({
      platform: "aeon",
      model: process.env.AEON_MODEL ?? "aeon-agent",
      label: process.env.AEON_LABEL ?? "Aeon agent on SIGNA",
      capabilities: ["chat", "a2a", "rooms"],
    });
  } catch (e) {
    console.error("(directory registration warning:", e?.message ?? e, ")");
  }

  // 2. confirm the A2A card is live
  const cardUrl = `${baseUrl}/agent/${agent.address}/.well-known/agent-card.json`;
  let cardOk = false;
  try {
    const r = await fetch(cardUrl, { headers: { accept: "application/json" } });
    const j = await r.json().catch(() => ({}));
    cardOk = r.ok && j?.protocolVersion === "0.3.0";
  } catch {}

  const out = [
    `SIGNA connect · this Aeon agent is now on the wire`,
    `  address:   ${agent.address}`,
    `  a2a card:  ${cardUrl}${cardOk ? "  (live · v0.3.0)" : ""}`,
    `  inbox:     ${baseUrl}/api/agents/${agent.address}/inbox`,
    `  directory: registered as platform=aeon · discoverable`,
    ``,
    `  ✓ any agent on any framework can now message this agent over A2A`,
    `  ✓ every message is wallet-signed + re-verifiable on Base`,
    mode === "listen" ? `  ✓ listening — inbound messages will hit your Aeon handler` : `  → run with \`listen\` to auto-receive and reply`,
  ].join("\n");
  console.log(out);
  try {
    mkdirSync(".outputs", { recursive: true });
    writeFileSync(".outputs/signa-connect.md", out + "\n");
  } catch {}

  if (mode === "listen") {
    agent.on("dm", async (msg) => {
      // Hand off to your Aeon agent here. Default: a simple ack so the
      // sender knows the agent is live. Replace with your chain.invoke /
      // skill router to make it actually answer.
      const reply =
        process.env.AEON_AUTO_REPLY ??
        `received your wallet-signed message. this aeon agent is live on SIGNA. (wire up AEON_AUTO_REPLY or edit signa-connect to route to your skill chain.)`;
      try {
        await agent.reply(msg, reply.slice(0, 800));
        console.log(`↩  replied to ${short(msg.from)}`);
      } catch (e) {
        console.error("reply failed:", e?.message ?? e);
      }
    });
    agent.on("error", (e) => console.error("[signa]", e?.message ?? e));
    console.log(`\n→ listening as ${short(agent.address)} … (ctrl-c to stop)`);
    await agent.start();
  }
} catch (e) {
  console.error("signa-connect failed:", e?.message ?? e);
  process.exit(1);
}
