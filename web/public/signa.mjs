#!/usr/bin/env node
// signa — the signa CLI. v0.3.0
//
// Real decentralized wallet client. A full terminal product for the
// signa network — wallet-native messaging on Base mainnet.
//
// Two ways to use it:
//   1. One-shot:    signa <command> [args]       e.g.  signa ask "hi"
//   2. Interactive: signa                        opens the REPL,
//                                                drops you into a prompt
//                                                where every command works
//                                                without the `signa` prefix
//
// Capabilities:
//   • read-only    ask, stream, agent, search, live, stats, feed, profile
//   • wallet       login, logout, wallet, whoami
//   • messaging    post, dm, reply, like, unlike, rate, inbox, watch,
//                  receipts, thread
//   • tokens       send <to> <amount> <ETH|USDC|0xerc20> [--dry]
//
// PRIVATE KEY HANDLING
//   Stored at ~/.signa/keystore.json with file mode 0600. Plain text.
//   This is a hot-wallet CLI. Don't put a custodial-grade key here.
//   The key never leaves your machine — every signed action builds the
//   envelope locally with viem and submits {message, signature, ts}
//   to the server, which verifies before storing.
//
// Install:
//   curl -fsSL https://www.signaagent.xyz/install.sh   | bash    # mac/linux
//   iwr https://www.signaagent.xyz/install.ps1 -UseBasicParsing | iex   # windows

import { argv, env, stdout, stderr, stdin, exit } from "node:process";
import { readFile, writeFile, mkdir, unlink, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const VERSION = "0.3.0";
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

// ---------- runtime mode flags ----------
//
// IN_REPL — true once startRepl() takes over. When set, bail() throws
//   instead of exiting so a single bad command doesn't kill the whole
//   interactive shell.
//
// LONG_RUNNING — set by commands like `watch` and `live` that own the
//   event loop indefinitely. The REPL's readline SIGINT handler checks
//   this and yields ctrl-c to the command (which installs its own
//   handler) rather than running the REPL's 2-press exit dance.
let IN_REPL = false;
let LONG_RUNNING = false;

class BailError extends Error {
  constructor(code = 1) {
    super(`bail(${code})`);
    this.code = code;
    this.isBail = true;
  }
}

/**
 * Exit-or-throw helper. Use this in every command handler instead of
 * `exit()`. Standalone invocation behaves like a normal CLI (process
 * exits with the given code). REPL invocation throws a BailError that
 * the REPL dispatcher catches + suppresses, so the user gets a fresh
 * prompt instead of a dead shell.
 */
function bail(code = 1) {
  if (IN_REPL) throw new BailError(code);
  exit(code);
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
    bail(1);
  }
}

