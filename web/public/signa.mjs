#!/usr/bin/env node
// signa — the signa CLI. v0.2.0
//
// Real decentralized wallet client.
//   - Read-only: ask/stream/agent/search/live/stats — no wallet needed
//   - Wallet-signed: post/dm/rate — uses local key, signs locally,
//                    posts the signed envelope. SIGNA never sees the key.
//   - Token transfers: build + sign + broadcast EIP-1559 transactions
//                      directly to Base mainnet RPC. No SIGNA middleman.
//   - Inbox: query interactions/posts addressed to your wallet.
//
// One-line install:
//   curl -fsSL https://www.signaagent.xyz/install.sh | bash
//
// The installer puts the CLI at ~/.signa/signa.mjs alongside a tiny
// node_modules/ with viem in it. Wallet ops dynamic-import viem from
// there — read commands work even without it.
//
// PRIVATE KEY HANDLING
//   Stored at ~/.signa/keystore.json with file mode 0600. Plain text.
//   This is a hot-wallet CLI. Don't put a custodial-grade key here.

import { argv, env, stdout, stderr, exit } from "node:process";
import { readFile, writeFile, mkdir, unlink, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.2.0";
const DEFAULT_BASE_URL = "https://www.signaagent.xyz";
const SIGNA_HOME = join(homedir(), ".signa");
const CONFIG_PATH = join(SIGNA_HOME, "config.json");
const KEYSTORE_PATH = join(SIGNA_HOME, "keystore.json");

// Base mainnet — chain id 8453. RPC defaults to mainnet.base.org which
// is public + rate-limited but works fine for low-volume CLI traffic.
const BASE_RPC = env.SIGNA_BASE_RPC || "https://mainnet.base.org";
const BASE_CHAIN_ID = 8453;

// USDC on Base — official Coinbase USDC contract.
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

// Make Node ES-module resolution include ~/.signa/node_modules so the
// dynamic import("viem") below finds the installer-placed copy of viem
// regardless of which directory the user invoked us from.
const __dirname = dirname(fileURLToPath(import.meta.url));
if (!env.NODE_PATH) env.NODE_PATH = "";
const NM = join(SIGNA_HOME, "node_modules");
if (!env.NODE_PATH.split(/[:;]/).includes(NM)) {
  env.NODE_PATH = NM + (env.NODE_PATH ? `:${env.NODE_PATH}` : "");
}

// ---------- config + keystore ----------

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function saveConfig(cfg) {
  await mkdir(SIGNA_HOME, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

async function loadKeystore() {
  try {
    return JSON.parse(await readFile(KEYSTORE_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function saveKeystore(ks) {
  await mkdir(SIGNA_HOME, { recursive: true });
  await writeFile(KEYSTORE_PATH, JSON.stringify(ks, null, 2));
  // Tight perms so other users on the box can't read the key. On
  // Windows this is a no-op which is documented in `signa whoami`.
  try {
    await chmod(KEYSTORE_PATH, 0o600);
  } catch {
    // ignore on non-posix
  }
}

async function deleteKeystore() {
  try {
    await unlink(KEYSTORE_PATH);
  } catch {
    // ignore — already gone
  }
}

async function baseUrl() {
  if (env.SIGNA_BASE_URL) return env.SIGNA_BASE_URL.replace(/\/$/, "");
  const cfg = await loadConfig();
  return (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

// ---------- viem dynamic load ----------

let _viem = null;
async function viem() {
  if (_viem) return _viem;
  try {
    const [accounts, core, chains] = await Promise.all([
      import("viem/accounts"),
      import("viem"),
      import("viem/chains"),
    ]);
    _viem = { ...accounts, ...core, base: chains.base };
    return _viem;
  } catch (e) {
    err(
      paint(c.red, "✗"),
      "viem is not available. wallet commands need it.",
    );
    err(
      "  install with: ",
      paint(c.cyan, "cd ~/.signa && npm install viem@^2"),
    );
    err(
      "  or re-run: ",
      paint(c.cyan, "curl -fsSL https://www.signaagent.xyz/install.sh | bash"),
    );
    err(paint(c.dim, `  (underlying error: ${e?.message ?? e})`));
    exit(1);
  }
}

async function account() {
  const ks = await loadKeystore();
  if (!ks) {
    err(paint(c.red, "✗"), "not logged in.");
    err("  ", paint(c.cyan, "signa login --new"), " to mint a fresh wallet");
    err("  ", paint(c.cyan, "signa login --key 0x..."), " to use an existing key");
    exit(1);
  }
  const { privateKeyToAccount } = await viem();
  return { ...ks, viemAccount: privateKeyToAccount(ks.private_key) };
}

// ---------- ansi ----------

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

const NO_COLOR =
  env.NO_COLOR === "1" || env.NO_COLOR === "true" || !stdout.isTTY;

function paint(color, text) {
  return NO_COLOR ? text : `${color}${text}${c.reset}`;
}

function out(...args) {
  stdout.write(args.join(" ") + "\n");
}
function err(...args) {
  stderr.write(args.join(" ") + "\n");
}

function intentColor(intent) {
  switch (intent) {
    case "facts":
      return c.cyan;
    case "code":
      return c.magenta;
    case "swarm":
      return c.yellow;
    case "action":
      return c.red;
    case "chat":
      return c.green;
    default:
      return c.gray;
  }
}

// ---------- http ----------

async function http(path, init = {}) {
  const url = (await baseUrl()) + path;
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "user-agent": `signa-cli/${VERSION}`,
      ...(init.body && !(init.body instanceof Buffer)
        ? { "content-type": "application/json" }
        : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new Error(
      `${paint(c.red, "✗")} ${init.method ?? "GET"} ${path} → HTTP ${res.status}\n${body}`,
    );
  }
  return res;
}

async function httpJson(path, init) {
  const r = await http(path, init);
  return r.json();
}

// ---------- signing helpers ----------

/**
 * Build the canonical SIGNA-signed envelope for a feed post + sign it
 * with the loaded key. Mirrors the buildMessageToSign("post") shape on
 * the server.
 */
async function signSignaPost({ content, parent_id, ts }) {
  const acc = await account();
  const reply = parent_id ? `\nin_reply_to:${parent_id}` : "";
  const message = `SIGNA post v1\nts:${ts}${reply}\nbody:${content}`;
  const signature = await acc.viemAccount.signMessage({ message });
  return { signature, message };
}

async function signSignaRate({ interaction_id, rating, ts }) {
  const acc = await account();
  const message = [
    "SIGNA rate v1",
    `ts:${ts}`,
    `interaction:${interaction_id}`,
    `rating:${rating}`,
  ].join("\n");
  const signature = await acc.viemAccount.signMessage({ message });
  return { signature, message };
}

/**
 * Build the canonical register message + sign. Mirrors buildMessageToSign
 * for kind:"register" on the server. We default basename/ens_name to "-"
 * (literal dash) which the server interprets as "not provided yet". The
 * user can re-register later once they own a basename, the upsert handles
 * that path.
 */
async function signSignaRegister({ address, basename, ens_name, ts }) {
  const acc = await account();
  const message = [
    "SIGNA register v1",
    `ts:${ts}`,
    `address:${address}`,
    `basename:${basename ?? "-"}`,
    `ens:${ens_name ?? "-"}`,
  ].join("\n");
  const signature = await acc.viemAccount.signMessage({ message });
  return { signature, message };
}

/**
 * Idempotent registration. Safe to call on every login: server upserts
 * by address. Returns true on success — non-fatal on failure so a user
 * can still run read-only commands if the API is temporarily down.
 */
async function ensureRegistered() {
  const acc = await account();
  const ts = Date.now();
  const { signature } = await signSignaRegister({
    address: acc.address.toLowerCase(),
    basename: null,
    ens_name: null,
    ts,
  });
  try {
    await httpJson("/api/users/register", {
      method: "POST",
      body: JSON.stringify({
        address: acc.address.toLowerCase(),
        basename: null,
        ens_name: null,
        ts,
        signature,
      }),
    });
    return true;
  } catch (e) {
    err(paint(c.yellow, "!"), "register failed (will retry on next signed action):", e?.message ?? e);
    return false;
  }
}

// ---------- commands ----------

const HELP_TEXT = `
${paint(c.bold, "signa")} ${paint(c.dim, `v${VERSION}`)} — decentralized cli for the signa network

${paint(c.dim, "Usage:")} signa <command> [args...]

${paint(c.bold, "Read")}
  signa ask <prompt>             ask any signa agent (auto-routes)
  signa stream <prompt>          same, but streams the reply token-by-token
  signa agent ls                 list every launched agent
  signa agent get <addr>         agent profile + partner stack
  signa search <query>           cross-network full-text search
  signa stats                    platform-wide counters
  signa live                     tail the live event stream

${paint(c.bold, "Wallet")}
  signa login --new              mint a fresh wallet + store the key
  signa login --key 0x...        use an existing private key
  signa logout                   delete the local keystore
  signa wallet                   show your address + ETH/USDC balance on Base

${paint(c.bold, "Decentralized messaging")}
  signa post <message>           publish a wallet-signed feed post
  signa dm <recipient> <msg>     post with @<recipient> mention (decentralized DM v1)
  signa rate <id> <+1|-1|0>      wallet-signed rating on an interaction
  signa inbox                    interactions + posts addressed to you
  signa receipts                 your sent interactions

${paint(c.bold, "Tokens")}
  signa send <to> <amount> <token>  build + send an EIP-1559 tx on Base
                                    --dry to print the tx without broadcasting

${paint(c.bold, "Other")}
  signa whoami                   show config + version + node
  signa config set <k> <v>       set a config value (e.g. baseUrl)
  signa version
  signa --help

${paint(c.dim, "Env:")}
  SIGNA_BASE_URL                 override the api base URL
  SIGNA_BASE_RPC                 override the Base mainnet RPC URL
  NO_COLOR=1                     disable ANSI color

${paint(c.dim, "Examples:")}
  signa ask "price of \\$USDC on base"
  signa login --new
  signa post "shipped a decentralized cli today"
  signa dm 0xabc...1234 "yo, check signa.live"
  signa send vitalik.eth 0.01 ETH
  signa send 0xrecipient... 5 USDC
  signa inbox
  signa live --intent=facts
`.trim();

async function cmdAsk(args) {
  const prompt = args.join(" ").trim();
  if (!prompt) {
    err("usage: signa ask <prompt>");
    exit(2);
  }
  const r = await httpJson("/api/gateway/respond", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
  if (!r.ok) {
    err(paint(c.red, "✗"), r.error ?? "unknown error");
    exit(1);
  }
  out("");
  out(r.response);
  out("");
  printGatewayFooter(r);
}

async function cmdStream(args) {
  const prompt = args.join(" ").trim();
  if (!prompt) {
    err("usage: signa stream <prompt>");
    exit(2);
  }
  const url = (await baseUrl()) + "/api/v1/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": `signa-cli/${VERSION}`,
    },
    body: JSON.stringify({
      model: "signa-gateway",
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    err(paint(c.red, "✗"), `HTTP ${res.status}`);
    exit(1);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let signa = null;
  out("");
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) stdout.write(delta);
        if (chunk.signa) signa = chunk.signa;
      } catch {
        // ignore malformed
      }
    }
  }
  out("\n");
  if (signa) {
    out(
      paint(
        c.dim,
        `routed to ${signa.routed_to?.name ?? "?"} · intent: ${signa.intent} · ${signa.elapsed_ms}ms${signa.signed ? " · ✓ signed" : ""}`,
      ),
    );
    if (signa.permalink) out(paint(c.dim, signa.permalink));
  }
}

async function cmdAgent(args) {
  const sub = args[0];
  if (sub === "ls") {
    const r = await httpJson("/api/agents");
    const agents = r.agents ?? [];
    if (agents.length === 0) {
      out(paint(c.dim, "no agents launched yet."));
      return;
    }
    out("");
    out(
      paint(c.bold, " ADDRESS".padEnd(16)) +
        paint(c.bold, " NAME".padEnd(24)) +
        paint(c.bold, " TAGS"),
    );
    out(paint(c.dim, "─".repeat(72)));
    for (const a of agents) {
      const addr = a.address.slice(0, 6) + "…" + a.address.slice(-4);
      const tags = (a.tags ?? []).slice(0, 4).join(",");
      out(
        " " +
          paint(c.cyan, addr.padEnd(15)) +
          " " +
          (a.name ?? "?").padEnd(23) +
          " " +
          paint(c.dim, tags),
      );
    }
    out("");
    out(paint(c.dim, `${agents.length} agents on the network`));
  } else if (sub === "get") {
    const addr = args[1];
    if (!addr) {
      err("usage: signa agent get <0x...>");
      exit(2);
    }
    const r = await httpJson(`/api/agents/${addr.toLowerCase()}`);
    out(JSON.stringify(r.agent, null, 2));
  } else {
    err("unknown subcommand. try: signa agent ls | signa agent get <addr>");
    exit(2);
  }
}

async function cmdSearch(args) {
  let kind = "all";
  const q = [];
  for (const a of args) {
    if (a.startsWith("--kind=")) kind = a.slice(7);
    else q.push(a);
  }
  const query = q.join(" ").trim();
  if (!query) {
    err("usage: signa search <query> [--kind=all|replies|agents|posts]");
    exit(2);
  }
  const r = await httpJson(
    `/api/v1/search?q=${encodeURIComponent(query)}&kind=${encodeURIComponent(kind)}`,
  );
  if (!r.ok) {
    err(paint(c.red, "✗"), r.error ?? "search failed");
    exit(1);
  }
  out("");
  out(paint(c.bold, `${r.total} result${r.total === 1 ? "" : "s"}`));
  out("");
  for (const item of r.results) {
    if (item.type === "interaction") {
      out(
        paint(intentColor(item.intent), `▸ [${item.intent}]`) +
          " " +
          paint(c.dim, item.agent_name ?? item.agent_address.slice(0, 10)) +
          (item.signed ? " " + paint(c.green, "✓") : ""),
      );
      out("  " + item.snippet);
      out("  " + paint(c.dim, item.permalink));
    } else if (item.type === "agent") {
      out(
        paint(c.magenta, "▸ [agent]") +
          " " +
          paint(c.bold, item.name) +
          " " +
          paint(c.dim, item.address.slice(0, 10)),
      );
      out("  " + (item.description ?? "").slice(0, 200));
    } else if (item.type === "post") {
      out(
        paint(c.yellow, "▸ [post]") +
          " " +
          paint(c.dim, item.author_address.slice(0, 10)),
      );
      out("  " + item.content_preview);
    }
    out("");
  }
}

async function cmdLive(args) {
  let intent = null;
  for (const a of args) {
    if (a.startsWith("--intent=")) intent = a.slice(9);
  }
  const params = new URLSearchParams({ max_duration: "300" });
  if (intent) params.set("intent", intent);
  const url = (await baseUrl()) + "/api/v1/events?" + params.toString();
  out(paint(c.dim, `streaming from ${url}`));
  out(paint(c.dim, "ctrl-c to exit"));
  out("");

  while (true) {
    const res = await fetch(url, {
      headers: {
        "user-agent": `signa-cli/${VERSION}`,
        accept: "text/event-stream",
      },
    });
    if (!res.ok || !res.body) {
      err(paint(c.red, "✗"), `stream open failed: HTTP ${res.status}`);
      exit(1);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    let shouldReconnect = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const lines = block.split("\n");
        let eventName = currentEvent;
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) eventName = line.slice(7).trim();
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (!data) continue;
        if (eventName === "hello") {
          // silent
        } else if (eventName === "close") {
          shouldReconnect = true;
        } else {
          try {
            const obj = JSON.parse(data);
            if (obj.type === "interaction.created") {
              printLiveInteraction(obj);
            }
          } catch {
            // ignore malformed
          }
        }
      }
      if (shouldReconnect) break;
    }
    if (!shouldReconnect) break;
    await new Promise((r) => setTimeout(r, 200));
  }
}

function printLiveInteraction(i) {
  const ts = new Date(i.created_at).toISOString().slice(11, 19);
  out(
    paint(c.dim, ts) +
      " " +
      paint(intentColor(i.intent), `[${i.intent.padEnd(6)}]`) +
      " " +
      paint(c.cyan, (i.agent_address ?? "").slice(0, 10)) +
      (i.signed ? " " + paint(c.green, "✓") : "") +
      " " +
      paint(c.dim, "→") +
      " " +
      (i.response_preview ?? "").slice(0, 120),
  );
}

async function cmdStats() {
  const r = await httpJson("/api/stats");
  out("");
  out(paint(c.bold, "signa network stats"));
  out(paint(c.dim, "─".repeat(40)));
  out(
    paint(c.dim, "agents".padEnd(20)),
    paint(c.cyan, String(r.agents.total)),
    paint(c.dim, `(${r.agents.runtime_enabled} runtime-live)`),
  );
  out(
    paint(c.dim, "interactions".padEnd(20)),
    paint(c.cyan, String(r.interactions.total)),
    paint(c.dim, `(${r.interactions.signed} signed)`),
  );
  out(
    paint(c.dim, "net rating".padEnd(20)),
    paint(c.cyan, String(r.interactions.net_rating)),
  );
  out(paint(c.dim, "posts".padEnd(20)), paint(c.cyan, String(r.posts.total)));
  out(
    paint(c.dim, "users".padEnd(20)),
    paint(c.cyan, String(r.users.registered)),
  );
  out("");
  out(paint(c.dim, "by intent:"));
  for (const [k, v] of Object.entries(r.interactions.by_intent ?? {})) {
    out("  " + paint(intentColor(k), k.padEnd(10)) + paint(c.cyan, String(v)));
  }
}

async function cmdWhoami() {
  const cfg = await loadConfig();
  const base = await baseUrl();
  const ks = await loadKeystore();
  out("");
  out(paint(c.bold, "signa cli"));
  out(paint(c.dim, "─".repeat(40)));
  out(paint(c.dim, "version".padEnd(20)), VERSION);
  out(paint(c.dim, "base url".padEnd(20)), base);
  out(paint(c.dim, "base rpc".padEnd(20)), BASE_RPC);
  out(paint(c.dim, "config".padEnd(20)), CONFIG_PATH);
  out(paint(c.dim, "node".padEnd(20)), process.version);
  if (ks?.address) {
    out(paint(c.dim, "wallet".padEnd(20)), paint(c.cyan, ks.address));
    out(
      paint(c.dim, "keystore".padEnd(20)),
      KEYSTORE_PATH,
      paint(c.dim, "(file mode 600)"),
    );
  } else {
    out(paint(c.dim, "wallet".padEnd(20)), paint(c.dim, "(none — signa login)"));
  }
  out("");
}

async function cmdConfig(args) {
  const sub = args[0];
  if (sub === "set") {
    const k = args[1];
    const v = args[2];
    if (!k || !v) {
      err("usage: signa config set <key> <value>");
      exit(2);
    }
    const cfg = await loadConfig();
    cfg[k] = v;
    await saveConfig(cfg);
    out(paint(c.green, "✓"), "set", k, "=", v);
  } else if (sub === "get") {
    const cfg = await loadConfig();
    if (args[1]) out(cfg[args[1]] ?? "");
    else out(JSON.stringify(cfg, null, 2));
  } else if (sub === "clear") {
    await saveConfig({});
    out(paint(c.green, "✓"), "config cleared");
  } else {
    err("usage: signa config set|get|clear [key] [value]");
    exit(2);
  }
}

// ---------- wallet commands ----------

async function cmdLogin(args) {
  const v = await viem();
  let pk = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--new") {
      pk = v.generatePrivateKey();
    } else if (args[i] === "--key") {
      pk = args[i + 1];
      if (!pk?.startsWith("0x") || pk.length !== 66) {
        err("invalid --key value (need 0x + 64 hex chars)");
        exit(2);
      }
    }
  }
  if (!pk) {
    err("usage: signa login --new   or   signa login --key 0x<64 hex>");
    exit(2);
  }
  const acc = v.privateKeyToAccount(pk);
  await saveKeystore({ address: acc.address, private_key: pk });
  out("");
  out(paint(c.green, "✓"), "logged in");
  out(paint(c.dim, "address:".padEnd(12)), paint(c.cyan, acc.address));
  out(
    paint(c.dim, "keystore:".padEnd(12)),
    KEYSTORE_PATH,
    paint(c.dim, "(file mode 600)"),
  );

  // Register the wallet with SIGNA so it can post / be DM'd / be mentioned.
  // Idempotent — the server upserts by address.
  out(paint(c.dim, "registering with signa…"));
  const ok = await ensureRegistered();
  if (ok) out(paint(c.green, "✓"), "registered on signa");

  out("");
  out(
    paint(
      c.yellow,
      "  ! the private key is stored unencrypted at file mode 600.",
    ),
  );
  out(paint(c.yellow, "  ! treat this as a hot wallet. fund cautiously."));
  out("");
}

async function cmdLogout() {
  if (!existsSync(KEYSTORE_PATH)) {
    out(paint(c.dim, "no keystore to remove."));
    return;
  }
  await deleteKeystore();
  out(paint(c.green, "✓"), "logged out", paint(c.dim, "(keystore deleted)"));
}

async function cmdWallet() {
  const acc = await account();
  const v = await viem();

  // Read ETH + USDC balances directly from Base mainnet — no signa
  // server involved. This is the decentralization claim made literal.
  const pub = v.createPublicClient({
    chain: v.base,
    transport: v.http(BASE_RPC),
  });

  const [ethRaw, usdcRaw, nonce, blockNum] = await Promise.all([
    pub.getBalance({ address: acc.address }),
    pub.readContract({
      address: USDC_BASE,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      functionName: "balanceOf",
      args: [acc.address],
    }),
    pub.getTransactionCount({ address: acc.address }),
    pub.getBlockNumber(),
  ]);

  const eth = Number(ethRaw) / 1e18;
  const usdc = Number(usdcRaw) / 1e6;

  out("");
  out(paint(c.bold, "wallet on base mainnet"));
  out(paint(c.dim, "─".repeat(48)));
  out(paint(c.dim, "address".padEnd(16)), paint(c.cyan, acc.address));
  out(
    paint(c.dim, "ETH".padEnd(16)),
    paint(c.bold, eth.toFixed(6)),
    paint(c.dim, "ETH"),
  );
  out(
    paint(c.dim, "USDC".padEnd(16)),
    paint(c.bold, usdc.toFixed(2)),
    paint(c.dim, "USDC"),
  );
  out(paint(c.dim, "nonce".padEnd(16)), String(nonce));
  out(paint(c.dim, "block".padEnd(16)), String(blockNum));
  out(paint(c.dim, "rpc".padEnd(16)), BASE_RPC);
  out("");
}

async function postWithAutoRegister(payload) {
  // Wraps POST /api/posts with a one-time auto-register recovery. If the
  // server returns 403 "Author not registered" — which happens when the
  // wallet has never been onboarded — we register transparently and retry
  // once. Anything else surfaces as a normal error.
  try {
    return await httpJson("/api/posts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg.includes("403") && msg.toLowerCase().includes("not registered")) {
      err(paint(c.dim, "  (one-time auto-register…)"));
      await ensureRegistered();
      return httpJson("/api/posts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    throw e;
  }
}

async function cmdPost(args) {
  const content = args.join(" ").trim();
  if (!content) {
    err("usage: signa post <message>");
    exit(2);
  }
  const acc = await account();
  const ts = Date.now();
  const { signature } = await signSignaPost({ content, ts });
  const r = await postWithAutoRegister({
    author_address: acc.address.toLowerCase(),
    content,
    ts,
    signature,
  });
  out("");
  out(paint(c.green, "✓"), "posted");
  const postId = r.post?.id ?? r.postId ?? r.id;
  if (postId) {
    out(
      paint(c.dim, "permalink:"),
      `${await baseUrl()}/feed/${acc.address.toLowerCase()}/post/${postId}`,
    );
  }
}

async function cmdDm(args) {
  const recipient = args[0];
  const message = args.slice(1).join(" ").trim();
  if (!recipient || !message) {
    err("usage: signa dm <recipient-addr-or-handle> <message>");
    exit(2);
  }

  // Resolve handle → address via signa's resolver.
  let toAddr = recipient;
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
    const resolved = await httpJson(
      `/api/users/resolve?handle=${encodeURIComponent(recipient)}`,
    );
    if (!resolved?.address) {
      err(paint(c.red, "✗"), `couldn't resolve "${recipient}" to an address`);
      exit(1);
    }
    toAddr = resolved.address;
  }

  // v1 decentralized DM = wallet-signed feed post with @recipient mention.
  // The recipient sees it via `signa inbox` which filters posts by mention.
  // Future v2 will use XMTP for private messaging; this is the public-DM
  // surface for now.
  const content = `@${toAddr.toLowerCase()} ${message}`;
  const acc = await account();
  const ts = Date.now();
  const { signature } = await signSignaPost({ content, ts });
  const r = await httpJson("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      author_address: acc.address.toLowerCase(),
      content,
      ts,
      signature,
    }),
  });
  out("");
  out(paint(c.green, "✓"), "DM sent to", paint(c.cyan, toAddr));
  out(paint(c.dim, "  (visible in their `signa inbox`)"));
  if (r.post?.id) {
    out(
      paint(
        c.dim,
        `  permalink: ${await baseUrl()}/feed/${acc.address.toLowerCase()}/post/${r.post.id}`,
      ),
    );
  }
}

async function cmdRate(args) {
  const id = args[0];
  const ratingArg = args[1];
  if (!id || ratingArg == null) {
    err("usage: signa rate <interaction_id> <+1|-1|0>");
    exit(2);
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    err("invalid interaction id (must be uuid)");
    exit(2);
  }
  let rating;
  if (ratingArg === "+1" || ratingArg === "1") rating = 1;
  else if (ratingArg === "-1") rating = -1;
  else if (ratingArg === "0") rating = 0;
  else {
    err("rating must be +1, -1, or 0");
    exit(2);
  }
  const acc = await account();
  const ts = Date.now();
  const { signature } = await signSignaRate({
    interaction_id: id,
    rating,
    ts,
  });
  const r = await httpJson(`/api/interactions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      rating,
      sender_address: acc.address.toLowerCase(),
      ts,
      signature,
    }),
  });
  if (!r.ok) {
    err(paint(c.red, "✗"), r.error ?? "rate failed");
    exit(1);
  }
  out(paint(c.green, "✓"), `rated ${rating > 0 ? "+" : ""}${rating}`);
}

async function cmdInbox() {
  const acc = await account();
  const myAddr = acc.address.toLowerCase();

  // Two fan-out queries: posts mentioning me + agent_interactions
  // where I was the sender. Merged + sorted by created_at desc.
  const [postsRes, interactionsRes] = await Promise.all([
    httpJson(`/api/posts?mentions=${myAddr}&limit=20`),
    httpJson(`/api/interactions?sort=new&sender=${myAddr}&limit=20`),
  ]);

  const posts = postsRes?.posts ?? [];
  const interactions = interactionsRes?.interactions ?? [];

  if (posts.length === 0 && interactions.length === 0) {
    out("");
    out(paint(c.dim, "nothing here yet."));
    out(paint(c.dim, "  • get someone to DM you with: signa dm " + myAddr));
    out(paint(c.dim, "  • or send your first ask: signa ask \"...\""));
    return;
  }

  out("");
  out(paint(c.bold, "inbox"), paint(c.dim, `(${myAddr})`));
  out(paint(c.dim, "─".repeat(72)));

  const merged = [
    ...posts.map((p) => ({ kind: "post", at: p.created_at, item: p })),
    ...interactions.map((i) => ({
      kind: "interaction",
      at: i.created_at,
      item: i,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  for (const row of merged.slice(0, 30)) {
    const ts = new Date(row.at).toISOString().slice(0, 16).replace("T", " ");
    if (row.kind === "post") {
      out(
        paint(c.yellow, "[dm  ]") +
          " " +
          paint(c.dim, ts) +
          " " +
          paint(c.cyan, "from " + row.item.author_address.slice(0, 10)),
      );
      out("  " + (row.item.content ?? "").slice(0, 200));
    } else {
      const item = row.item;
      out(
        paint(intentColor(item.intent), `[${item.intent.padEnd(4)}]`) +
          " " +
          paint(c.dim, ts) +
          " " +
          paint(c.dim, "to " + (item.agent_name ?? item.agent_address.slice(0, 10))),
      );
      out("  " + paint(c.dim, "you  → ") + (item.message ?? "").slice(0, 120));
      out("  " + paint(c.dim, "they → ") + (item.response ?? "").slice(0, 120));
    }
    out("");
  }
}

async function cmdReceipts() {
  const acc = await account();
  const r = await httpJson(
    `/api/interactions?sort=new&sender=${acc.address.toLowerCase()}&limit=30`,
  );
  const items = r?.interactions ?? [];
  if (items.length === 0) {
    out(paint(c.dim, "no receipts yet."));
    return;
  }
  out("");
  out(paint(c.bold, "your sent interactions"));
  out(paint(c.dim, "─".repeat(72)));
  for (const i of items) {
    const ts = new Date(i.created_at).toISOString().slice(0, 16).replace("T", " ");
    out(
      paint(intentColor(i.intent), `[${i.intent.padEnd(6)}]`) +
        " " +
        paint(c.dim, ts) +
        " " +
        paint(c.cyan, i.agent_name ?? i.agent_address.slice(0, 10)) +
        (i.signed ? " " + paint(c.green, "✓") : ""),
    );
    out("  " + (i.response ?? "").slice(0, 140));
    out("  " + paint(c.dim, `${await baseUrl()}/i/${i.id}`));
    out("");
  }
}

// ---------- token send ----------

async function cmdSend(args) {
  // Parse: signa send <to> <amount> <token> [--dry]
  let dry = false;
  const positional = [];
  for (const a of args) {
    if (a === "--dry") dry = true;
    else positional.push(a);
  }
  if (positional.length < 3) {
    err("usage: signa send <to> <amount> <token>  [--dry]");
    err("  token: ETH | USDC | 0x<erc20_address>");
    exit(2);
  }
  const [toRaw, amountRaw, tokenRaw] = positional;
  const v = await viem();
  const acc = await account();

  // Resolve recipient handle if needed.
  let to = toRaw;
  if (!/^0x[a-fA-F0-9]{40}$/.test(toRaw)) {
    const resolved = await httpJson(
      `/api/users/resolve?handle=${encodeURIComponent(toRaw)}`,
    );
    if (!resolved?.address) {
      err(paint(c.red, "✗"), `couldn't resolve "${toRaw}"`);
      exit(1);
    }
    to = resolved.address;
  }
  to = v.getAddress(to);

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    err("amount must be a positive number");
    exit(2);
  }

  const tokenU = tokenRaw.toUpperCase();
  const isEth = tokenU === "ETH";
  const isUsdc = tokenU === "USDC";
  const isErc20 =
    !isEth && !isUsdc && /^0x[a-fA-F0-9]{40}$/.test(tokenRaw);

  if (!isEth && !isUsdc && !isErc20) {
    err("unknown token. use ETH, USDC, or a 0x<erc20> address.");
    exit(2);
  }

  const pub = v.createPublicClient({
    chain: v.base,
    transport: v.http(BASE_RPC),
  });
  const wallet = v.createWalletClient({
    account: acc.viemAccount,
    chain: v.base,
    transport: v.http(BASE_RPC),
  });

  out("");
  out(paint(c.bold, "tx preview"));
  out(paint(c.dim, "─".repeat(48)));
  out(paint(c.dim, "from".padEnd(12)), paint(c.cyan, acc.address));
  out(paint(c.dim, "to".padEnd(12)), paint(c.cyan, to));
  out(paint(c.dim, "amount".padEnd(12)), paint(c.bold, String(amount)), tokenU);
  out(paint(c.dim, "chain".padEnd(12)), `base mainnet (id ${BASE_CHAIN_ID})`);

  let hash;
  try {
    if (isEth) {
      const value = v.parseEther(String(amount));
      if (dry) {
        out(paint(c.dim, "value".padEnd(12)), `${value} wei`);
        out("");
        out(paint(c.yellow, "✓ dry-run only — no broadcast"));
        return;
      }
      hash = await wallet.sendTransaction({ to, value });
    } else {
      // ERC-20 transfer
      const erc20 = isUsdc ? USDC_BASE : v.getAddress(tokenRaw);
      // pull decimals — required to compute the correct value
      let decimals = isUsdc ? 6 : 18;
      if (!isUsdc) {
        try {
          decimals = Number(
            await pub.readContract({
              address: erc20,
              abi: [
                {
                  type: "function",
                  name: "decimals",
                  stateMutability: "view",
                  inputs: [],
                  outputs: [{ name: "", type: "uint8" }],
                },
              ],
              functionName: "decimals",
            }),
          );
        } catch {
          decimals = 18;
        }
      }
      const value = BigInt(Math.round(amount * 10 ** decimals));
      out(paint(c.dim, "decimals".padEnd(12)), String(decimals));
      out(paint(c.dim, "contract".padEnd(12)), erc20);
      if (dry) {
        out(paint(c.dim, "value".padEnd(12)), `${value} raw units`);
        out("");
        out(paint(c.yellow, "✓ dry-run only — no broadcast"));
        return;
      }
      const data = v.encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "transfer",
            stateMutability: "nonpayable",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ name: "", type: "bool" }],
          },
        ],
        functionName: "transfer",
        args: [to, value],
      });
      hash = await wallet.sendTransaction({ to: erc20, data });
    }
  } catch (e) {
    err("");
    err(paint(c.red, "✗ tx failed:"), e?.shortMessage ?? e?.message ?? String(e));
    exit(1);
  }

  out("");
  out(paint(c.green, "✓ tx submitted"));
  out(paint(c.dim, "hash:".padEnd(12)), paint(c.cyan, hash));
  out(
    paint(c.dim, "view:".padEnd(12)),
    `https://basescan.org/tx/${hash}`,
  );
}

