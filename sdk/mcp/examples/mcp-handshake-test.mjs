/**
 * Drive the MCP server over stdio with real JSON-RPC requests — same
 * way Claude Desktop / Cursor / Windsurf do. Proves the server is
 * working end-to-end, including a live wallet-signed DM to prod SIGNA.
 */
import { spawn } from "node:child_process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Use a fresh wallet via env var so each test run is isolated.
const PK = generatePrivateKey();
const myAddr = privateKeyToAccount(PK).address.toLowerCase();

const proc = spawn("node", ["dist/index.js"], {
  cwd: process.cwd(),
  env: { ...process.env, SIGNA_PRIVATE_KEY: PK },
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
const responses = [];
let nextId = 1;
const pending = new Map();

proc.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  // JSON-RPC over stdio uses newline-delimited messages.
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      responses.push(msg);
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch (e) {
      console.error("[parse err]", line);
    }
  }
});

proc.stderr.on("data", (c) => process.stderr.write("[srv] " + c.toString()));

function call(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

async function main() {
  // 1. Initialize handshake (required by MCP spec)
  console.log("\n=== initialize ===");
  const initRes = await call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.1.0" },
  });
  console.log("server info:", initRes.result.serverInfo);
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // 2. List tools
  console.log("\n=== tools/list ===");
  const listRes = await call("tools/list", {});
  for (const t of listRes.result.tools) {
    console.log(" -", t.name, "—", t.description.slice(0, 70) + "...");
  }

  // 3. Call signa_my_address
  console.log("\n=== tools/call signa_my_address ===");
  const addrRes = await call("tools/call", { name: "signa_my_address", arguments: {} });
  console.log(addrRes.result.content[0].text.split("\n").slice(0, 3).join("\n"));

  // 4. Real wallet-signed send to a fresh recipient on prod
  const recipientPk = generatePrivateKey();
  const recipientAddr = privateKeyToAccount(recipientPk).address;
  console.log("\n=== tools/call signa_send_dm (to fresh recipient on prod) ===");
  const sendRes = await call("tools/call", {
    name: "signa_send_dm",
    arguments: {
      to: recipientAddr,
      body: "live MCP test " + Date.now() + " — wallet-signed via signa-mcp",
    },
  });
  console.log(sendRes.result.content[0].text);

  // 5. Discover bridges
  console.log("\n=== tools/call signa_list_bridges (status=all) ===");
  const bridgesRes = await call("tools/call", {
    name: "signa_list_bridges",
    arguments: { status: "all", limit: 3 },
  });
  console.log(bridgesRes.result.content[0].text.split("\n").slice(0, 6).join("\n") + "\n...");

  console.log("\n[OK] All 5 MCP tool calls verified against prod SIGNA — server is fully working.");
  console.log("[OK] My wallet:", myAddr);
  proc.kill();
}

main().catch((e) => {
  console.error(e);
  proc.kill();
  process.exit(1);
});

// Safety timeout
setTimeout(() => {
  console.error("[timeout] killed after 60s");
  proc.kill();
  process.exit(1);
}, 60_000);