async function account() {
  const ks = await loadKeystore();
  if (!ks) {
    err(paint(c.red, "✗"), "not logged in.");
    err("  ", paint(c.cyan, "signa login --new"), " to mint a fresh wallet");
    err("  ", paint(c.cyan, "signa login --key 0x..."), " to use an existing key");
    bail(1);
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

${paint(c.dim, "Run with no args to drop into the interactive REPL.")}
${paint(c.dim, "Inside the REPL, omit the leading 'signa'.  e.g. 'ask hi', 'wallet', 'inbox'.")}

${paint(c.dim, "Usage:")} signa <command> [args...]

${paint(c.bold, "Read")}
  ask <prompt>                   ask any signa agent (auto-routes via the gateway)
  stream <prompt>                same, but streams the reply token-by-token
  agent ls | agent get <addr>    list launched agents | full agent profile
  search <query>                 cross-network full-text search
  stats                          platform-wide counters
  live [--intent=facts|...]      tail the live network event stream
  feed [--limit=N]               global signa feed (top-level wallet-signed posts)
  thread <post_id>               a post + every reply, threaded
  profile <addr|name>            wallet profile · basename · ens · holdings

${paint(c.bold, "Wallet")}
  login --new                    mint a fresh wallet + store the key
  login --key 0x...              use an existing private key
  logout                         delete the local keystore
  wallet                         show your address + ETH/USDC balance on Base
  whoami                         config + version + node + wallet status

${paint(c.bold, "Decentralized messaging")}
  post <message>                 publish a wallet-signed feed post
  dm <recipient> <msg>           post with @<recipient> mention (recipient sees it in inbox)
  reply <post_id> <msg>          wallet-signed threaded reply
  like <post_id>                 wallet-signed like
  unlike <post_id>               wallet-signed unlike
  rate <interaction_id> <+1|-1|0>  wallet-signed rating on an agent reply
  inbox                          posts mentioning you + your interactions
  watch                          tail your inbox live (prints new messages as they arrive)
  receipts                       your sent interactions

${paint(c.bold, "Tokens")}
  send <to> <amount> <token>     build + send an EIP-1559 tx on Base mainnet
                                 token: ETH | USDC | 0x<erc20_addr>
                                 --dry  to print the tx without broadcasting

${paint(c.bold, "Other")}
  config set <key> <value>       set a config value (e.g. baseUrl)
  config get [key]               read config
  version | --help               show version | show this help
  exit | quit                    leave the REPL (REPL only)
  clear                          redraw the banner + clear screen (REPL only)

${paint(c.dim, "Env:")}
  SIGNA_BASE_URL                 override the api base URL
  SIGNA_BASE_RPC                 override the Base mainnet RPC URL
  NO_COLOR=1                     disable ANSI color

${paint(c.dim, "Examples:")}
  signa                          # drops you into the REPL
  signa ask "price of \\$USDC on base"
  signa login --new
  signa post "shipped a decentralized cli today"
  signa dm vitalik.eth "gm"
  signa watch                    # live tail of your inbox
  signa send 0xrecipient... 5 USDC --dry
`.trim();

async function cmdAsk(args) {
  const prompt = args.join(" ").trim();
  if (!prompt) {
    err("usage: signa ask <prompt>");
    bail(2);
  }
  const r = await httpJson("/api/gateway/respond", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
  if (!r.ok) {
    err(paint(c.red, "✗"), r.error ?? "unknown error");
    bail(1);
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
    bail(2);
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
    bail(1);
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
      bail(2);
    }
    const r = await httpJson(`/api/agents/${addr.toLowerCase()}`);
    out(JSON.stringify(r.agent, null, 2));
  } else {
    err("unknown subcommand. try: signa agent ls | signa agent get <addr>");
    bail(2);
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
    bail(2);
  }
  const r = await httpJson(
    `/api/v1/search?q=${encodeURIComponent(query)}&kind=${encodeURIComponent(kind)}`,
  );
  if (!r.ok) {
    err(paint(c.red, "✗"), r.error ?? "search failed");
    bail(1);
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

  await runLongRunning(async (stop) => {
    // AbortController lets us terminate an in-flight fetch + its
    // ReadableStream when SIGINT arrives, so the reader.read() promise
    // rejects and the loop exits.
    let controller = null;
    stop.onstop = () => {
      try {
        controller?.abort();
      } catch {
        // ignore
      }
    };
    while (!stop.stopped) {
      controller = new AbortController();
      let res;
      try {
        res = await fetch(url, {
          headers: {
            "user-agent": `signa-cli/${VERSION}`,
            accept: "text/event-stream",
          },
          signal: controller.signal,
        });
      } catch (e) {
        if (stop.stopped) break;
        err(paint(c.red, "✗"), `stream connect failed: ${e?.message ?? e}`);
        break;
      }
      if (!res.ok || !res.body) {
        err(paint(c.red, "✗"), `stream open failed: HTTP ${res.status}`);
        break;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "message";
      let shouldReconnect = false;
      while (!stop.stopped) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch {
          // aborted or upstream error — break inner loop, outer will
          // either reconnect or exit depending on stop.stopped.
          break;
        }
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
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
      if (stop.stopped || !shouldReconnect) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  // If SIGINT raced an in-flight fetch, AbortError can fall through
  // here as a benign rejection. Make stoppage explicit for the user.
  out(paint(c.dim, "live stream stopped."));
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
      bail(2);
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
    bail(2);
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
        bail(2);
      }
    }
  }
  if (!pk) {
    err("usage: signa login --new   or   signa login --key 0x<64 hex>");
    bail(2);
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
    bail(2);
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
    bail(2);
  }

  // Resolve handle → address via signa's resolver.
  let toAddr = recipient;
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
    const resolved = await httpJson(
      `/api/users/resolve?handle=${encodeURIComponent(recipient)}`,
    );
    if (!resolved?.address) {
      err(paint(c.red, "✗"), `couldn't resolve "${recipient}" to an address`);
      bail(1);
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
    bail(2);
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    err("invalid interaction id (must be uuid)");
    bail(2);
  }
  let rating;
  if (ratingArg === "+1" || ratingArg === "1") rating = 1;
  else if (ratingArg === "-1") rating = -1;
  else if (ratingArg === "0") rating = 0;
  else {
    err("rating must be +1, -1, or 0");
    bail(2);
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
    bail(1);
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
    bail(2);
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
      bail(1);
    }
    to = resolved.address;
  }
  to = v.getAddress(to);

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    err("amount must be a positive number");
    bail(2);
  }

  const tokenU = tokenRaw.toUpperCase();
  const isEth = tokenU === "ETH";
  const isUsdc = tokenU === "USDC";
  const isErc20 =
    !isEth && !isUsdc && /^0x[a-fA-F0-9]{40}$/.test(tokenRaw);

  if (!isEth && !isUsdc && !isErc20) {
    err("unknown token. use ETH, USDC, or a 0x<erc20> address.");
    bail(2);
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
    bail(1);
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

// ---------- new commands: feed, thread, profile, reply, like, watch ----------

async function cmdFeed(args) {
  let limit = 20;
  for (const a of args) {
    if (a.startsWith("--limit=")) limit = Math.min(50, Math.max(1, Number(a.slice(8)) || 20));
  }
  const r = await httpJson(`/api/posts?limit=${limit}`);
  const posts = r?.posts ?? [];
  if (posts.length === 0) {
    out(paint(c.dim, "feed is empty."));
    return;
  }
  out("");
  out(paint(c.bold, "signa feed"), paint(c.dim, `(top-level posts · newest first)`));
  out(paint(c.dim, "─".repeat(72)));
  for (const p of posts) {
    const ts = new Date(p.created_at).toISOString().slice(0, 16).replace("T", " ");
    const who = p.author?.basename || p.author?.ens_name || (p.author_address.slice(0, 6) + "…" + p.author_address.slice(-4));
    const stats = [];
    if (p.like_count > 0) stats.push(`♥ ${p.like_count}`);
    if (p.reply_count > 0) stats.push(`↩ ${p.reply_count}`);
    out(paint(c.dim, ts) + " " + paint(c.cyan, who) + (stats.length ? "  " + paint(c.dim, stats.join("  ")) : ""));
    out("  " + (p.content ?? "").replace(/\n/g, "\n  "));
    out("  " + paint(c.dim, `id:${p.id}`));
    out("");
  }
}

async function cmdThread(args) {
  const id = args[0];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    err("usage: thread <post_id (uuid)>");
    return;
  }
  const [parentRes, repliesRes] = await Promise.all([
    httpJson(`/api/posts/${id}`).catch(() => null),
    httpJson(`/api/posts?parent=${id}&limit=50`),
  ]);
  const parent = parentRes?.post ?? null;
  const replies = repliesRes?.posts ?? [];
  out("");
  if (parent) {
    const who = parent.author?.basename || parent.author?.ens_name || (parent.author_address.slice(0, 6) + "…" + parent.author_address.slice(-4));
    out(paint(c.bold, "post"), paint(c.dim, `by ${who}`));
    out(paint(c.dim, "─".repeat(72)));
    out(parent.content ?? "");
    out(paint(c.dim, `id:${parent.id}`));
    out("");
  } else {
    out(paint(c.yellow, "(parent post not found — showing replies anyway)"));
  }
  if (replies.length === 0) {
    out(paint(c.dim, "no replies yet."));
    out(paint(c.dim, "reply with: reply " + id + " \"...\""));
    return;
  }
  out(paint(c.dim, `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`));
  out(paint(c.dim, "─".repeat(72)));
  for (const r of replies.slice().reverse()) {
    const ts = new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ");
    const who = r.author?.basename || r.author?.ens_name || (r.author_address.slice(0, 6) + "…" + r.author_address.slice(-4));
    out(paint(c.dim, ts) + " " + paint(c.cyan, who));
    out("  " + (r.content ?? "").replace(/\n/g, "\n  "));
    out("");
  }
}