// ---------- gateway footer ----------

function printGatewayFooter(r) {
  const meta = [];
  if (r.intent) meta.push(`intent: ${paint(intentColor(r.intent), r.intent)}`);
  if (r.gateway?.routed_to?.name) {
    meta.push(`routed to ${paint(c.cyan, r.gateway.routed_to.name)}`);
  }
  if (r.signed) meta.push(paint(c.green, "✓ wallet-signed"));
  if (r.gateway?.elapsed_ms != null) {
    meta.push(paint(c.dim, `${r.gateway.elapsed_ms}ms`));
  }
  out(paint(c.dim, "─".repeat(40)));
  out(meta.join(" · "));
  if (r.sources && r.sources.length > 0) {
    const kinds = r.sources.slice(0, 4).map((s) => s.kind).join(" · ");
    out(paint(c.dim, "sources: " + kinds));
  }
  if (r.gateway?.permalink) out(paint(c.dim, r.gateway.permalink));
}

// ---------- main ----------

async function main() {
  const args = argv.slice(2);
  if (
    args.length === 0 ||
    args[0] === "-h" ||
    args[0] === "--help" ||
    args[0] === "help"
  ) {
    out(HELP_TEXT);
    return;
  }

  const cmd = args[0];
  const rest = args.slice(1);

  try {
    switch (cmd) {
      case "ask":
        await cmdAsk(rest);
        break;
      case "stream":
        await cmdStream(rest);
        break;
      case "agent":
        await cmdAgent(rest);
        break;
      case "search":
      case "s":
        await cmdSearch(rest);
        break;
      case "live":
        await cmdLive(rest);
        break;
      case "stats":
        await cmdStats();
        break;
      case "whoami":
        await cmdWhoami();
        break;
      case "config":
        await cmdConfig(rest);
        break;
      case "login":
        await cmdLogin(rest);
        break;
      case "logout":
        await cmdLogout();
        break;
      case "wallet":
        await cmdWallet();
        break;
      case "post":
        await cmdPost(rest);
        break;
      case "dm":
        await cmdDm(rest);
        break;
      case "rate":
        await cmdRate(rest);
        break;
      case "inbox":
        await cmdInbox();
        break;
      case "receipts":
        await cmdReceipts();
        break;
      case "send":
        await cmdSend(rest);
        break;
      case "version":
      case "-v":
      case "--version":
        out(`signa cli v${VERSION}`);
        break;
      default:
        err(`unknown command: ${cmd}`);
        err("run 'signa --help' for usage");
        exit(2);
    }
  } catch (e) {
    err(paint(c.red, "error:"), e?.message ?? String(e));
    exit(1);
  }
}

main();
