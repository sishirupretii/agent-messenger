/**
 * End-to-end smoke test for the SIGNA Agent Launchpad.
 *
 * Mints a fresh test agent wallet in this Node process, signs the
 * canonical agent_launch message, POSTs to the production launch
 * endpoint, then GETs the agent back to confirm it was persisted.
 *
 * Usage:
 *   node web/scripts/test-launch.mjs
 *
 * Or against a different host:
 *   BASE_URL=https://your-preview.vercel.app node web/scripts/test-launch.mjs
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createHash } from "node:crypto";

const BASE_URL = process.env.BASE_URL || "https://www.signaagent.xyz";

function buildAgentLaunchMessage(args) {
  return [
    "SIGNA agent launch v1",
    `ts:${args.ts}`,
    `address:${args.address}`,
    `name:${args.name}`,
    `tags:${args.tags.join(",")}`,
    `launched_by:${args.launched_by}`,
    `avatar_seed:${args.avatar_seed}`,
    `system_prompt_sha256:${args.system_prompt_hash}`,
    `desc:${args.description}`,
  ].join("\n");
}

async function main() {
  console.log(`Target: ${BASE_URL}`);

  // 1. Mint a fresh agent wallet.
  const agentKey = generatePrivateKey();
  const agentAccount = privateKeyToAccount(agentKey);
  const agentAddress = agentAccount.address.toLowerCase();

  // 2. Mint a fake launcher wallet too (test only — pretends to be the user).
  const launcherKey = generatePrivateKey();
  const launcherAccount = privateKeyToAccount(launcherKey);
  const launcherAddress = launcherAccount.address.toLowerCase();

  const name = `TestAgent${Math.floor(Math.random() * 10000)}`;
  const description =
    "End-to-end test agent — auto-launched by web/scripts/test-launch.mjs. Safe to ignore.";
  const tags = ["test", "e2e"];
  const systemPrompt =
    "You are a test agent. Reply with 'pong' to every message.";
  const avatarSeed = agentAddress;
  const promptHash = createHash("sha256").update(systemPrompt, "utf8").digest("hex");
  const ts = Date.now();

  const message = buildAgentLaunchMessage({
    address: agentAddress,
    name,
    description,
    tags,
    launched_by: launcherAddress,
    avatar_seed: avatarSeed,
    system_prompt_hash: promptHash,
    ts,
  });

  console.log("\n--- Canonical message ---");
  console.log(message);
  console.log("--- end ---\n");

  const signature = await agentAccount.signMessage({ message });

  console.log(`Agent address:    ${agentAddress}`);
  console.log(`Launcher address: ${launcherAddress}`);
  console.log(`Signature:        ${signature.slice(0, 18)}…${signature.slice(-8)}`);

  // 3. POST to /api/agents/launch.
  console.log("\nPOST /api/agents/launch …");
  const launchRes = await fetch(`${BASE_URL}/api/agents/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address: agentAddress,
      name,
      description,
      tags,
      system_prompt: systemPrompt,
      avatar_seed: avatarSeed,
      launched_by: launcherAddress,
      ts,
      signature,
    }),
  });

  const launchJson = await launchRes.json().catch(() => ({}));
  console.log(`HTTP ${launchRes.status}`);
  console.log(JSON.stringify(launchJson, null, 2));

  if (!launchRes.ok) {
    console.error("\nFAIL: launch endpoint rejected the agent.");
    process.exit(1);
  }

  // 4. GET it back.
  console.log(`\nGET /api/agents/${agentAddress} …`);
  const profileRes = await fetch(`${BASE_URL}/api/agents/${agentAddress}`);
  const profileJson = await profileRes.json().catch(() => ({}));
  console.log(`HTTP ${profileRes.status}`);
  console.log(JSON.stringify(profileJson, null, 2));

  if (!profileRes.ok || !profileJson.agent) {
    console.error("\nFAIL: agent did not persist.");
    process.exit(1);
  }

  // 5. Confirm /launchpad sees it.
  console.log(`\nGET /api/agents (full list) …`);
  const listRes = await fetch(`${BASE_URL}/api/agents`);
  const listJson = await listRes.json().catch(() => ({}));
  const found = (listJson.agents || []).find(
    (a) => a.address?.toLowerCase() === agentAddress,
  );
  if (!found) {
    console.error(`FAIL: agent ${agentAddress} not in /api/agents list.`);
    process.exit(1);
  }
  console.log(`Found in list with launched_at=${found.launched_at}`);

  console.log(`\nPASS — end-to-end launch round-trip succeeded.`);
  console.log(`Profile URL: ${BASE_URL}/agent/${agentAddress}`);
  console.log(`Launchpad:   ${BASE_URL}/launchpad`);

  // 6. Sanity-check the homepage and launchpad pages render (HTTP 200).
  for (const path of ["/", "/launch-agent", "/launchpad", `/agent/${agentAddress}`]) {
    const r = await fetch(`${BASE_URL}${path}`);
    console.log(`HEAD-equiv ${path}: HTTP ${r.status}`);
  }
}

main().catch((e) => {
  console.error("\nFAIL:", e);
  process.exit(1);
});