async function cmdProfile(args) {
  const handle = args[0];
  if (!handle) {
    err("usage: profile <address|basename|ens>");
    return;
  }
  const r = await httpJson(`/api/users/resolve?handle=${encodeURIComponent(handle)}`).catch(
    (e) => ({ ok: false, error: e?.message }),
  );
  if (!r?.ok || !r.address) {
    err(paint(c.red, "✗"), `couldn't resolve "${handle}"`);
    return;
  }
  out("");
  out(paint(c.bold, "profile"));
  out(paint(c.dim, "─".repeat(48)));
  out(paint(c.dim, "address".padEnd(14)), paint(c.cyan, r.address));
  if (r.basename) out(paint(c.dim, "basename".padEnd(14)), r.basename);
  if (r.ens_name) out(paint(c.dim, "ens".padEnd(14)), r.ens_name);
  out(paint(c.dim, "on_signa".padEnd(14)), r.on_signa ? paint(c.green, "yes") : paint(c.dim, "no"));
  out(paint(c.dim, "via".padEnd(14)), paint(c.dim, r.source ?? "?"));
  if (r.gitlawb_did) out(paint(c.dim, "gitlawb".padEnd(14)), r.gitlawb_did);
  out("");
  out(paint(c.dim, "  signa dm " + r.address + " \"...\""));
  out(paint(c.dim, "  signa send " + r.address + " 0.001 ETH --dry"));
}

async function cmdReply(args) {
  const parentId = args[0];
  const content = args.slice(1).join(" ").trim();
  if (!parentId || !content) {
    err("usage: reply <post_id> <message>");
    return;
  }
  if (!/^[0-9a-f-]{36}$/i.test(parentId)) {
    err("invalid post_id (must be uuid)");
    return;
  }
  const acc = await account();
  const ts = Date.now();
  const { signature } = await signSignaPost({ content, parent_id: parentId, ts });
  const r = await postWithAutoRegister({
    author_address: acc.address.toLowerCase(),
    content,
    parent_id: parentId,
    ts,
    signature,
  });
  out("");
  out(paint(c.green, "✓"), "reply posted");
  if (r.post?.id) {
    out(paint(c.dim, `  ${await baseUrl()}/feed/${acc.address.toLowerCase()}/post/${r.post.id}`));
  }
}

async function signSignaLike({ action, post_id, ts }) {
  // Mirrors buildMessageToSign for kind:"like" / "unlike" on the server.
  const acc = await account();
  const message = `SIGNA ${action} v1\nts:${ts}\npost:${post_id}`;
  const signature = await acc.viemAccount.signMessage({ message });
  return { signature, message };
}

async function cmdLike(args) {
  return _likeOrUnlike("like", args);
}
async function cmdUnlike(args) {
  return _likeOrUnlike("unlike", args);
}
async function _likeOrUnlike(action, args) {
  const id = args[0];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    err(`usage: ${action} <post_id (uuid)>`);
    return;
  }
  const acc = await account();
  const ts = Date.now();
  const { signature } = await signSignaLike({ action, post_id: id, ts });
  const r = await httpJson("/api/likes", {
    method: "POST",
    body: JSON.stringify({
      action,
      post_id: id,
      address: acc.address.toLowerCase(),
      ts,
      signature,
    }),
  });
  if (!r.ok) {
    err(paint(c.red, "✗"), r.error ?? `${action} failed`);
    return;
  }
  out(paint(c.green, "✓"), action === "like" ? "liked" : "unliked");
}

/**
 * Run `fn(stopSignal)` as a long-running command. Installs a process-level
 * SIGINT handler that flips a local stop flag so the loop can exit
 * cooperatively. Marks LONG_RUNNING so the REPL's readline handler yields
 * ctrl-c to us instead of running its 2-press exit dance.
 *
 * Used by cmdWatch + cmdLive. Always restores prior state in a finally
 * block, so a thrown error inside the long-running fn doesn't leak
 * SIGINT listeners between invocations.
 */
async function runLongRunning(fn) {
  // stopRef is the cooperative-stop contract between runLongRunning and
  // the command body. The body checks stopRef.stopped at each iteration.
  // If it needs to interrupt an in-flight blocking call (e.g. abort a
  // fetch), it assigns stopRef.onstop and we invoke that synchronously
  // from the SIGINT handler.
  const stopRef = { stopped: false, onstop: null };
  const onSigint = () => {
    stopRef.stopped = true;
    try {
      stopRef.onstop?.();
    } catch {
      // ignore; we're shutting down
    }
  };
  const wasLR = LONG_RUNNING;
  LONG_RUNNING = true;
  process.on("SIGINT", onSigint);
  try {
    await fn(stopRef);
  } catch (e) {
    // Abort-induced rejections during shutdown are expected; only
    // re-throw real errors so the REPL can render them.
    if (!stopRef.stopped) throw e;
  } finally {
    process.removeListener("SIGINT", onSigint);
    LONG_RUNNING = wasLR;
  }
}

async function cmdWatch() {
  // Long-poll the inbox endpoints and print anything newer than our cursor.
  // Polls every 4s — gentle enough not to rate-limit public RPC + API while
  // still feeling near-real-time. Ctrl-C exits cooperatively in both
  // standalone and REPL contexts.
  const acc = await account();
  const myAddr = acc.address.toLowerCase();
  out("");
  out(paint(c.bold, "watching inbox"), paint(c.dim, `for ${myAddr}`));
  out(paint(c.dim, "  press ctrl-c to stop"));
  out("");
  // Seed cursor with current latest so we don't dump history.
  let cursor = new Date().toISOString();
  out(paint(c.dim, `[${new Date().toISOString().slice(11, 19)}] connected — waiting for new messages…`));

  await runLongRunning(async (stop) => {
    while (!stop.stopped) {
      // Poll loop split into 8 x 500ms sleeps so ctrl-c lands within
      // half a second worst-case rather than waiting up to 4s.
      for (let i = 0; i < 8 && !stop.stopped; i++) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (stop.stopped) break;
      try {
        const [postsRes, interactionsRes] = await Promise.all([
          httpJson(`/api/posts?mentions=${myAddr}&limit=10`),
          httpJson(`/api/interactions?sort=new&sender=${myAddr}&limit=10`),
        ]);
        const newPosts = (postsRes?.posts ?? []).filter((p) => p.created_at > cursor);
        const newInter = (interactionsRes?.interactions ?? []).filter((i) => i.created_at > cursor);
        const events = [
          ...newPosts.map((p) => ({ kind: "post", at: p.created_at, item: p })),
          ...newInter.map((i) => ({ kind: "interaction", at: i.created_at, item: i })),
        ].sort((a, b) => (a.at < b.at ? -1 : 1));
        for (const ev of events) {
          const ts = new Date(ev.at).toISOString().slice(11, 19);
          if (ev.kind === "post") {
            out(
              paint(c.dim, `[${ts}]`) +
                " " +
                paint(c.yellow, "DM  ") +
                " from " +
                paint(c.cyan, ev.item.author_address.slice(0, 10)),
            );
            out("  " + (ev.item.content ?? "").slice(0, 200));
          } else {
            out(
              paint(c.dim, `[${ts}]`) +
                " " +
                paint(intentColor(ev.item.intent), `${ev.item.intent.toUpperCase().padEnd(4)}`) +
                " from " +
                paint(c.cyan, ev.item.agent_name ?? ev.item.agent_address.slice(0, 10)),
            );
            out("  " + (ev.item.response ?? "").slice(0, 200));
          }
          cursor = ev.at > cursor ? ev.at : cursor;
        }
      } catch (e) {
        err(paint(c.dim, `[${new Date().toISOString().slice(11, 19)}] watch poll failed: ${e?.message ?? e} — retrying`));
      }
    }
  });
  out(paint(c.dim, "watch stopped."));
}

// ---------- banner + REPL ----------

function bannerLines() {
  // ANSI-shadow style "SIGNA" — recognizable big-text. Box-drawing chars
  // render reliably across Windows Terminal, iTerm2, macOS Terminal.app,
  // gnome-terminal, alacritty, kitty. Width = 41 cols.
  return [
    "███████╗██╗ ██████╗ ███╗   ██╗  █████╗ ",
    "██╔════╝██║██╔════╝ ████╗  ██║ ██╔══██╗",
    "███████╗██║██║  ███╗██╔██╗ ██║ ███████║",
    "╚════██║██║██║   ██║██║╚██╗██║ ██╔══██║",
    "███████║██║╚██████╔╝██║ ╚████║ ██║  ██║",
    "╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═╝  ╚═╝",
  ];
}

function rgb(r, g, b, s) {
  if (NO_COLOR) return s;
  return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
}

async function printBanner({ welcome = true } = {}) {
  const BLUE = [91, 141, 239];
  const VIOLET = [139, 92, 246];
  const DIM = [120, 120, 130];
  out("");
  for (const line of bannerLines()) {
    out("  " + rgb(BLUE[0], BLUE[1], BLUE[2], line));
  }
  out("");
  // decentralization motif — a tiny mesh of nodes
  out(
    "  " +
      rgb(VIOLET[0], VIOLET[1], VIOLET[2], "●━━●━━●━━●━━●━━●") +
      "   " +
      rgb(DIM[0], DIM[1], DIM[2], "wallet-native messaging · base mainnet"),
  );
  out(
    "  " +
      rgb(VIOLET[0], VIOLET[1], VIOLET[2], " ╲      ╱      ╲ ") +
      "   " +
      rgb(DIM[0], DIM[1], DIM[2], `signa cli v${VERSION} · 0 api keys · 0 mocks`),
  );
  out(
    "  " +
      rgb(VIOLET[0], VIOLET[1], VIOLET[2], "●━━●━━●━━●━━●━━●") +
      "   " +
      rgb(DIM[0], DIM[1], DIM[2], "partners: aeon · gitlawb · miroshark · bankr"),
  );
  out("");
  if (welcome) {
    const ks = await loadKeystore();
    if (ks?.address) {
      out(
        "  " +
          paint(c.green, "✓") +
          " signed in as " +
          paint(c.cyan, ks.address.slice(0, 6) + "…" + ks.address.slice(-4)) +
          paint(c.dim, " · keystore mode 600"),
      );
    } else {
      out(
        "  " +
          paint(c.dim, "ⓘ") +
          " no wallet · type " +
          paint(c.cyan, "login --new") +
          paint(c.dim, " to mint one"),
      );
    }
    out(
      "  " +
        paint(c.dim, "  type ") +
        paint(c.cyan, "help") +
        paint(c.dim, " for commands · ") +
        paint(c.cyan, "exit") +
        paint(c.dim, " to quit"),
    );
    out("");
  }
}

/**
 * Shell-like tokenizer used by the REPL so users can type
 *   dm vitalik.eth "gm gm with a space"
 * and get ["dm", "vitalik.eth", "gm gm with a space"] — same semantics
 * as the OS shell parsing `signa dm vitalik.eth "gm..."`.
 */
function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i])) i++;
    if (i >= input.length) break;
    const ch = input[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let val = "";
      while (i < input.length && input[i] !== quote) {
        if (input[i] === "\\" && i + 1 < input.length) {
          i++;
          val += input[i++];
        } else {
          val += input[i++];
        }
      }
      i++; // skip closing quote (or end of string)
      tokens.push(val);
    } else {
      let val = "";
      while (i < input.length && !/\s/.test(input[i])) val += input[i++];
      tokens.push(val);
    }
  }
  return tokens;
}

async function startRepl() {
  IN_REPL = true;
  console.clear();
  await printBanner();

  const promptStr = NO_COLOR
    ? "signa > "
    : `\x1b[38;2;91;141;239msigna ›\x1b[0m `;

  const rl = createInterface({
    input: stdin,
    output: stdout,
    prompt: promptStr,
    terminal: true,
    historySize: 200,
  });

  // graceful ctrl-c — first press cancels current line, second press exits.
  // When a long-running command (watch, live) is active, yield: it has its
  // own process-level SIGINT handler that will stop the loop cooperatively.
  // Without this short-circuit, the REPL's 2-press dance fires concurrently
  // with the command's stop, producing a "(ctrl-c again to exit)" hint while
  // watch is actually exiting — confusing UX.
  let ctrlcArmed = false;
  rl.on("SIGINT", () => {
    if (LONG_RUNNING) return; // let the active long-running command handle it
    if (ctrlcArmed) {
      out("");
      out(paint(c.dim, "bye."));
      rl.close();
      exit(0);
    }
    ctrlcArmed = true;
    out("");
    out(paint(c.dim, "  (ctrl-c again to exit · or type 'exit')"));
    rl.prompt();
    setTimeout(() => {
      ctrlcArmed = false;
    }, 1500);
  });

  rl.prompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) {
      rl.prompt();
      continue;
    }
    if (line === "exit" || line === "quit" || line === ":q") {
      out(paint(c.dim, "bye."));
      rl.close();
      return;
    }
    if (line === "clear" || line === "cls") {
      console.clear();
      await printBanner({ welcome: false });
      rl.prompt();
      continue;
    }
    if (line === "help" || line === "?" || line === "--help") {
      out(HELP_TEXT);
      out("");
      rl.prompt();
      continue;
    }

    const tokens = tokenize(line);
    if (tokens.length === 0) {
      rl.prompt();
      continue;
    }

    try {
      await dispatchCommand(tokens, { fromRepl: true });
    } catch (e) {
      // BailError is a controlled "command bailed out" — the handler
      // already printed its own usage / error message via err(). Show
      // nothing extra. Any other thrown error is unexpected — surface it.
      if (!(e && e.isBail)) {
        err(paint(c.red, "error:"), e?.message ?? String(e));
      }
    }
    out("");
    rl.prompt();
  }
}

// ---------- dispatch + main ----------

async function dispatchCommand(args, { fromRepl = false } = {}) {
  const cmd = args[0];
  const rest = args.slice(1);

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
    case "reply":
      await cmdReply(rest);
      break;
    case "like":
      await cmdLike(rest);
      break;
    case "unlike":
      await cmdUnlike(rest);
      break;
    case "rate":
      await cmdRate(rest);
      break;
    case "inbox":
      await cmdInbox();
      break;
    case "watch":
      await cmdWatch();
      break;
    case "receipts":
      await cmdReceipts();
      break;
    case "feed":
      await cmdFeed(rest);
      break;
    case "thread":
      await cmdThread(rest);
      break;
    case "profile":
      await cmdProfile(rest);
      break;
    case "send":
      await cmdSend(rest);
      break;
    case "version":
    case "-v":
    case "--version":
      out(`signa cli v${VERSION}`);
      break;
    case "banner":
      // hidden command — useful for testing the banner without a full boot
      await printBanner({ welcome: false });
      break;
    default:
      err(`unknown command: ${cmd}`);
      err(
        fromRepl
          ? "type 'help' for usage."
          : "run 'signa --help' for usage.",
      );
      if (!fromRepl) exit(2);
  }
}

async function main() {
  const args = argv.slice(2);

  // No args: REPL if TTY, otherwise help text (CI / piped contexts).
  if (args.length === 0) {
    if (stdin.isTTY && stdout.isTTY) {
      await startRepl();
      return;
    }
    out(HELP_TEXT);
    return;
  }

  // Help variants — print banner once, then full help.
  if (args[0] === "-h" || args[0] === "--help" || args[0] === "help") {
    if (stdout.isTTY) await printBanner({ welcome: false });
    out(HELP_TEXT);
    return;
  }

  try {
    await dispatchCommand(args);
  } catch (e) {
    err(paint(c.red, "error:"), e?.message ?? String(e));
    bail(1);
  }
}

main();
