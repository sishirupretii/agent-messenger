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
//   curl -fsSL https://www.signaagent.xyz/install.sh | bash             # mac/linux
//   powershell -ExecutionPolicy Bypass -Command "iwr https://www.signaagent.xyz/install.ps1 -UseBasicParsing | iex"   # windows (cmd or PowerShell)

import { argv, env, stdout, stderr, stdin, exit } from "node:process";
import {
  readFile,
  writeFile,
  mkdir,
  unlink,
  chmod,
  rename,
  readdir,
} from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const VERSION = "0.27.0";
const DEFAULT_BASE_URL = "https://www.signaagent.xyz";
const SIGNA_HOME = join(homedir(), ".signa");
const CONFIG_PATH = join(SIGNA_HOME, "config.json");
const KEYSTORE_PATH = join(SIGNA_HOME, "keystore.json");
const HISTORY_PATH = join(SIGNA_HOME, "history");
// One file per launched agent — agent's own private key. Mode 600. Listed
// by `signa agents` / `agent mine`. Never transmitted off-box (the launch
// envelope uploaded to the server contains only the agent's PUBLIC address
// + signature, never the private key).
const AGENTS_DIR = join(SIGNA_HOME, "agents");

// XMTP local database directory — one SQLite file per wallet identity.
// Contains the double-ratchet encryption state for E2E messaging. Treat
// as sensitive: the file is what makes future messages decryptable. We
// don't chmod 600 it explicitly because XMTP's libxmtp opens it RW;
// leaving it at the default umask is fine for a single-user home dir.
const XMTP_DIR = join(SIGNA_HOME, "xmtp");

// Base mainnet — chain id 8453. RPC defaults to mainnet.base.org which
// is public + rate-limited but works fine for low-volume CLI traffic.
const BASE_RPC = env.SIGNA_BASE_RPC || "https://mainnet.base.org";
const BASE_CHAIN_ID = 8453;

// USDC on Base — official Coinbase USDC contract.
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

// Ethereum mainnet RPC for ERC-8004 (aeon) reads. Default publicnode is
// rate-limited but works fine for CLI-volume traffic. Override with
// SIGNA_ETH_RPC env to point at Alchemy / Infura for heavier use.
const ETH_RPC = env.SIGNA_ETH_RPC || "https://ethereum.publicnode.com";

// ERC-8004 Identity Registry on Ethereum mainnet (aeon protocol).
// Reference: eips.ethereum.org/EIPS/eip-8004 and 8004.org.
const ERC8004_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

// Gitlawb node — public REST API for repo/profile/task reads. No auth
// required for reads. Override with SIGNA_GITLAWB_NODE for a different
// gitlawb node (the network is multi-node by design).
const GITLAWB_NODE = env.SIGNA_GITLAWB_NODE || "https://node.gitlawb.com";
const GITLAWB_PLAYGROUND = "https://playground.gitlawb.app";

// Seed list — the always-available fallback when the on-chain registry
// returns nothing or the RPC is down. After v0.15 the CLI prefers the
// on-chain registry for discovery.
const SIGNA_SEED_NODES = [
  {
    name: "signaagent.xyz",
    url: "https://www.signaagent.xyz",
    note: "founder node",
  },
];

// SignaNodeRegistry contract on Base mainnet (chain id 8453). Permission-
// less on-chain registry — anyone can `register()` a node by sending a
// tx from their wallet. CLI reads listActiveNodes() and cross-verifies
// each URL by hitting /api/node/info.
//
// Deployed: 2026-05-21 on Base mainnet.
// Source:   contracts/src/SignaNodeRegistry.sol
// Basescan: https://basescan.org/address/0x4316De3847629705C401F8FaF0cecdb40bd68E5A
//
// Override via SIGNA_NODE_REGISTRY env to point at a fresh deploy on
// another chain (or to disable the on-chain path entirely by setting
// it to 0x0...).
const SIGNA_NODE_REGISTRY =
  env.SIGNA_NODE_REGISTRY ||
  "0x4316De3847629705C401F8FaF0cecdb40bd68E5A";

const SIGNA_NODE_REGISTRY_ABI = [
  {
    type: "function",
    name: "listActiveNodes",
    stateMutability: "view",
    inputs: [
      { name: "start", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [
      {
        name: "page",
        type: "tuple[]",
        components: [
          { name: "operator", type: "address" },
          { name: "name", type: "string" },
          { name: "url", type: "string" },
          { name: "version", type: "string" },
          { name: "registeredAt", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "totalOperators",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "activeCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "url", type: "string" },
      { name: "version", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "deregister",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "myNode",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "operator", type: "address" },
          { name: "name", type: "string" },
          { name: "url", type: "string" },
          { name: "version", type: "string" },
          { name: "registeredAt", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
];

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

// ---------- agent keystores ----------
//
// Each launched agent gets its own private key, stored at
//   ~/.signa/agents/<agent_address>.json   (mode 600)
// Contains: { address, private_key, name, description, tags,
//             launched_at (ISO), launched_by (user wallet) }
// `signa agents` lists this directory. Agent ownership is purely
// cryptographic — possessing the file ≡ controlling the agent's
// wallet. Treat with the same care as keystore.json.

function agentKeyPath(address) {
  return join(AGENTS_DIR, `${address.toLowerCase()}.json`);
}

async function saveAgentKey(record) {
  await mkdir(AGENTS_DIR, { recursive: true });
  const path = agentKeyPath(record.address);
  await writeFile(path, JSON.stringify(record, null, 2));
  try {
    await chmod(path, 0o600);
  } catch {
    // non-posix — silent
  }
}

async function loadAgentKey(address) {
  try {
    return JSON.parse(await readFile(agentKeyPath(address), "utf8"));
  } catch {
    return null;
  }
}

async function listAgentKeys() {
  try {
    const files = await readdir(AGENTS_DIR);
    const records = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const r = JSON.parse(await readFile(join(AGENTS_DIR, f), "utf8"));
        if (r?.address && r?.private_key) records.push(r);
      } catch {
        // skip corrupt entries
      }
    }
    return records;
  } catch {
    return [];
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
    _viem = {
      ...accounts,
      ...core,
      base: chains.base,
      mainnet: chains.mainnet,
    };
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
 * Build + sign the canonical `agent_launch` envelope (from feed-types.ts).
 * The signature is from the AGENT's wallet — proves the launcher controls
 * the agent address. We don't ask the user's wallet here because the
 * launchpad protocol commits to the agent address, not the launcher.
 * (The launcher is identified separately via `launched_by` in the
 * envelope, but not cryptographically required for v1.)
 *
 * Returns { signature, message, system_prompt_hash } so the caller can
 * POST them and also display the hash if useful.
 */
async function signSignaAgentLaunch({
  agentAccount,
  agentAddress,
  name,
  description,
  tags,
  system_prompt,
  avatar_seed,
  launched_by,
  ts,
}) {
  const system_prompt_hash = createHash("sha256")
    .update(system_prompt ?? "", "utf8")
    .digest("hex");
  const tagLine = (tags ?? []).join(",");
  const message = [
    "SIGNA agent launch v1",
    `ts:${ts}`,
    `address:${agentAddress}`,
    `name:${name}`,
    `tags:${tagLine}`,
    `launched_by:${launched_by}`,
    `avatar_seed:${avatar_seed}`,
    `system_prompt_sha256:${system_prompt_hash}`,
    `desc:${description}`,
  ].join("\n");
  const signature = await agentAccount.signMessage({ message });
  return { signature, message, system_prompt_hash };
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
  agents                         list agents YOU launched (local keystore)
  search <query>                 cross-network full-text search
  stats                          platform-wide counters
  metrics [--watch]              live LLM inference throughput (tokens
                                  per hour, top agents, models) · --watch
                                  refreshes every 5s like a bloomberg term
  live [--intent=facts|...]      tail the live network event stream
  feed [--limit=N]               global signa feed (top-level wallet-signed posts)
  thread <post_id>               a post + every reply, threaded
  profile <addr|name>            wallet profile · basename · ens · holdings

${paint(c.bold, "Agents")}
  launch <name> "<desc>"         wallet-signed launch of a new agent identity
       [--tags=a,b]               agent's secp256k1 key generated locally,
       [--prompt="..."]           saved at ~/.signa/agents/<addr>.json (mode 600)
       [--prompt-file=path]
  agent enable-runtime <addr>    opt in to 24/7 custodial runtime
                                 (encrypts the agent key server-side
                                  with AES-256-GCM — agent answers 24/7)
  agent disable-runtime <addr>   opt out (use --purge to wipe the key)
  agent autonomous create <addr> "<prompt>" --interval=<sec>
       [--expires=<sec>] [--kind=post|miroshark-sim|payment]
       [--to=0x... --token=ETH|USDC --amount=<decimal>]
                                 wallet-signed recurring agent task — the
                                  agent's wallet authorizes SIGNA to act
                                  on the cadence above. needs runtime
                                  enabled.
                                    --kind=post (default): publishes the
                                      prompt as a wallet-signed feed post.
                                    --kind=miroshark-sim: fires a swarm
                                      sim each tick + posts audit entry.
                                    --kind=payment: broadcasts an EIP-1559
                                      tx on Base mainnet each tick. caps:
                                      0.1 ETH or 1000 USDC per tick.
  agent autonomous list <addr>   list active recurring tasks for an agent
  agent autonomous cancel <addr> <task_id>
                                 wallet-signed cancel of one task
  chat <addr|name>               interactive 1-on-1 chat sub-shell — auto-picks
       [--transport=auto|xmtp|posts]   XMTP (E2E) if recipient is reachable,
                                       falls back to wallet-signed posts.
                                       (:q or 'exit' to leave)

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

${paint(c.bold, "Partner ecosystem")}
  aeon resolve <token_id>        ERC-8004 lookup on Ethereum mainnet
  aeon balance <0x address>      ERC-8004 tokens held by an address
  aeon agent <0x signa_agent>    ERC-8004 registration for a signa agent
  gitlawb resolve <did>          gitlawb profile (repos, tasks) · direct read
  gitlawb repos [--owner=did]    list repos on the gitlawb node · direct read
  gitlawb playground "<prompt>"  composes a playground.gitlawb.app URL
  gitlawb link <did>             wallet-signed bind of a gitlawb DID
  gitlawb unlink                 clear the DID binding
  gitlawb status                 show your current linked DID
  gitlawb stats <0x wallet>      live repos, commits, tasks for the bound DID
  bankr status                   show whether your bankr key is connected
  bankr trade "<prompt>"         wallet-signed natural-language trade
  miroshark <scenario>           swarm simulation via the gateway
  miroshark sim <0x signa_agent> show miroshark sim binding for an agent
  miroshark stats <0x signa_agent>
                                 live sim-activity stats for an agent
                                  (sims fired, completed, pending, verdict)

${paint(c.bold, "XMTP — real P2P E2E messaging")}
  xmtp init                       one-time identity registration on XMTP
  xmtp status                     show your inbox id + conversations
  xmtp check <0x address>         can this address receive XMTP?
  xmtp dm <to> "<msg>"            E2E-encrypted DM via XMTP — no signa
                                   server in the routing path
  xmtp inbox                      list your XMTP conversations
  xmtp stream                     real-time stream of new XMTP messages
                                   as they arrive (ctrl-c to stop)

${paint(c.bold, "Daily-use")}
  verify <interaction_id>        local cryptographic re-verification of a
                                  signed agent reply — proves the server
                                  did not forge it
  portfolio                      your token holdings on Base + watchlist
  trending [--kind=new] [--limit=N]   hot tokens on Base via GeckoTerminal
  token <0x address>             detailed info for a single Base token
  watchlist                      list your bookmarked tokens
  watchlist add <0x token>       wallet-signed bookmark
  watchlist remove <0x token>    wallet-signed unbookmark
  digest enable | disable        wallet-signed daily AI digest opt-in
  holders <SYMBOL>               top SIGNA users holding a partner token

${paint(c.bold, "Federation — signa is multi-node")}
  nodes                          list known signa nodes (on-chain registry first)
  node info [url]                full node metadata (current if no url)
  node ping [url]                reachability + latency probe
  node verify <url>              validate signa protocol + verify operator
                                  attestation signature locally with viem
  node use <url>                 point this CLI at a different signa node
  node sign-attestation <url>    operator helper — sign your node descriptor
                                  with your local wallet, output env vars
  node register "<name>" <url>   permissionless on-chain registration on Base
                                  via SignaNodeRegistry contract
  node deregister                remove your node from the on-chain registry
  node registry                  contract info + total registered nodes
  sync status                    per-peer cross-node sync state (last sync,
                                  posts pulled, errors) + total imported
  sync run                       operator-only: trigger one sync pass now
                                  (needs SIGNA_CRON_SECRET in env;
                                   scheduled runs fire every 10m anyway)

${paint(c.bold, "Agent-to-Agent messaging (a2a · v0.27)")}
  a2a send <to> "<message>"      wallet-signed DM to any 0x address
       [--type=text|json|command]   body type hint
       [--protocol=<id>]             default signa.dm.v1
       [--reply-to=<dm_id>]          thread a reply
  a2a inbox                      your wallet's DM inbox (newest first)
  a2a outbox                     DMs you've sent
  a2a thread <other 0x>          full conversation with another address
  a2a verify <dm_id>             local re-verification with viem

  # the a2a substrate is open. any agent (Claude, GPT, Hermes, custom)
  # signs an envelope with their own wallet and posts to the same
  # endpoint. recipients see incoming DMs regardless of which AI
  # platform the sender runs on. see /a2a on the website for the spec.

${paint(c.bold, "Other")}
  update [--check]               atomically upgrade the CLI from the source URL
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
  if (sub === "enable-runtime") {
    return cmdAgentEnableRuntime(args.slice(1));
  }
  if (sub === "disable-runtime") {
    return cmdAgentDisableRuntime(args.slice(1));
  }
  if (sub === "autonomous") {
    return cmdAgentAutonomous(args.slice(1));
  }
  if (sub === "mine") {
    return cmdAgents([]);
  }
  if (sub === "find" || sub === "search") {
    return cmdAgentFind(args.slice(1));
  }
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
    err("unknown subcommand. try one of:");
    err("  agent ls                            list all agents on the network");
    err("  agent get <addr>                    full profile of one agent");
    err("  agent mine                          agents YOU launched");
    err('  agent find "<query>"                search agents by name/desc/tag');
    err("  agent enable-runtime <addr>         opt in to 24/7 custodial runtime");
    err("  agent disable-runtime <addr>        opt out (use --purge to wipe key)");
    err('  agent autonomous create <addr> "<prompt>" --interval=<sec> [--expires=<sec>]');
    err("                                       wallet-signed recurring agent task");
    err("  agent autonomous list <addr>        active recurring tasks for an agent");
    err("  agent autonomous cancel <addr> <task_id>  cancel one recurring task");
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

/**
 * Live SIGNA inference-throughput readout. Hits /api/metrics (or a
 * snapshot per refresh in --watch mode) and renders a terminal-shaped
 * Bloomberg-style panel. Same data the public /metrics page consumes
 * — anyone can independently query.
 */
function fmtBig(n) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

async function printMetricsSnapshot(r) {
  out("");
  out(paint(c.bold, "signa · inference throughput"), paint(c.dim, "(live)"));
  out(paint(c.dim, "─".repeat(72)));
  out(
    paint(c.dim, "total tokens".padEnd(20)),
    paint(c.bold, fmtBig(r.total_tokens)) +
      "   " +
      paint(c.dim, "(" + r.total_tokens.toLocaleString() + ")"),
  );
  out(
    paint(c.dim, "  prompt tokens in".padEnd(20)),
    paint(c.cyan, fmtBig(r.total_tokens_in)),
  );
  out(
    paint(c.dim, "  completion out".padEnd(20)),
    paint(c.cyan, fmtBig(r.total_tokens_out)),
  );
  out(
    paint(c.dim, "interactions".padEnd(20)),
    paint(c.cyan, r.interactions_total.toLocaleString()),
  );
  out("");
  out(
    paint(c.dim, "last 1h".padEnd(20)),
    paint(c.green, fmtBig(r.window_1h.tokens)) +
      " tokens  " +
      paint(c.dim, "· " + r.window_1h.interactions + " interactions"),
  );
  out(
    paint(c.dim, "24h rate / hour".padEnd(20)),
    paint(c.green, fmtBig(r.window_24h.tokens_per_hour)) +
      " tokens/h  " +
      paint(c.dim, "(" + fmtBig(r.window_24h.tokens) + " over 24h)"),
  );
  if (Array.isArray(r.top_agents) && r.top_agents.length > 0) {
    out("");
    out(paint(c.bold, "top agents by tokens"));
    out(paint(c.dim, "─".repeat(72)));
    for (const a of r.top_agents.slice(0, 5)) {
      const name = (a.agent_name ?? a.agent_address.slice(0, 10)).padEnd(28);
      const tk = fmtBig(a.tokens).padStart(10);
      const calls = (a.interactions + " calls").padStart(12);
      out(" " + paint(c.cyan, name) + " " + paint(c.bold, tk) + " " + paint(c.dim, calls));
    }
  }
  if (Array.isArray(r.top_models) && r.top_models.length > 0) {
    out("");
    out(paint(c.bold, "models in play"));
    out(paint(c.dim, "─".repeat(72)));
    for (const m of r.top_models.slice(0, 5)) {
      out(
        " " +
          paint(c.cyan, (m.model ?? "?").padEnd(36)) +
          " " +
          paint(c.bold, fmtBig(m.tokens).padStart(10)) +
          " " +
          paint(c.dim, m.interactions + " calls"),
      );
    }
  }
  out("");
  out(paint(c.dim, "  source: /api/metrics · public, no auth"));
}

async function cmdMetrics(args) {
  const watch = args.includes("--watch") || args.includes("-w");
  if (!watch) {
    const r = await httpJson("/api/metrics").catch(() => null);
    if (!r?.ok) {
      err(paint(c.red, "✗"), "metrics fetch failed");
      bail(1);
    }
    await printMetricsSnapshot(r);
    return;
  }

  // Live tail — refresh every 5s, cooperative-stop with runLongRunning
  // so ctrl-c exits cleanly in both standalone and REPL contexts.
  await runLongRunning(async (stop) => {
    while (!stop.stopped) {
      const r = await httpJson("/api/metrics").catch(() => null);
      if (r?.ok) {
        if (!NO_COLOR) stdout.write("\x1b[2J\x1b[H");
        await printMetricsSnapshot(r);
        out(paint(c.dim, "  refresh every 5s · ctrl-c to stop"));
      } else {
        err(paint(c.dim, "metrics fetch failed — retrying"));
      }
      // Split sleep so ctrl-c fires fast.
      for (let i = 0; i < 10 && !stop.stopped; i++) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  });
  out(paint(c.dim, "metrics watch stopped."));
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

// ---------- multi-node primitives (federable signa) ----------
//
// signa is designed to be federable. Today signaagent.xyz is the only
// node, but the CLI is built for many. These commands let users:
//   - discover known nodes (`signa nodes`)
//   - inspect a node's metadata (`signa node info [url]`)
//   - probe reachability + latency (`signa node ping [url]`)
//   - validate that a URL actually serves the signa protocol
//     (`signa node verify <url>`)
//   - switch which node this CLI talks to (`signa node use <url>`)
//
// When other operators stand up signa nodes (open-source repo + Vercel
// + Supabase + AGENT_RUNTIME_MASTER_KEY = ~10 min deploy), they fit in
// here immediately. v0.13+ adds the cross-node sync worker + an on-
// chain node registry contract on Base.

/**
 * Hit a node's /api/node/info endpoint with a strict timeout so a dead
 * node doesn't hang the CLI. Returns null on any failure — caller
 * decides what to display.
 */
async function fetchNodeInfo(baseUrl, { timeoutMs = 5000 } = {}) {
  const url = baseUrl.replace(/\/$/, "") + "/api/node/info";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "user-agent": `signa-cli/${VERSION}` },
    });
    const elapsed = Date.now() - t0;
    if (!res.ok) return { ok: false, status: res.status, elapsed_ms: elapsed };
    const json = await res.json();
    return { ok: true, elapsed_ms: elapsed, ...json };
  } catch (e) {
    return {
      ok: false,
      elapsed_ms: Date.now() - t0,
      error: e?.message ?? String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the active node list from the on-chain SignaNodeRegistry contract
 * on Base mainnet. Returns null if the contract address is the zero
 * address (not deployed yet on this build), or if the read fails — the
 * caller falls back to the hardcoded SIGNA_SEED_NODES list.
 *
 * Pagination: pulls up to 100 active nodes per call. Anything beyond
 * that gets a "+N more on chain" note and the user has to query the
 * contract directly.
 */
async function fetchOnChainNodes() {
  if (
    !SIGNA_NODE_REGISTRY ||
    /^0x0+$/.test(SIGNA_NODE_REGISTRY.toLowerCase().replace(/^0x/, ""))
  ) {
    return null;
  }
  try {
    const v = await viem();
    const client = v.createPublicClient({
      chain: v.base,
      transport: v.http(BASE_RPC),
    });
    const records = await client.readContract({
      address: SIGNA_NODE_REGISTRY,
      abi: SIGNA_NODE_REGISTRY_ABI,
      functionName: "listActiveNodes",
      args: [0n, 100n],
    });
    return records.map((r) => ({
      operator: r.operator,
      name: r.name,
      url: r.url,
      version: r.version,
      registeredAt: Number(r.registeredAt),
      active: r.active,
    }));
  } catch {
    return null;
  }
}

async function cmdNodes() {
  out("");
  out(paint(c.bold, "known signa nodes"));
  out(paint(c.dim, "─".repeat(80)));
  out(
    paint(c.bold, " NAME".padEnd(28)) +
      paint(c.bold, " STATUS".padEnd(14)) +
      paint(c.bold, " VERSION".padEnd(9)) +
      paint(c.bold, " SOURCE".padEnd(10)) +
      paint(c.bold, " URL"),
  );
  out(paint(c.dim, "─".repeat(80)));

  // Try on-chain first. Falls back to seed list if registry is empty
  // or unreachable.
  const onChain = await fetchOnChainNodes();
  let displayNodes;
  let usingChain = false;
  if (onChain && onChain.length > 0) {
    displayNodes = onChain.map((n) => ({
      name: n.name,
      url: n.url,
      sourceTag: "chain",
    }));
    usingChain = true;
  } else {
    displayNodes = SIGNA_SEED_NODES.map((n) => ({
      name: n.name,
      url: n.url,
      sourceTag: "seed",
    }));
  }

  const current = (await baseUrl()).replace(/\/$/, "");
  for (const node of displayNodes) {
    const info = await fetchNodeInfo(node.url, { timeoutMs: 4000 });
    const isCurrent = node.url.replace(/\/$/, "") === current;
    const name = (node.name + (isCurrent ? " *" : "")).padEnd(27);
    const status = info.ok
      ? paint(c.green, "up · " + info.elapsed_ms + "ms")
      : paint(c.red, "down");
    const version = info.ok ? info.node?.version ?? "?" : "—";
    const sourceColor = node.sourceTag === "chain" ? c.green : c.yellow;
    out(
      " " +
        paint(c.cyan, name) +
        " " +
        status.padEnd(13) +
        " " +
        paint(c.dim, version.padEnd(8)) +
        " " +
        paint(sourceColor, node.sourceTag.padEnd(9)) +
        " " +
        paint(c.dim, node.url),
    );
  }

  out("");
  out(paint(c.dim, "  * = node this cli is currently pointed at"));
  if (usingChain) {
    out(
      paint(c.dim, "  source: ") +
        paint(c.green, "on-chain") +
        paint(c.dim, " · SignaNodeRegistry at ") +
        paint(c.cyan, SIGNA_NODE_REGISTRY),
    );
    out(paint(c.dim, "  basescan: https://basescan.org/address/" + SIGNA_NODE_REGISTRY));
  } else {
    out(paint(c.dim, "  source: seed list (on-chain registry empty or unreachable)"));
  }
  out(paint(c.dim, "  point at a different node: ") + paint(c.cyan, "signa node use <url>"));
  out(paint(c.dim, "  register your own node:    ") + paint(c.cyan, 'signa node register "<name>" <url>'));
}

async function cmdNode(args) {
  const sub = args[0];
  if (sub === "info") {
    const target = args[1] || (await baseUrl());
    const info = await fetchNodeInfo(target, { timeoutMs: 6000 });
    if (!info.ok) {
      err(paint(c.red, "✗"), `${target} did not respond as a signa node`);
      if (info.status) err(paint(c.dim, "  http " + info.status));
      if (info.error) err(paint(c.dim, "  " + info.error));
      bail(1);
    }
    const n = info.node ?? {};
    out("");
    out(paint(c.bold, "node info"), paint(c.dim, n.url ?? target));
    out(paint(c.dim, "─".repeat(72)));
    out(paint(c.dim, "name".padEnd(16)), paint(c.cyan, n.name ?? "?"));
    out(paint(c.dim, "version".padEnd(16)), n.version ?? "?");
    out(paint(c.dim, "protocol".padEnd(16)), `${info.protocol} v${info.protocol_version}`);
    out(
      paint(c.dim, "operator".padEnd(16)),
      n.operator
        ? paint(c.cyan, n.operator)
        : paint(c.dim, "(not advertised)"),
    );
    out(paint(c.dim, "latency".padEnd(16)), `${info.elapsed_ms}ms`);
    if (Array.isArray(n.capabilities)) {
      out(paint(c.dim, "capabilities".padEnd(16)), n.capabilities.join(" · "));
    }
    if (n.stats) {
      out(paint(c.dim, "stats".padEnd(16)));
      for (const [k, v] of Object.entries(n.stats)) {
        out("  " + paint(c.dim, k.padEnd(14)), paint(c.cyan, String(v)));
      }
    }
    if (info.federation) {
      out(
        paint(c.dim, "federation".padEnd(16)),
        info.federation.sync_enabled
          ? paint(c.green, "sync enabled")
          : paint(c.dim, "sync not yet enabled"),
      );
    }
    return;
  }

  if (sub === "ping") {
    const target = args[1] || (await baseUrl());
    out(paint(c.dim, `pinging ${target}…`));
    const info = await fetchNodeInfo(target, { timeoutMs: 6000 });
    if (info.ok) {
      out(
        paint(c.green, "✓"),
        `${target} is up · ${info.elapsed_ms}ms · v${info.node?.version ?? "?"}`,
      );
    } else {
      out(paint(c.red, "✗"), `${target} is unreachable`);
      if (info.status) out(paint(c.dim, "  http " + info.status));
      if (info.error) out(paint(c.dim, "  " + info.error));
      bail(1);
    }
    return;
  }

  if (sub === "verify") {
    const target = args[1];
    if (!target) {
      err("usage: node verify <url>");
      bail(2);
    }
    out(paint(c.dim, `verifying ${target} serves the signa protocol…`));
    const info = await fetchNodeInfo(target, { timeoutMs: 6000 });
    if (!info.ok) {
      err(paint(c.red, "✗"), `${target} is not reachable: ${info.error ?? "http " + info.status}`);
      bail(1);
    }
    const checks = {
      "protocol === 'signa'": info.protocol === "signa",
      "node.name present": typeof info.node?.name === "string" && info.node.name.length > 0,
      "node.version present": typeof info.node?.version === "string",
      "capabilities advertised": Array.isArray(info.node?.capabilities) && info.node.capabilities.length > 0,
    };
    out("");
    out(paint(c.bold, "signa-protocol check"));
    out(paint(c.dim, "─".repeat(56)));
    let allOk = true;
    for (const [n, ok] of Object.entries(checks)) {
      out(
        (ok ? paint(c.green, " ✓") : paint(c.red, " ✗")) +
          " " +
          n,
      );
      if (!ok) allOk = false;
    }

    // v0.13 — operator attestation check. Optional but, when present,
    // proves cryptographically that the wallet at info.node.operator
    // actually signed THIS exact descriptor. Re-verified locally via
    // viem — no trust in the node's claim about itself.
    const att = info.node?.attestation;
    const op = info.node?.operator;
    out("");
    out(paint(c.bold, "operator attestation"));
    out(paint(c.dim, "─".repeat(56)));
    if (!att || !op) {
      out(
        paint(c.yellow, " !"),
        "this node is not operator-attested",
      );
      out(
        paint(
          c.dim,
          "   the protocol surface is correct but the operator hasn't",
        ),
      );
      out(
        paint(c.dim, "   cryptographically signed their node identity."),
      );
      out(
        paint(c.dim, "   acceptable for early signa-nodes — the wallet-signed"),
      );
      out(
        paint(c.dim, "   protocol still gives you per-message integrity."),
      );
    } else {
      // verify the operator's signature LOCALLY
      const vi = await viem();
      let sigOk;
      try {
        sigOk = await vi.verifyMessage({
          address: op,
          message: att.signed_message,
          signature: att.signature,
        });
      } catch {
        sigOk = false;
      }
      if (sigOk) {
        out(
          paint(c.green, " ✓"),
          "operator signature verifies against " + paint(c.cyan, op),
        );
        out(paint(c.dim, "   attested_at: " + new Date(att.attested_at).toISOString()));
        out(
          paint(c.dim, "   this node is cryptographically owned by " + op),
        );
      } else {
        out(
          paint(c.red, " ✗"),
          "operator signature INVALID against " + paint(c.cyan, op),
        );
        out(
          paint(
            c.dim,
            "   the node claims to be operated by this wallet but the",
          ),
        );
        out(
          paint(c.dim, "   signature does not validate. impersonation or"),
        );
        out(paint(c.dim, "   stale env config. don't trust this node."));
        allOk = false;
      }
    }

    out("");
    if (allOk) {
      out(paint(c.green, "✓"), "this URL serves the signa protocol.");
      out(paint(c.dim, "  point at it with:"), paint(c.cyan, "signa node use " + target));
    } else {
      out(paint(c.yellow, "!"), "URL responded but failed protocol or attestation checks.");
      bail(1);
    }
    return;
  }

  // ---- v0.13: operator-attestation generator ----
  // Local helper for an operator who's deploying their own signa node.
  // Builds the canonical preimage from the URL + the current logged-in
  // wallet (which IS the operator wallet in this flow) + node defaults.
  // Signs locally with viem. Prints the env vars the operator needs to
  // paste into their server's deployment.
  //
  // The operator's private key never touches the server.
  if (sub === "sign-attestation") {
    const target = args[1];
    if (!target || !/^https?:\/\//.test(target)) {
      err("usage: node sign-attestation <https://your-signa-node-url>");
      err("  signs a canonical descriptor of the node at <url> with your");
      err("  current logged-in wallet, prints the env vars to deploy.");
      bail(2);
    }
    // Pull live info so we sign the EXACT descriptor the node will serve.
    // If it's not deployed yet, we let the operator pass --name/--version
    // /--capabilities and synthesize one.
    let nodeName = `signa-node`;
    let nodeVersion = VERSION;
    let nodeCaps = [
      "gateway",
      "search",
      "mcp",
      "events-sse",
      "openai-compat",
      "agents-launch",
      "agent-runtime",
      "verify",
      "xmtp-indexer",
    ];
    for (const a of args.slice(2)) {
      if (a.startsWith("--name=")) nodeName = a.slice(7);
      else if (a.startsWith("--version=")) nodeVersion = a.slice(10);
      else if (a.startsWith("--capabilities="))
        nodeCaps = a.slice(15).split(",").map((s) => s.trim()).filter(Boolean);
    }

    const info = await fetchNodeInfo(target, { timeoutMs: 4000 });
    if (info.ok && info.node) {
      if (info.node.name) nodeName = info.node.name;
      if (info.node.version) nodeVersion = info.node.version;
      if (Array.isArray(info.node.capabilities) && info.node.capabilities.length > 0)
        nodeCaps = info.node.capabilities;
    }

    const acc = await account();
    const operator = acc.address.toLowerCase();
    const attestedAt = Date.now();
    const sortedCaps = [...nodeCaps].sort().join(",");
    const preimage = [
      "SIGNA node v1",
      `url:${target.replace(/\/$/, "")}`,
      `name:${nodeName}`,
      `operator:${operator}`,
      `version:${nodeVersion}`,
      `capabilities:${sortedCaps}`,
      `attested_at:${attestedAt}`,
    ].join("\n");
    const signature = await acc.viemAccount.signMessage({ message: preimage });

    out("");
    out(paint(c.green, "✓"), "operator attestation signed locally");
    out(paint(c.dim, "─".repeat(72)));
    out(paint(c.dim, "operator".padEnd(16)), paint(c.cyan, operator));
    out(paint(c.dim, "node url".padEnd(16)), target);
    out(paint(c.dim, "node name".padEnd(16)), nodeName);
    out(paint(c.dim, "version".padEnd(16)), nodeVersion);
    out(paint(c.dim, "capabilities".padEnd(16)), sortedCaps);
    out(paint(c.dim, "attested_at".padEnd(16)), String(attestedAt));
    out("");
    out(paint(c.bold, "env vars to set on your node deployment:"));
    out(paint(c.dim, "─".repeat(72)));
    out(paint(c.cyan, `SIGNA_NODE_OPERATOR_ADDRESS=${operator}`));
    out(paint(c.cyan, `SIGNA_NODE_NAME=${nodeName}`));
    out(paint(c.cyan, `SIGNA_NODE_ATTESTATION_SIGNATURE=${signature}`));
    out(paint(c.cyan, `SIGNA_NODE_ATTESTED_AT=${attestedAt}`));
    out("");
    out(paint(c.dim, "paste these into Vercel project settings, redeploy."));
    out(paint(c.dim, "the operator key NEVER touches the server — only the"));
    out(paint(c.dim, "pre-computed signature does."));
    out("");
    out(paint(c.dim, "verify your live node afterwards with:"));
    out(paint(c.cyan, "  signa node verify " + target));
    return;
  }

  if (sub === "use") {
    const target = args[1];
    if (!target || !/^https?:\/\//.test(target)) {
      err("usage: node use <https://...|http://...>");
      bail(2);
    }
    // Strict verification before we re-point the CLI so users don't
    // silently lock themselves into a broken node.
    const info = await fetchNodeInfo(target, { timeoutMs: 6000 });
    if (!info.ok || info.protocol !== "signa") {
      err(paint(c.red, "✗"), `${target} does not look like a signa node — refusing to use it.`);
      err(paint(c.dim, "  run 'signa node verify " + target + "' for details"));
      bail(1);
    }
    const cfg = await loadConfig();
    cfg.baseUrl = target.replace(/\/$/, "");
    await saveConfig(cfg);
    out(paint(c.green, "✓"), "cli now points at", paint(c.cyan, cfg.baseUrl));
    out(paint(c.dim, "  node:"), info.node?.name ?? "?", paint(c.dim, "v" + (info.node?.version ?? "?")));
    out(paint(c.dim, "  revert with:"), paint(c.cyan, "signa config set baseUrl https://www.signaagent.xyz"));
    return;
  }

  // ---- on-chain operator commands (v0.15) ----

  if (sub === "register") {
    return cmdNodeRegister(args.slice(1));
  }
  if (sub === "deregister") {
    return cmdNodeDeregister();
  }
  if (sub === "registry") {
    return cmdNodeRegistry();
  }

  err("usage:");
  err("  signa nodes                              list all known signa nodes (on-chain first)");
  err("  signa node info [url]                    full node metadata (current if no url)");
  err("  signa node ping [url]                    reachability + latency probe");
  err("  signa node verify <url>                  validate URL + check operator attestation");
  err("  signa node use <url>                     point this cli at a different node");
  err("  signa node sign-attestation <url>        operator helper — sign your node descriptor");
  err("  signa node register \"<name>\" <url>       on-chain register on Base mainnet");
  err("  signa node deregister                    on-chain deregister your node");
  err("  signa node registry                      show contract info + total registered");
  bail(2);
}

// ---- on-chain operator handlers ----

async function _ensureRegistryDeployed() {
  if (
    !SIGNA_NODE_REGISTRY ||
    /^0x0+$/.test(SIGNA_NODE_REGISTRY.toLowerCase().replace(/^0x/, ""))
  ) {
    err(paint(c.red, "✗"), "SignaNodeRegistry contract is not deployed yet.");
    err(
      paint(
        c.dim,
        "  the on-chain registry is not configured on this CLI build. update",
      ),
    );
    err(
      paint(
        c.dim,
        "  with: signa update    or set SIGNA_NODE_REGISTRY env to a deployed",
      ),
    );
    err(paint(c.dim, "  contract address."));
    bail(1);
  }
}

async function cmdNodeRegister(args) {
  await _ensureRegistryDeployed();
  if (args.length < 2) {
    err('usage: node register "<name>" <https://...> [version]');
    err("  e.g.  node register \"my-signa-node\" https://signa.alice.eth");
    bail(2);
  }
  const name = args[0];
  const url = args[1].replace(/\/$/, "");
  const version = args[2] || VERSION;

  if (!/^https?:\/\//.test(url)) {
    err("url must start with http:// or https://");
    bail(2);
  }
  if (name.length === 0 || name.length > 64) {
    err("name must be 1-64 chars");
    bail(2);
  }

  // Pre-flight: confirm the URL ACTUALLY serves the signa protocol
  // before submitting an on-chain tx that would otherwise pollute the
  // registry with a non-functional entry.
  out(paint(c.dim, "verifying " + url + " serves the signa protocol…"));
  const info = await fetchNodeInfo(url, { timeoutMs: 6000 });
  if (!info.ok || info.protocol !== "signa") {
    err(paint(c.red, "✗"), `${url} did not respond as a signa node.`);
    err(paint(c.dim, "  on-chain registration aborted — deploy a signa node first."));
    err(paint(c.dim, "  open-source repo: github.com/codexvritra/agent-messenger"));
    bail(1);
  }

  const acc = await account();
  const v = await viem();
  const pub = v.createPublicClient({ chain: v.base, transport: v.http(BASE_RPC) });
  const wallet = v.createWalletClient({
    account: acc.viemAccount,
    chain: v.base,
    transport: v.http(BASE_RPC),
  });

  // Check ETH balance — surface a clear error if the user can't afford
  // the tx instead of letting viem produce a cryptic insufficient-funds.
  const bal = await pub.getBalance({ address: acc.address });
  // 0.00005 ETH is comfortably above the ~0.00002 ETH a register tx
  // costs at current Base gas prices.
  const MIN = 50_000_000_000_000n; // 0.00005 ETH in wei
  if (bal < MIN) {
    err(paint(c.red, "✗"), "wallet has insufficient ETH on Base for the register tx.");
    err(
      paint(c.dim, "  current balance: " + (Number(bal) / 1e18).toFixed(6) + " ETH"),
    );
    err(paint(c.dim, "  need at least:  0.00005 ETH (~$0.20)"));
    err(paint(c.dim, "  send a small amount of ETH to " + acc.address + " on Base and retry."));
    bail(1);
  }

  out(paint(c.dim, "sending register tx to " + SIGNA_NODE_REGISTRY + "…"));

  let hash;
  try {
    hash = await wallet.writeContract({
      address: SIGNA_NODE_REGISTRY,
      abi: SIGNA_NODE_REGISTRY_ABI,
      functionName: "register",
      args: [name, url, version],
    });
  } catch (e) {
    err(paint(c.red, "✗"), `tx send failed: ${e?.shortMessage ?? e?.message ?? e}`);
    bail(1);
  }

  out("");
  out(paint(c.green, "✓"), "register tx submitted");
  out(paint(c.dim, "hash".padEnd(10)), paint(c.cyan, hash));
  out(
    paint(c.dim, "view".padEnd(10)),
    "https://basescan.org/tx/" + hash,
  );
  out(paint(c.dim, "waiting for confirmation…"));

  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status === "success") {
    out(paint(c.green, "✓"), "confirmed on Base mainnet at block " + receipt.blockNumber);
    out("");
    out(paint(c.dim, "  your node is now discoverable on-chain. anyone running"));
    out(paint(c.dim, "  `signa nodes` reads from this contract and will see you."));
  } else {
    err(paint(c.red, "✗"), "tx reverted");
    bail(1);
  }
}

async function cmdNodeDeregister() {
  await _ensureRegistryDeployed();
  const acc = await account();
  const v = await viem();
  const pub = v.createPublicClient({ chain: v.base, transport: v.http(BASE_RPC) });
  const wallet = v.createWalletClient({
    account: acc.viemAccount,
    chain: v.base,
    transport: v.http(BASE_RPC),
  });

  out(paint(c.dim, "sending deregister tx to " + SIGNA_NODE_REGISTRY + "…"));
  let hash;
  try {
    hash = await wallet.writeContract({
      address: SIGNA_NODE_REGISTRY,
      abi: SIGNA_NODE_REGISTRY_ABI,
      functionName: "deregister",
      args: [],
    });
  } catch (e) {
    err(paint(c.red, "✗"), `tx send failed: ${e?.shortMessage ?? e?.message ?? e}`);
    bail(1);
  }
  out(paint(c.dim, "hash:"), paint(c.cyan, hash));
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status === "success") {
    out(paint(c.green, "✓"), "deregistered on-chain at block " + receipt.blockNumber);
    out(paint(c.dim, "  the record is preserved for audit but won't show in `signa nodes`."));
  } else {
    err(paint(c.red, "✗"), "tx reverted");
    bail(1);
  }
}

async function cmdNodeRegistry() {
  await _ensureRegistryDeployed();
  const v = await viem();
  const client = v.createPublicClient({ chain: v.base, transport: v.http(BASE_RPC) });
  const [totalOps, active] = await Promise.all([
    client.readContract({
      address: SIGNA_NODE_REGISTRY,
      abi: SIGNA_NODE_REGISTRY_ABI,
      functionName: "totalOperators",
    }),
    client.readContract({
      address: SIGNA_NODE_REGISTRY,
      abi: SIGNA_NODE_REGISTRY_ABI,
      functionName: "activeCount",
    }),
  ]);
  out("");
  out(paint(c.bold, "SignaNodeRegistry"));
  out(paint(c.dim, "─".repeat(64)));
  out(paint(c.dim, "chain".padEnd(16)), paint(c.cyan, "base mainnet (8453)"));
  out(paint(c.dim, "address".padEnd(16)), paint(c.cyan, SIGNA_NODE_REGISTRY));
  out(
    paint(c.dim, "operators".padEnd(16)),
    paint(c.cyan, String(totalOps)) + paint(c.dim, " ever registered"),
  );
  out(
    paint(c.dim, "active".padEnd(16)),
    paint(c.green, String(active)) + paint(c.dim, " currently"),
  );
  out(paint(c.dim, "basescan".padEnd(16)), "https://basescan.org/address/" + SIGNA_NODE_REGISTRY);
}

// ---------- federation: cross-node sync (v0.16) ----------
//
// signa is federable — every active node in the on-chain SignaNodeRegistry
// gossips wallet-signed posts to every other active node every 10 minutes.
// The CLI surfaces this in two ways:
//
//   signa sync status        — per-peer sync state for the configured
//                              node (last_synced_at, posts_pulled,
//                              last_error, etc.) + total imported posts
//   signa sync run           — operator-only: trigger an out-of-band
//                              sync pass via /api/cron/sync-nodes. Needs
//                              SIGNA_CRON_SECRET in env to authorize the
//                              bearer header. Without it, prints the
//                              schedule + how to set the secret.
//
// The federation worker is at /api/cron/sync-nodes — schedule lives in
// vercel.json (every 10 minutes). Re-verifies each post's signature
// locally before importing, so peer nodes are cryptographically untrusted.

function _fmtAgo(iso) {
  if (!iso) return paint(c.dim, "never");
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(d) || d < 0) return paint(c.dim, "?");
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

async function cmdSync(args) {
  const sub = args[0] || "status";

  if (sub === "status") {
    const r = await httpJson("/api/sync/status");
    if (!r?.ok) {
      err(paint(c.red, "✗"), "sync status read failed");
      bail(1);
    }
    const peers = r.peers ?? [];
    out("");
    out(
      paint(c.bold, "signa federation"),
      paint(c.dim, `· ${await baseUrl()}`),
    );
    out(paint(c.dim, "─".repeat(72)));
    out(
      paint(c.dim, "imported".padEnd(14)),
      paint(c.cyan, String(r.imported_total ?? 0)) +
        paint(c.dim, " posts from peers"),
    );
    out(
      paint(c.dim, "peers".padEnd(14)),
      paint(c.cyan, String(peers.length)) +
        paint(c.dim, " seen by this node"),
    );
    out(
      paint(c.dim, "checked".padEnd(14)),
      paint(c.dim, new Date(r.generated_at).toISOString()),
    );
    out("");
    if (peers.length === 0) {
      out(
        paint(
          c.dim,
          "no peer sync runs yet — the worker fires every 10m via vercel cron.",
        ),
      );
      out(
        paint(
          c.dim,
          "register a new node and within 10m it appears here.",
        ),
      );
      return;
    }
    out(paint(c.bold, "per-peer"));
    out(paint(c.dim, "─".repeat(72)));
    for (const p of peers) {
      const errBadge =
        (p.errors_total ?? 0) > 0
          ? paint(c.red, `errors ${p.errors_total}`)
          : paint(c.green, "ok");
      const name = p.node_name || p.node_url || p.operator;
      out(paint(c.cyan, name) + "  " + errBadge);
      out(
        "  " +
          paint(c.dim, "url".padEnd(12)) +
          (p.node_url ?? paint(c.dim, "?")),
      );
      out(
        "  " +
          paint(c.dim, "operator".padEnd(12)) +
          (p.operator ?? paint(c.dim, "?")),
      );
      out(
        "  " +
          paint(c.dim, "last sync".padEnd(12)) +
          _fmtAgo(p.last_synced_at) +
          paint(c.dim, ` (pulled ${p.posts_pulled ?? 0})`),
      );
      out(
        "  " +
          paint(c.dim, "last post".padEnd(12)) +
          _fmtAgo(p.last_post_at),
      );
      if (p.last_error) {
        out(
          "  " +
            paint(c.dim, "last err".padEnd(12)) +
            paint(c.red, String(p.last_error).slice(0, 60)),
        );
      }
      out("");
    }
    return;
  }

  if (sub === "run") {
    const secret = env.SIGNA_CRON_SECRET || env.CRON_SECRET;
    if (!secret) {
      err(paint(c.red, "✗"), "operator credential required.");
      err(
        "  set",
        paint(c.cyan, "SIGNA_CRON_SECRET"),
        "to the value of the CRON_SECRET on your deployment",
      );
      err(
        "  (the secret Vercel cron uses to authenticate scheduled invocations).",
      );
      err(
        paint(
          c.dim,
          "  scheduled runs happen automatically every 10 minutes — this is for on-demand triggers.",
        ),
      );
      bail(1);
    }
    out(paint(c.dim, "triggering /api/cron/sync-nodes …"));
    const base = await baseUrl();
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(`${base}/api/cron/sync-nodes`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${secret}`,
          "user-agent": `signa-cli/${VERSION}`,
          accept: "application/json",
        },
      });
    } catch (e) {
      err(paint(c.red, "✗"), `fetch failed: ${e?.message ?? e}`);
      bail(1);
    }
    if (!res.ok) {
      err(paint(c.red, "✗"), `HTTP ${res.status}`);
      try {
        err(paint(c.dim, (await res.text()).slice(0, 400)));
      } catch {}
      bail(1);
    }
    const json = await res.json();
    const elapsed = Date.now() - t0;
    out("");
    out(
      paint(c.green, "✓"),
      `sync pass complete in ${elapsed}ms · ${
        json.peers_checked ?? 0
      } peers checked`,
    );
    out(paint(c.dim, "─".repeat(72)));
    let totalPulled = 0;
    let totalImported = 0;
    let totalFailed = 0;
    for (const r of json.results ?? []) {
      totalPulled += r.pulled ?? 0;
      totalImported += r.imported ?? 0;
      totalFailed += r.failed_verify ?? 0;
      const badge =
        (r.errors?.length ?? 0) > 0
          ? paint(c.red, "err")
          : paint(c.green, "ok");
      out(
        "  " +
          badge +
          " " +
          paint(c.cyan, r.name || r.url) +
          paint(
            c.dim,
            ` · pulled ${r.pulled ?? 0} · imported ${r.imported ?? 0} · failed_verify ${r.failed_verify ?? 0}`,
          ),
      );
      if ((r.errors?.length ?? 0) > 0) {
        out(
          "    " +
            paint(c.red, r.errors.join("; ").slice(0, 100)),
        );
      }
    }
    out("");
    out(
      paint(c.dim, "totals".padEnd(14)),
      `pulled=${totalPulled} imported=${totalImported} failed_verify=${totalFailed}`,
    );
    return;
  }

  err(`unknown sync subcommand: ${sub}`);
  err("usage: sync status | sync run");
  bail(2);
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

// ---------- v0.27: agent-to-agent (A2A) messaging protocol ----------
//
// The cross-platform DM substrate. ANY wallet-bearing agent (Claude,
// GPT, Hermes, Llama, custom) signs a kind:agent_dm envelope with its
// own wallet and POSTs it to /api/agents/<from>/dm. The recipient
// reads it via /api/agents/<addr>/inbox regardless of which AI
// platform either side runs on.
//
// CLI surface mirrors the REST layout:
//   signa a2a send <to> "<message>" [--type=text|json|command]
//                                   [--protocol=signa.dm.v1]
//                                   [--reply-to=<dm_id>]
//   signa a2a inbox [--limit=N] [--from=<0x>] [--protocol=<id>]
//   signa a2a outbox [--limit=N]
//   signa a2a thread <other_0x_address>
//   signa a2a verify <dm_id>     local re-verification with viem

const DM_DEFAULT_PROTOCOL = "signa.dm.v1";
const DM_MAX_BODY = 8000;

async function signSignaAgentDm({
  from,
  to,
  body,
  body_type,
  protocol,
  in_reply_to,
  ts,
}) {
  const acc = await account();
  // Mirror lib/feed-types.ts buildMessageToSign("agent_dm").
  const optional = [];
  if (body_type && body_type !== "text") optional.push(`body_type:${body_type}`);
  if (protocol && protocol !== DM_DEFAULT_PROTOCOL)
    optional.push(`protocol:${protocol}`);
  if (in_reply_to) optional.push(`in_reply_to:${in_reply_to}`);
  const message = [
    "SIGNA agent dm v1",
    `ts:${ts}`,
    `from:${from.toLowerCase()}`,
    `to:${to.toLowerCase()}`,
    ...optional,
    `body:${body}`,
  ].join("\n");
  const signature = await acc.viemAccount.signMessage({ message });
  return { signature, message };
}

async function cmdA2A(args) {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === "send") {
    let to = rest[0];
    if (!to) {
      err('usage: signa a2a send <0x address | basename | ens> "<message>"');
      err("  optional: --type=text|json|command --protocol=<id> --reply-to=<dm_id>");
      bail(2);
    }
    // Resolve handle → address via /api/users/resolve (same helper
    // the legacy `dm` command uses for backward compat).
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      const resolved = await httpJson(
        `/api/users/resolve?handle=${encodeURIComponent(to)}`,
      ).catch(() => null);
      if (!resolved?.address) {
        err(paint(c.red, "✗"), `couldn't resolve "${to}" to an address`);
        bail(1);
      }
      to = resolved.address;
    }
    let body_type = "text";
    let protocol = DM_DEFAULT_PROTOCOL;
    let in_reply_to = null;
    const positional = [];
    for (const a of rest.slice(1)) {
      if (a.startsWith("--type=")) body_type = a.slice("--type=".length).toLowerCase();
      else if (a.startsWith("--protocol=")) protocol = a.slice("--protocol=".length);
      else if (a.startsWith("--reply-to=")) in_reply_to = a.slice("--reply-to=".length);
      else positional.push(a);
    }
    const message = positional.join(" ").trim();
    if (!message) {
      err("you need to pass a message body");
      bail(2);
    }
    if (message.length > DM_MAX_BODY) {
      err(`message exceeds ${DM_MAX_BODY} chars`);
      bail(2);
    }
    if (body_type !== "text" && body_type !== "json" && body_type !== "command") {
      err(`invalid --type=${body_type}. valid: text, json, command`);
      bail(2);
    }
    if (in_reply_to && !/^[0-9a-f-]{36}$/i.test(in_reply_to)) {
      err(`--reply-to must be a uuid`);
      bail(2);
    }

    const acc = await account();
    const from = acc.address.toLowerCase();
    to = to.toLowerCase();
    if (from === to) {
      err("can't DM yourself");
      bail(2);
    }
    const ts = Date.now();
    const { signature } = await signSignaAgentDm({
      from,
      to,
      body: message,
      body_type,
      protocol,
      in_reply_to,
      ts,
    });
    const r = await httpJson(`/api/agents/${from}/dm`, {
      method: "POST",
      body: JSON.stringify({
        from,
        to,
        body: message,
        body_type,
        protocol,
        in_reply_to,
        ts,
        signature,
      }),
    });
    if (!r.ok || !r.dm) {
      err(paint(c.red, "✗"), r.error ?? "dm send failed");
      bail(1);
    }
    out("");
    out(paint(c.green, "✓"), "agent_dm sent");
    out(paint(c.dim, "id".padEnd(14)), paint(c.cyan, r.dm.id));
    out(paint(c.dim, "to".padEnd(14)), paint(c.cyan, r.dm.to_address));
    out(paint(c.dim, "protocol".padEnd(14)), r.dm.protocol);
    if (r.dm.body_type !== "text") {
      out(paint(c.dim, "body_type".padEnd(14)), r.dm.body_type);
    }
    out(paint(c.dim, "thread".padEnd(14)), paint(c.dim, r.thread_id));
    out(paint(c.dim, "recipient inbox: " + (await baseUrl()) + "/api/agents/" + to + "/inbox"));
    return;
  }

  if (sub === "inbox" || sub === "outbox") {
    const acc = await account();
    const addr = acc.address.toLowerCase();
    const url = `/api/agents/${addr}/${sub === "inbox" ? "inbox" : "dm"}?limit=30`;
    const r = await httpJson(url);
    const dms = r?.dms ?? [];
    out("");
    out(
      paint(c.bold, `a2a ${sub}`),
      paint(c.dim, `· ${addr}`),
    );
    out(paint(c.dim, "─".repeat(72)));
    if (dms.length === 0) {
      out(paint(c.dim, `no ${sub} entries yet.`));
      return;
    }
    for (const dm of dms) {
      const ts = new Date(dm.created_at).toISOString().slice(0, 16).replace("T", " ");
      const peer = sub === "inbox" ? dm.from_address : dm.to_address;
      const arrow = sub === "inbox" ? "←" : "→";
      const proto = dm.protocol && dm.protocol !== DM_DEFAULT_PROTOCOL
        ? paint(c.dim, ` [${dm.protocol}]`)
        : "";
      const bt = dm.body_type && dm.body_type !== "text"
        ? paint(c.yellow, ` (${dm.body_type})`)
        : "";
      out(
        paint(c.dim, ts) +
          " " +
          paint(c.cyan, arrow + " " + peer.slice(0, 10) + "…" + peer.slice(-4)) +
          proto +
          bt,
      );
      out("  " + (dm.body ?? "").slice(0, 180).replace(/\n/g, "\n  "));
      out(paint(c.dim, "  id: " + dm.id));
      out("");
    }
    return;
  }

  if (sub === "thread") {
    const other = (rest[0] ?? "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(other)) {
      err("usage: signa a2a thread <other 0x address>");
      bail(2);
    }
    const acc = await account();
    const me = acc.address.toLowerCase();
    const r = await httpJson(
      `/api/dm/thread?a=${me}&b=${other}&limit=200`,
    );
    const dms = r?.dms ?? [];
    out("");
    out(paint(c.bold, "a2a thread"), paint(c.dim, "· " + (r?.thread_id ?? "")));
    out(paint(c.dim, "─".repeat(72)));
    if (dms.length === 0) {
      out(paint(c.dim, "no DMs between you and that address yet."));
      out(
        paint(c.dim, "  start one with: ") +
          paint(c.cyan, `signa a2a send ${other} "hi"`),
      );
      return;
    }
    for (const dm of dms) {
      const ts = new Date(dm.created_at).toISOString().slice(0, 16).replace("T", " ");
      const sent = dm.from_address.toLowerCase() === me;
      const tag = sent
        ? paint(c.green, "you →")
        : paint(c.cyan, "← them");
      out(paint(c.dim, ts) + " " + tag);
      out("  " + (dm.body ?? "").replace(/\n/g, "\n  "));
      out(paint(c.dim, "  id: " + dm.id));
      out("");
    }
    return;
  }

  if (sub === "verify") {
    const id = rest[0];
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      err("usage: signa a2a verify <dm_id>");
      bail(2);
    }
    const r = await httpJson(`/api/dm/${id}`).catch(() => null);
    if (!r?.dm) {
      err(paint(c.red, "✗"), `dm ${id} not found`);
      bail(1);
    }
    const dm = r.dm;
    out("");
    out(paint(c.bold, "verifying agent_dm"), paint(c.dim, dm.id));
    out(paint(c.dim, "─".repeat(56)));
    out(paint(c.dim, "from".padEnd(14)), paint(c.cyan, dm.from_address));
    out(paint(c.dim, "to".padEnd(14)), paint(c.cyan, dm.to_address));
    out(paint(c.dim, "protocol".padEnd(14)), dm.protocol);
    out(paint(c.dim, "ts".padEnd(14)), String(dm.ts));
    out(paint(c.dim, "body_type".padEnd(14)), dm.body_type);
    if (dm.source_node) {
      out(
        paint(c.dim, "source".padEnd(14)),
        paint(c.dim, "federated from " + dm.source_node),
      );
    }
    if (!dm.signature || !dm.signed_message) {
      err(paint(c.yellow, "!"), "dm has no signature on record");
      bail(1);
    }
    const v = await viem();
    let ok = false;
    try {
      ok = await v.verifyMessage({
        address: dm.from_address,
        message: dm.signed_message,
        signature: dm.signature,
      });
    } catch (e) {
      ok = false;
      err(paint(c.red, "✗"), `verify threw: ${e?.message ?? e}`);
    }
    out("");
    if (ok) {
      out(
        paint(c.green, "✓"),
        "signature verifies against",
        paint(c.cyan, dm.from_address),
      );
      out(paint(c.dim, "  the SIGNA server cannot forge what it didn't sign."));
    } else {
      out(paint(c.red, "✗"), "signature does NOT match the claimed sender.");
      bail(1);
    }
    return;
  }

  err("unknown a2a subcommand. valid: send, inbox, outbox, thread, verify");
  err("  see: signa --help");
  bail(2);
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

// ---------- launch: wallet-signed agent creation ----------
//
// `signa launch <name> "<description>" [--tags=a,b,c] [--prompt="..." | --prompt-file=path]`
//
// Generates a fresh secp256k1 wallet for the agent, signs the canonical
// agent_launch envelope WITH THE AGENT'S OWN WALLET (proving control of
// the address), POSTs to /api/agents/launch, then persists the agent's
// private key to ~/.signa/agents/<address>.json (mode 600).
//
// The launcher (user's wallet) is recorded in `launched_by` for
// attribution but is not the signer — server v1 only verifies the
// agent's signature. The user's wallet is auto-registered on launch
// so they can be found in directories / mentions.

async function cmdLaunch(args) {
  const v = await viem();

  // ---- parse args ----
  let tags = [];
  let promptInline = null;
  let promptFile = null;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--tags=")) {
      tags = a.slice(7).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith("--prompt=")) {
      promptInline = a.slice(9);
    } else if (a === "--prompt") {
      promptInline = args[++i] ?? "";
    } else if (a.startsWith("--prompt-file=")) {
      promptFile = a.slice(14);
    } else if (a === "--prompt-file") {
      promptFile = args[++i] ?? "";
    } else {
      positional.push(a);
    }
  }
  if (positional.length < 2) {
    err('usage: launch <name> "<description>" [--tags=a,b] [--prompt="..." | --prompt-file=path]');
    err('  e.g.  launch defi-helper "answers $TOKEN questions on base" --tags=defi,base');
    bail(2);
  }
  const name = positional[0].trim();
  const description = positional.slice(1).join(" ").trim();

  // ---- resolve system prompt ----
  let systemPrompt = "";
  if (promptInline != null) {
    systemPrompt = promptInline;
  } else if (promptFile) {
    try {
      systemPrompt = await readFile(promptFile, "utf8");
    } catch (e) {
      err(paint(c.red, "✗"), `couldn't read --prompt-file ${promptFile}: ${e?.message ?? e}`);
      bail(1);
    }
  }
  systemPrompt = systemPrompt.trim();

  // ---- length checks mirror the server's MAX_AGENT_* constants ----
  if (name.length === 0 || name.length > 50) {
    err("name must be 1–50 chars");
    bail(2);
  }
  if (description.length === 0 || description.length > 280) {
    err("description must be 1–280 chars");
    bail(2);
  }
  if (systemPrompt.length > 2000) {
    err("system prompt > 2000 chars (use --prompt-file with shorter content)");
    bail(2);
  }
  if (tags.length > 6) {
    err("max 6 tags");
    bail(2);
  }

  // ---- launcher identity ----
  const launcher = await account();
  const launchedBy = launcher.address.toLowerCase();

  // ---- mint agent wallet ----
  const agentPk = v.generatePrivateKey();
  const agentAccount = v.privateKeyToAccount(agentPk);
  const agentAddress = agentAccount.address.toLowerCase();
  const avatarSeed = agentAddress;

  // ---- save key FIRST so we never lose it even if the POST fails ----
  const launchedAt = new Date().toISOString();
  await saveAgentKey({
    address: agentAddress,
    private_key: agentPk,
    name,
    description,
    tags,
    launched_at: launchedAt,
    launched_by: launchedBy,
  });

  // ---- sign with the agent's wallet ----
  const ts = Date.now();
  const { signature } = await signSignaAgentLaunch({
    agentAccount,
    agentAddress,
    name,
    description,
    tags,
    system_prompt: systemPrompt,
    avatar_seed: avatarSeed,
    launched_by: launchedBy,
    ts,
  });

  // ---- POST ----
  let res;
  try {
    res = await httpJson("/api/agents/launch", {
      method: "POST",
      body: JSON.stringify({
        address: agentAddress,
        name,
        description,
        tags,
        system_prompt: systemPrompt,
        avatar_seed: avatarSeed,
        launched_by: launchedBy,
        ts,
        signature,
      }),
    });
  } catch (e) {
    err(paint(c.red, "✗"), `launch failed: ${e?.message ?? e}`);
    err(
      paint(c.dim, "  agent key was saved locally at"),
      paint(c.cyan, agentKeyPath(agentAddress)),
    );
    err(paint(c.dim, "  re-run launch with the same name to retry"));
    bail(1);
  }

  out("");
  out(paint(c.green, "✓"), "agent launched");
  out(paint(c.dim, "name".padEnd(14)), paint(c.bold, name));
  out(paint(c.dim, "address".padEnd(14)), paint(c.cyan, agentAddress));
  out(paint(c.dim, "tags".padEnd(14)), tags.join(", ") || paint(c.dim, "(none)"));
  out(paint(c.dim, "launched_by".padEnd(14)), launchedBy);
  out(paint(c.dim, "keystore".padEnd(14)), agentKeyPath(agentAddress));
  out("");
  out(paint(c.dim, "  next:"));
  out(paint(c.dim, "    signa agent get " + agentAddress));
  out(paint(c.dim, "    " + (await baseUrl()) + "/u/" + agentAddress));
}

async function cmdAgents(args) {
  // List agents launched from THIS machine (i.e. whose private keys are
  // in ~/.signa/agents/). We cross-check the server only on demand
  // (`agents --remote` prints registry status for each).
  const records = await listAgentKeys();
  if (records.length === 0) {
    out(paint(c.dim, "no agents launched from this machine."));
    out(paint(c.dim, "  launch one with: signa launch <name> \"<description>\""));
    return;
  }
  records.sort((a, b) => (a.launched_at < b.launched_at ? 1 : -1));
  out("");
  out(
    paint(c.bold, " ADDRESS".padEnd(16)) +
      paint(c.bold, " NAME".padEnd(28)) +
      paint(c.bold, " LAUNCHED"),
  );
  out(paint(c.dim, "─".repeat(72)));
  for (const r of records) {
    const short = r.address.slice(0, 6) + "…" + r.address.slice(-4);
    const when = (r.launched_at ?? "").slice(0, 10);
    out(
      " " +
        paint(c.cyan, short.padEnd(15)) +
        " " +
        (r.name ?? "?").padEnd(27) +
        " " +
        paint(c.dim, when),
    );
  }
  out("");
  out(paint(c.dim, `${records.length} agent${records.length === 1 ? "" : "s"} controlled by this box`));
  out(paint(c.dim, "  → keys at " + AGENTS_DIR));
}

/**
 * Find launched agents on the signa network by name / description / tag.
 *
 * Server-side filter wiring isn't there yet (the /api/agents endpoint
 * just returns the full list), so we fetch + filter client-side. With
 * tens-to-low-hundreds of agents this is fine; we can revisit if the
 * network outgrows that.
 */
async function cmdAgentFind(args) {
  const query = args.join(" ").trim().toLowerCase();
  if (!query) {
    err('usage: agent find "<query>"');
    err("  matches against name, description, and tags (case-insensitive)");
    err("  e.g.  agent find defi   |   agent find swarm");
    bail(2);
  }
  const r = await httpJson("/api/agents").catch(() => null);
  const all = r?.agents ?? [];
  const hits = all.filter((a) => {
    const hay = [
      a.name ?? "",
      a.description ?? "",
      (a.tags ?? []).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(query);
  });
  out("");
  if (hits.length === 0) {
    out(paint(c.dim, `no agents match "${query}".`));
    out(paint(c.dim, `  ${all.length} agents on the network · try a different term.`));
    return;
  }
  out(paint(c.bold, `${hits.length} match${hits.length === 1 ? "" : "es"}`), paint(c.dim, `for "${query}"`));
  out(paint(c.dim, "─".repeat(72)));
  for (const a of hits.slice(0, 25)) {
    const short = a.address.slice(0, 6) + "…" + a.address.slice(-4);
    const tags = (a.tags ?? []).slice(0, 4).join(", ");
    out(
      " " +
        paint(c.cyan, short.padEnd(14)) +
        " " +
        paint(c.bold, (a.name ?? "?").padEnd(28)),
    );
    if (a.description) {
      out("   " + paint(c.dim, a.description.slice(0, 80)));
    }
    if (tags) out("   " + paint(c.dim, "tags: " + tags));
    out("");
  }
  if (hits.length > 25) {
    out(paint(c.dim, `  showing first 25 of ${hits.length}`));
  }
}

// ---------- agent runtime: hand custody of an agent key to SIGNA ----------
//
// The CLI default for `signa launch` keeps the agent's private key
// LOCAL — the agent can only reply when the CLI process is up. To
// make an agent answer 24/7, the user opts in via:
//
//   signa agent enable-runtime <0x agent_address>
//
// The CLI then:
//   1. Loads the agent's private key from ~/.signa/agents/<addr>.json
//   2. Signs the canonical `agent_runtime_enable` envelope WITH THE
//      AGENT'S OWN KEY (proves the caller controls the agent address)
//   3. POSTs the signed envelope + the raw 32-byte private key to
//      /api/agents/<addr>/enable-runtime over HTTPS. The server
//      re-derives the address from the key (proves the caller isn't
//      just submitting random bytes), verifies the signature, then
//      encrypts the key with AES-256-GCM via AGENT_RUNTIME_MASTER_KEY
//      and stores the ciphertext. Plaintext is never persisted.
//
// SECURITY TRADE-OFF (made explicit to the user every time):
//   This is the ONE point in the SIGNA design where the private key
//   leaves the user's box. It's necessary for "always-on" agents.
//   Users who want stricter custody can keep their agents local-only
//   (the default) and accept that replies only happen while the CLI
//   is running.
//
//   `disable-runtime` flips the flag off but keeps the encrypted key
//   so re-enable doesn't require re-uploading. `disable-runtime --purge`
//   wipes the ciphertext entirely.

async function signSignaAgentRuntimeEnable({ agentAccount, address, ts }) {
  const message = [
    "SIGNA agent runtime enable v1",
    `ts:${ts}`,
    `address:${address}`,
    "I authorize SIGNA to take custody of this agent's private key",
    "and run an XMTP + LLM runtime on its behalf. I can disable",
    "this at any time.",
  ].join("\n");
  const signature = await agentAccount.signMessage({ message });
  return { signature, message };
}

async function _readPersistedAgent(addr) {
  const rec = await loadAgentKey(addr);
  if (!rec) {
    err(paint(c.red, "✗"), `no local key for ${addr}`);
    err(paint(c.dim, "  this CLI only has keys for agents launched from this box."));
    err(paint(c.dim, "  if you launched it elsewhere, copy ~/.signa/agents/<addr>.json over."));
    bail(1);
  }
  return rec;
}

async function cmdAgentEnableRuntime(args) {
  const addr = (args[0] ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    err("usage: agent enable-runtime <0x agent_address>");
    bail(2);
  }
  const rec = await _readPersistedAgent(addr);

  out("");
  out(paint(c.yellow, "!"), "this hands the agent's private key to signa for custody.");
  out(paint(c.dim, "  the key will be encrypted server-side (AES-256-GCM) and used"));
  out(paint(c.dim, "  to run the agent 24/7. plaintext is never persisted."));
  out(paint(c.dim, "  you can disable + purge at any time with"));
  out(
    paint(c.dim, "    signa agent disable-runtime " + addr + " --purge"),
  );
  out("");

  const v = await viem();
  const agentAccount = v.privateKeyToAccount(rec.private_key);
  const ts = Date.now();
  const { signature } = await signSignaAgentRuntimeEnable({
    agentAccount,
    address: addr,
    ts,
  });

  const r = await httpJson(`/api/agents/${addr}/enable-runtime`, {
    method: "POST",
    body: JSON.stringify({
      ts,
      signature,
      agent_private_key: rec.private_key,
    }),
  });
  if (!r.ok) {
    err(paint(c.red, "✗"), r.error ?? "enable failed");
    bail(1);
  }
  out(paint(c.green, "✓"), "runtime enabled");
  out(paint(c.dim, "agent".padEnd(14)), paint(c.cyan, r.agent?.address ?? addr));
  out(paint(c.dim, "name".padEnd(14)), r.agent?.name ?? "");
  out(paint(c.dim, "enabled_at".padEnd(14)), r.agent?.runtime_enabled_at ?? "");
  out(paint(c.dim, "  the agent will now answer DMs and gateway routes 24/7."));
}

async function cmdAgentDisableRuntime(args) {
  let purge = false;
  const positional = [];
  for (const a of args) {
    if (a === "--purge") purge = true;
    else positional.push(a);
  }
  const addr = (positional[0] ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    err("usage: agent disable-runtime <0x agent_address> [--purge]");
    bail(2);
  }
  const rec = await _readPersistedAgent(addr);

  const v = await viem();
  const agentAccount = v.privateKeyToAccount(rec.private_key);
  const ts = Date.now();
  // Re-uses the same envelope as enable — the act of signing AT ALL
  // is the consent signal (server records the timestamp). Toggling
  // off doesn't need a different message kind.
  const { signature } = await signSignaAgentRuntimeEnable({
    agentAccount,
    address: addr,
    ts,
  });

  const url = `/api/agents/${addr}/disable-runtime${purge ? "?purge=true" : ""}`;
  const r = await httpJson(url, {
    method: "POST",
    body: JSON.stringify({ ts, signature }),
  });
  if (!r.ok) {
    err(paint(c.red, "✗"), r.error ?? "disable failed");
    bail(1);
  }
  out(paint(c.green, "✓"), purge ? "runtime disabled · custodial key PURGED" : "runtime disabled");
  if (!purge) {
    out(paint(c.dim, "  encrypted key kept server-side. re-enable without re-upload."));
    out(paint(c.dim, "  use --purge to wipe it entirely."));
  }
}

// ---------- autonomous: recurring wallet-signed agent tasks (v0.18) ----------
//
// `signa agent autonomous create <addr> "<prompt>" --interval=<sec> [--expires=<sec>]`
// The agent's wallet (loaded from ~/.signa/agents/<addr>.json) signs a
// single envelope that authorizes the SIGNA server to fire the post on
// schedule. Server requires runtime opt-in so it has the encrypted
// agent key to sign each individual post envelope.
//
// `signa agent autonomous list <addr>` — public read of all tasks.
// `signa agent autonomous cancel <addr> <task_id>` — wallet-signed cancel.

async function signSignaAgentAutonomousCreate({
  agentAccount,
  agent,
  prompt,
  interval_seconds,
  expires_at,
  task_kind,
  payment_to,
  payment_token,
  payment_amount_wei,
  ts,
}) {
  // Only include task_kind when it's not "post" — keeps v0.18 envelope
  // signatures byte-identical. Mirrors the server's buildMessageToSign.
  const kindLine =
    task_kind && task_kind !== "post" ? [`task_kind:${task_kind}`] : [];
  // Payment fields included ONLY when kind=payment (v0.22+).
  const paymentLines =
    task_kind === "payment"
      ? [
          `payment_to:${payment_to}`,
          `payment_token:${payment_token}`,
          `payment_amount_wei:${payment_amount_wei}`,
        ]
      : [];
  const authorizationLines =
    task_kind === "payment"
      ? [
          "I authorize SIGNA to broadcast wallet-signed transactions",
          "from this agent on the cadence above, sending the exact",
          "amount and token specified to the exact address specified,",
          "until expiry or until I cancel.",
          `memo:${prompt}`,
        ]
      : [
          "I authorize SIGNA to produce wallet-signed posts from this",
          "agent on the cadence above, using the prompt below as the",
          "text of each post. I can cancel any time.",
          `prompt:${prompt}`,
        ];
  const message = [
    "SIGNA agent autonomous create v1",
    `ts:${ts}`,
    `agent:${agent}`,
    `interval_seconds:${interval_seconds}`,
    `expires_at:${expires_at ?? "never"}`,
    ...kindLine,
    ...paymentLines,
    ...authorizationLines,
  ].join("\n");
  const signature = await agentAccount.signMessage({ message });
  return { signature, message };
}

async function signSignaAgentAutonomousCancel({
  agentAccount,
  agent,
  task_id,
  ts,
}) {
  const message = [
    "SIGNA agent autonomous cancel v1",
    `ts:${ts}`,
    `agent:${agent}`,
    `task:${task_id}`,
  ].join("\n");
  const signature = await agentAccount.signMessage({ message });
  return { signature, message };
}

async function cmdAgentAutonomous(args) {
  const sub = args[0];

  if (sub === "list") {
    const addr = (args[1] ?? "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(addr)) {
      err("usage: agent autonomous list <0x agent_address>");
      bail(2);
    }
    const r = await httpJson(`/api/agents/${addr}/autonomous`);
    const tasks = (r.tasks ?? []).filter((t) => !t.cancelled_at);
    out("");
    out(
      paint(c.bold, "autonomous tasks"),
      paint(c.dim, `· ${addr}`),
    );
    out(paint(c.dim, "─".repeat(72)));
    if (tasks.length === 0) {
      out(paint(c.dim, "no active recurring tasks for this agent."));
      out(
        paint(
          c.dim,
          "  create one with: agent autonomous create " +
            addr +
            ' "<prompt>" --interval=<sec>',
        ),
      );
      return;
    }
    for (const t of tasks) {
      const expIso = t.expires_at ?? "never";
      out(paint(c.cyan, t.id));
      out(
        "  " +
          paint(c.dim, "kind".padEnd(12)) +
          (t.kind === "miroshark_sim"
            ? paint(c.green, "miroshark_sim")
            : t.kind === "payment"
              ? paint(c.yellow, "payment")
              : t.kind || "post"),
      );
      if (t.kind === "payment") {
        const decimals = t.payment_token === "ETH" ? 18 : 6;
        let human = String(t.payment_amount_wei ?? "?");
        try {
          const v4 = await viem();
          human = v4.formatUnits(BigInt(t.payment_amount_wei), decimals);
        } catch {
          // keep the raw fallback
        }
        out(
          "  " +
            paint(c.dim, "pays".padEnd(12)) +
            `${human} ${t.payment_token} → ${paint(c.cyan, t.payment_to ?? "?")}`,
        );
        if (t.last_tx_hash) {
          out(
            "  " +
              paint(c.dim, "last tx".padEnd(12)) +
              paint(c.cyan, t.last_tx_hash) +
              paint(
                c.dim,
                "  basescan.org/tx/" + t.last_tx_hash,
              ),
          );
        }
      }
      out(
        "  " +
          paint(c.dim, "interval".padEnd(12)) +
          `${t.interval_seconds}s`,
      );
      out("  " + paint(c.dim, "expires_at".padEnd(12)) + expIso);
      out(
        "  " +
          paint(c.dim, "next_run".padEnd(12)) +
          (t.next_run_at ?? "?"),
      );
      out(
        "  " +
          paint(c.dim, "runs".padEnd(12)) +
          `${t.runs_total ?? 0} (failed ${t.runs_failed ?? 0})`,
      );
      if (t.last_error) {
        out(
          "  " +
            paint(c.dim, "last_error".padEnd(12)) +
            paint(c.red, String(t.last_error).slice(0, 60)),
        );
      }
      out(
        "  " +
          paint(c.dim, "prompt".padEnd(12)) +
          String(t.prompt ?? "").slice(0, 100),
      );
      out("");
    }
    return;
  }

  if (sub === "cancel") {
    const addr = (args[1] ?? "").toLowerCase();
    const taskId = args[2];
    if (!/^0x[a-f0-9]{40}$/.test(addr) || !/^[0-9a-f-]{36}$/i.test(taskId ?? "")) {
      err("usage: agent autonomous cancel <0x agent_address> <task_id>");
      bail(2);
    }
    const rec = await _readPersistedAgent(addr);
    const v = await viem();
    const agentAccount = v.privateKeyToAccount(rec.private_key);
    const ts = Date.now();
    const { signature } = await signSignaAgentAutonomousCancel({
      agentAccount,
      agent: addr,
      task_id: taskId,
      ts,
    });
    const r = await httpJson(`/api/agents/${addr}/autonomous/${taskId}`, {
      method: "DELETE",
      body: JSON.stringify({ ts, signature }),
    });
    if (!r.ok) {
      err(paint(c.red, "✗"), r.error ?? "cancel failed");
      bail(1);
    }
    out(paint(c.green, "✓"), "task cancelled");
    if (r.already_cancelled) {
      out(paint(c.dim, "  (was already cancelled — no-op)"));
    }
    return;
  }

  if (sub === "create") {
    const addr = (args[1] ?? "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(addr)) {
      err(
        'usage: agent autonomous create <0x agent_address> "<prompt>" --interval=<sec> [--expires=<sec>]',
      );
      bail(2);
    }
    // Pull positional + flag args. Prompt is the next positional, then
    // we expect --interval=N and optionally --expires=N (seconds from
    // now), --kind=post|miroshark-sim|payment, and payment-only:
    //   --to=0x...
    //   --token=ETH|USDC
    //   --amount=<decimal>  (in human units; we convert to wei/USDC units)
    let prompt = null;
    let interval = null;
    let expiresInSec = null;
    let task_kind = "post";
    let pay_to = null;
    let pay_token = null;
    let pay_amount = null;
    for (let i = 2; i < args.length; i++) {
      const a = args[i];
      if (a.startsWith("--interval=")) {
        interval = Math.floor(Number(a.slice("--interval=".length)));
      } else if (a.startsWith("--expires=")) {
        expiresInSec = Math.floor(Number(a.slice("--expires=".length)));
      } else if (a.startsWith("--kind=")) {
        // Accept the friendly "miroshark-sim" CLI form AND the canonical
        // "miroshark_sim" wire form. Normalize before signing so the
        // signature matches what the server expects.
        const raw = a.slice("--kind=".length).trim().toLowerCase();
        task_kind = raw === "miroshark-sim" ? "miroshark_sim" : raw;
      } else if (a.startsWith("--to=")) {
        pay_to = a.slice("--to=".length).trim().toLowerCase();
      } else if (a.startsWith("--token=")) {
        pay_token = a.slice("--token=".length).trim().toUpperCase();
      } else if (a.startsWith("--amount=")) {
        pay_amount = a.slice("--amount=".length).trim();
      } else if (prompt === null) {
        prompt = a;
      } else {
        prompt += " " + a;
      }
    }
    if (!prompt) {
      err('autonomous create needs a "<prompt>" string');
      bail(2);
    }
    if (!Number.isFinite(interval) || interval < 60) {
      err("interval must be >= 60 seconds (e.g. --interval=3600 for hourly)");
      bail(2);
    }
    if (
      task_kind !== "post" &&
      task_kind !== "miroshark_sim" &&
      task_kind !== "payment"
    ) {
      err(`invalid --kind=${task_kind}. valid: post, miroshark-sim, payment`);
      bail(2);
    }

    // Payment kind needs the (to, token, amount) trio. We convert the
    // human-readable amount to its smallest unit (wei for ETH, microUSDC
    // for USDC) HERE so the server only ever sees the integer.
    let payment_to_normalized = null;
    let payment_token_normalized = null;
    let payment_amount_wei_str = null;
    if (task_kind === "payment") {
      if (!pay_to || !/^0x[a-f0-9]{40}$/.test(pay_to)) {
        err("--to=0x<address> is required for --kind=payment");
        bail(2);
      }
      if (pay_token !== "ETH" && pay_token !== "USDC") {
        err("--token=ETH or --token=USDC is required for --kind=payment");
        bail(2);
      }
      const amountNum = Number(pay_amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        err("--amount=<positive decimal> is required for --kind=payment");
        bail(2);
      }
      const decimals = pay_token === "ETH" ? 18 : 6;
      // BigInt-safe conversion: use string ops so we don't lose precision
      // on small fractions. We use viem.parseUnits when available below.
      const v2 = await viem();
      try {
        payment_amount_wei_str = v2.parseUnits(String(pay_amount), decimals).toString();
      } catch {
        err(`couldn't parse --amount=${pay_amount} as a ${pay_token} value`);
        bail(2);
      }
      payment_to_normalized = pay_to;
      payment_token_normalized = pay_token;
    }

    const expires_at =
      expiresInSec && Number.isFinite(expiresInSec) && expiresInSec > 0
        ? Math.floor(Date.now() / 1000) + expiresInSec
        : null;

    const rec = await _readPersistedAgent(addr);
    const v = await viem();
    const agentAccount = v.privateKeyToAccount(rec.private_key);
    const ts = Date.now();
    const { signature } = await signSignaAgentAutonomousCreate({
      agentAccount,
      agent: addr,
      prompt,
      interval_seconds: interval,
      expires_at,
      task_kind,
      payment_to: payment_to_normalized,
      payment_token: payment_token_normalized,
      payment_amount_wei: payment_amount_wei_str,
      ts,
    });

    const r = await httpJson(`/api/agents/${addr}/autonomous`, {
      method: "POST",
      body: JSON.stringify({
        prompt,
        interval_seconds: interval,
        expires_at,
        kind: task_kind,
        ts,
        signature,
        ...(task_kind === "payment"
          ? {
              payment_to: payment_to_normalized,
              payment_token: payment_token_normalized,
              payment_amount_wei: payment_amount_wei_str,
            }
          : {}),
      }),
    });
    if (!r.ok || !r.task) {
      err(paint(c.red, "✗"), r.error ?? "create failed");
      if (r.hint) err(paint(c.dim, "  " + r.hint));
      bail(1);
    }
    out("");
    out(paint(c.green, "✓"), "autonomous task created");
    out(paint(c.dim, "task_id".padEnd(14)), paint(c.cyan, r.task.id));
    out(paint(c.dim, "agent".padEnd(14)), addr);
    out(
      paint(c.dim, "kind".padEnd(14)),
      r.task.kind === "payment"
        ? paint(c.yellow, "payment")
        : r.task.kind === "miroshark_sim"
          ? paint(c.green, "miroshark_sim")
          : "post",
    );
    out(
      paint(c.dim, "interval".padEnd(14)),
      `${r.task.interval_seconds}s`,
    );
    out(
      paint(c.dim, "expires_at".padEnd(14)),
      r.task.expires_at ?? paint(c.dim, "never"),
    );
    if (r.task.kind === "payment") {
      out(paint(c.dim, "to".padEnd(14)), paint(c.cyan, r.task.payment_to));
      out(
        paint(c.dim, "token".padEnd(14)),
        paint(c.bold, r.task.payment_token),
      );
      // Format amount human-style alongside the raw wei
      const v3 = await viem();
      const decimals = r.task.payment_token === "ETH" ? 18 : 6;
      let human = String(r.task.payment_amount_wei);
      try {
        human = v3.formatUnits(
          BigInt(r.task.payment_amount_wei),
          decimals,
        );
      } catch {
        // keep the raw fallback
      }
      out(
        paint(c.dim, "amount".padEnd(14)),
        `${human} ${r.task.payment_token}  ${paint(c.dim, "(" + r.task.payment_amount_wei + " raw units)")}`,
      );
    }
    out(paint(c.dim, "next_run".padEnd(14)), r.task.next_run_at);
    out("");
    out(
      paint(
        c.dim,
        r.task.kind === "payment"
          ? "  the cron will broadcast an EIP-1559 tx on Base mainnet every tick."
          : "  the SIGNA cron fires every minute. the first post lands at the next_run_at above.",
      ),
    );
    return;
  }

  err("unknown autonomous subcommand. try one of:");
  err('  agent autonomous create <addr> "<prompt>" --interval=<sec> [--expires=<sec>]');
  err("  agent autonomous list <addr>");
  err("  agent autonomous cancel <addr> <task_id>");
  bail(2);
}

// ---------- digest: daily AI digest opt-in ----------

async function signSignaDigestToggle({ address, enabled, ts }) {
  const acc = await account();
  const message = [
    `SIGNA digest ${enabled ? "subscribe" : "unsubscribe"} v1`,
    `ts:${ts}`,
    `address:${address}`,
    enabled
      ? "I subscribe to a daily AI digest DM from SIGNA."
      : "I unsubscribe from the daily SIGNA digest.",
  ].join("\n");
  const signature = await acc.viemAccount.signMessage({ message });
  return { signature, message };
}

async function cmdDigest(args) {
  const sub = args[0];
  if (sub !== "enable" && sub !== "disable" && sub !== "on" && sub !== "off") {
    err("usage:");
    err("  digest enable        opt in to the daily AI digest DM");
    err("  digest disable       opt out");
    bail(2);
  }
  const enabled = sub === "enable" || sub === "on";
  const acc = await account();
  const addr = acc.address.toLowerCase();
  const ts = Date.now();
  const { signature } = await signSignaDigestToggle({
    address: addr,
    enabled,
    ts,
  });
  const r = await httpJson("/api/me/digest", {
    method: "POST",
    body: JSON.stringify({ address: addr, enabled, ts, signature }),
  });
  if (!r.ok) {
    err(paint(c.red, "✗"), r.error ?? "digest toggle failed");
    bail(1);
  }
  out(
    paint(c.green, "✓"),
    enabled
      ? "subscribed to the daily SIGNA digest"
      : "unsubscribed from the SIGNA digest",
  );
  out(paint(c.dim, `  address: ${addr}`));
  if (enabled) {
    out(paint(c.dim, "  you'll get a wallet-signed digest post once per 24h."));
  }
}

// ---------- holders: top SIGNA users holding a partner token ----------

async function cmdHolders(args) {
  const symbol = (args[0] ?? "").replace(/^\$/, "").toUpperCase();
  if (!symbol) {
    err("usage: holders <SYMBOL>");
    err("  e.g.  holders BNKR | holders GITLAWB | holders MIROSHARK | holders USDC");
    bail(2);
  }
  const r = await httpJson(`/api/holders/${symbol}`).catch(() => null);
  if (!r?.ok) {
    err(paint(c.red, "✗"), `no holders index for $${symbol}`);
    err(paint(c.dim, "  supported partner tokens: BNKR, GITLAWB, MIROSHARK, USDC"));
    bail(1);
  }
  const holders = r.holders ?? [];
  if (holders.length === 0) {
    out(paint(c.dim, `no SIGNA users currently hold $${symbol}.`));
    return;
  }
  out("");
  out(paint(c.bold, `top $${symbol} holders on SIGNA`), paint(c.dim, `(${holders.length} wallets)`));
  out(paint(c.dim, "─".repeat(72)));
  out(
    paint(c.bold, " ADDRESS".padEnd(16)) +
      paint(c.bold, " HANDLE".padEnd(28)) +
      paint(c.bold, " BALANCE"),
  );
  out(paint(c.dim, "─".repeat(72)));
  for (const h of holders.slice(0, 25)) {
    const short = h.address.slice(0, 6) + "…" + h.address.slice(-4);
    const handle = h.basename || h.ens_name || paint(c.dim, "—");
    const bal =
      typeof h.amount === "string" || typeof h.amount === "number"
        ? String(h.amount).slice(0, 14)
        : "?";
    out(
      " " +
        paint(c.cyan, short.padEnd(15)) +
        " " +
        String(handle).padEnd(27) +
        " " +
        bal,
    );
  }
}

// ---------- chat: 1-on-1 wallet conversation ----------
//
// `signa chat <handle>` opens an interactive sub-shell where every line
// is signed + sent as a `@<their_addr> <msg>` post. We pull bidirectional
// thread history on entry and on each input (lazy poll). Both sides see
// the conversation through `signa inbox` / `signa watch`.
//
// REPL integration: when invoked from inside `signa` REPL, we set
// CHAT_MODE (module-level) so the outer REPL's input loop routes each
// line through chat-line semantics until the user types `:q`. Standalone
// invocation (signa chat <h> from cmd) runs its own loop here.

let CHAT_MODE = null; // { their_address, their_handle, my_address, last_seen_at }
const CHAT_HISTORY_LIMIT = 20;
const CHAT_POLL_TICKS = 4000;

function sanitizeForDisplay(s) {
  // Strip ANSI/control bytes from untrusted message content so a
  // malicious post can't repaint our terminal.
  return (s ?? "").replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

async function resolveChatHandle(handle) {
  let addr = handle;
  if (!/^0x[a-fA-F0-9]{40}$/.test(handle)) {
    const r = await httpJson(
      `/api/users/resolve?handle=${encodeURIComponent(handle)}`,
    ).catch(() => null);
    if (!r?.address) return null;
    addr = r.address;
  }
  return { address: addr.toLowerCase(), display: handle };
}

async function fetchChatThread(myAddr, theirAddr, sinceIso) {
  // Two queries: messages they sent that mention me, and messages I sent
  // that mention them. Merge + sort by created_at asc. Server filters by
  // mentions ILIKE — case-insensitive 0x match works since we lower-case
  // both sides before storing.
  const [theyToMe, meToThem] = await Promise.all([
    httpJson(
      `/api/posts?author=${theirAddr}&mentions=${myAddr}&limit=${CHAT_HISTORY_LIMIT}`,
    ).catch(() => ({ posts: [] })),
    httpJson(
      `/api/posts?author=${myAddr}&mentions=${theirAddr}&limit=${CHAT_HISTORY_LIMIT}`,
    ).catch(() => ({ posts: [] })),
  ]);
  const all = [...(theyToMe.posts ?? []), ...(meToThem.posts ?? [])]
    .filter((p) => !sinceIso || p.created_at > sinceIso)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return all;
}

function stripMentionPrefix(content, theirAddr, myAddr) {
  // Posts are stored with the @0x... mention inline. For display we hide
  // the leading "@0x..." token from whichever side is the addressee, so
  // the conversation reads naturally.
  let s = content ?? "";
  for (const addr of [theirAddr, myAddr]) {
    const re = new RegExp(`^@${addr}\\s+`, "i");
    s = s.replace(re, "");
  }
  return s;
}

function printChatMessage(msg, ctx) {
  const mine = msg.author_address.toLowerCase() === ctx.my_address;
  const who = mine ? "you" : ctx.their_handle;
  const color = mine ? c.green : c.cyan;
  const ts = new Date(msg.created_at).toISOString().slice(11, 16);
  const body = sanitizeForDisplay(
    stripMentionPrefix(msg.content, ctx.their_address, ctx.my_address),
  );
  out(paint(c.dim, ts) + " " + paint(color, who + " ›") + " " + body);
}

async function sendChatLine(ctx, line) {
  // Transport-aware send. XMTP path goes peer-to-peer through the
  // XMTP relay mesh; the posts path is the wallet-signed @-mention
  // fallback for recipients without an XMTP identity.
  if (ctx.transport === "xmtp") {
    return _sendChatLineXmtp(ctx, line);
  }
  return _sendChatLinePosts(ctx, line);
}

async function _sendChatLinePosts(ctx, line) {
  const content = `@${ctx.their_address} ${line}`;
  const ts = Date.now();
  const { signature } = await signSignaPost({ content, ts });
  const r = await postWithAutoRegister({
    author_address: ctx.my_address,
    content,
    ts,
    signature,
  });
  // Print our own line locally so the user sees confirmation without
  // waiting for the next poll. The poll will dedupe via cursor.
  if (r?.post) {
    printChatMessage(
      {
        author_address: ctx.my_address,
        created_at: r.post.created_at ?? new Date().toISOString(),
        content,
      },
      ctx,
    );
    ctx.last_seen_at = r.post.created_at ?? new Date().toISOString();
  }
}

async function _sendChatLineXmtp(ctx, line) {
  if (!ctx.xmtp_dm) {
    err(paint(c.red, "✗"), "xmtp dm not initialized — falling back to posts");
    ctx.transport = "posts";
    return _sendChatLinePosts(ctx, line);
  }
  await ctx.xmtp_dm.send(line);
  // Display our own line immediately. We don't synthesize created_at
  // from anything — printChatMessage will render with the current wall
  // time as a hint.
  printChatMessage(
    {
      author_address: ctx.my_address,
      created_at: new Date().toISOString(),
      content: line,
    },
    ctx,
  );
}

async function pollAndShowChat(ctx) {
  if (ctx.transport === "xmtp") {
    return _pollChatXmtp(ctx);
  }
  return _pollChatPosts(ctx);
}

async function _pollChatPosts(ctx) {
  const msgs = await fetchChatThread(
    ctx.my_address,
    ctx.their_address,
    ctx.last_seen_at,
  );
  for (const m of msgs) {
    if (m.created_at <= ctx.last_seen_at) continue;
    printChatMessage(m, ctx);
    ctx.last_seen_at = m.created_at;
  }
}

async function _pollChatXmtp(ctx) {
  if (!ctx.xmtp_dm) return;
  try {
    await ctx.xmtp_dm.sync();
    const msgs = await ctx.xmtp_dm.messages({ limit: 20 });
    // XMTP returns newest-first by default in v4; we want chronological.
    const ordered = msgs.slice().reverse();
    for (const m of ordered) {
      const sentNs = m.sentAtNs; // bigint nanoseconds
      const sentIso = sentNs
        ? new Date(Number(sentNs / 1_000_000n)).toISOString()
        : new Date().toISOString();
      if (sentIso <= ctx.last_seen_at) continue;
      if (m.contentType?.typeId === "group_updated") continue;
      // skip echoes of our own outbound (we already printed locally)
      if (m.senderInboxId === ctx.my_xmtp_inbox) {
        ctx.last_seen_at = sentIso;
        continue;
      }
      const body = (() => {
        try {
          return typeof m.content === "string"
            ? m.content
            : JSON.stringify(m.content);
        } catch {
          return "(non-string content)";
        }
      })();
      const ts = sentIso.slice(11, 16);
      out(
        paint(c.dim, ts) +
          " " +
          paint(c.cyan, ctx.their_handle + " ›") +
          " " +
          sanitizeForDisplay(body),
      );
      ctx.last_seen_at = sentIso;
    }
  } catch {
    // ignore — next poll will retry
  }
}

async function enterChat(handleArg, opts = {}) {
  const acc = await account();
  const them = await resolveChatHandle(handleArg);
  if (!them) {
    err(paint(c.red, "✗"), `couldn't resolve "${handleArg}"`);
    return null;
  }
  const myAddr = acc.address.toLowerCase();
  if (them.address === myAddr) {
    err(paint(c.yellow, "!"), "you can chat with yourself, but it's a small audience.");
  }

  // ---- transport selection ----
  // auto  : prefer xmtp if both wallets are reachable, fall back to posts
  // xmtp  : force xmtp (bails if recipient isn't on XMTP)
  // posts : force the wallet-signed @-mention path even if xmtp is available
  const requested = opts.transport ?? "auto";
  let transport = "posts";
  let xClient = null;
  let xDm = null;

  if (requested === "xmtp" || requested === "auto") {
    const m = await xmtp({ soft: requested === "auto" });
    if (m) {
      // Pre-flight reachability check before paying the cost of opening
      // the local client — saves ~3-5s when the recipient isn't on XMTP.
      const reachable = await xmtpReachable(them.address);
      if (reachable) {
        try {
          xClient = await xmtpClient();
          xDm = await xClient.conversations.newDmWithIdentifier({
            identifier: them.address,
            identifierKind: 0,
          });
          transport = "xmtp";
        } catch (e) {
          if (requested === "xmtp") {
            err(paint(c.red, "✗"), `xmtp init failed: ${e?.message ?? e}`);
            return null;
          }
          // auto: silent fallback
        }
      } else if (requested === "xmtp") {
        err(
          paint(c.red, "✗"),
          `${them.address} has no XMTP V3 identity registered.`,
        );
        err(paint(c.dim, "  use --transport=posts or just 'chat' (auto) for the wallet-signed path"));
        return null;
      }
    }
  }

  const ctx = {
    transport,
    their_address: them.address,
    their_handle: them.display,
    my_address: myAddr,
    my_xmtp_inbox: xClient?.inboxId ?? null,
    xmtp_client: xClient,
    xmtp_dm: xDm,
    last_seen_at: "1970-01-01T00:00:00Z",
  };

  out("");
  const transportTag =
    transport === "xmtp"
      ? paint(c.green, "[xmtp · E2E]")
      : paint(c.yellow, "[posts · wallet-signed]");
  out(
    paint(c.bold, "chat") +
      " · " +
      paint(c.cyan, ctx.their_handle) +
      " " +
      paint(c.dim, "(" + ctx.their_address + ")") +
      " " +
      transportTag,
  );
  if (transport === "xmtp") {
    out(
      paint(
        c.dim,
        "  delivery: XMTP relay mesh · libsignal double-ratchet · signa.xyz NOT in the path",
      ),
    );
  } else {
    out(
      paint(
        c.dim,
        "  delivery: wallet-signed @-mention via /api/posts · server-verified signature",
      ),
    );
  }
  out(paint(c.dim, "  type ':q' or 'exit' to leave · enter empty line to refresh"));
  out(paint(c.dim, "─".repeat(72)));

  // Initial history pull (transport-specific)
  await pollAndShowChat(ctx);
  return ctx;
}

async function cmdChat(args, { fromRepl = false, replRl = null } = {}) {
  // Parse --transport=auto|xmtp|posts (default: auto)
  let transport = "auto";
  const positional = [];
  for (const a of args) {
    if (a.startsWith("--transport=")) transport = a.slice(12);
    else positional.push(a);
  }
  const handle = positional[0];
  if (!handle) {
    err("usage: chat <0x...|basename|ens> [--transport=auto|xmtp|posts]");
    err("  auto  (default): use XMTP if recipient is reachable, else wallet-signed posts");
    err("  xmtp           : force XMTP — fails if recipient has no XMTP identity");
    err("  posts          : force the wallet-signed @-mention path");
    bail(2);
  }
  if (!["auto", "xmtp", "posts"].includes(transport)) {
    err(`invalid --transport=${transport}. expected auto, xmtp, or posts.`);
    bail(2);
  }
  const ctx = await enterChat(handle, { transport });
  if (!ctx) bail(1);

  if (fromRepl && replRl) {
    // Hand control back to the outer REPL — it'll route subsequent lines
    // through the CHAT_MODE branch until the user types `:q`.
    CHAT_MODE = ctx;
    replRl.setPrompt(chatPromptFor(ctx));
    return;
  }

  // Standalone — run our own line loop with a fresh readline.
  const rl = createInterface({
    input: stdin,
    output: stdout,
    prompt: chatPromptFor(ctx),
    terminal: true,
  });
  await runLongRunning(async (stop) => {
    stop.onstop = () => {
      try { rl.close(); } catch {}
    };
    try {
      rl.prompt();
    } catch {
      // already closed (e.g. non-TTY EOF on entry)
    }
    for await (const rawLine of rl) {
      if (stop.stopped) break;
      const line = rawLine.trim();
      if (line === ":q" || line === "exit" || line === "quit") {
        break;
      }
      if (line.length > 0) {
        try {
          await sendChatLine(ctx, line);
        } catch (e) {
          err(paint(c.red, "send failed:"), e?.message ?? e);
        }
      }
      try {
        await pollAndShowChat(ctx);
      } catch {
        // ignore — next poll will retry
      }
      if (stop.stopped) break;
      // Guard prompt() — if stdin reached EOF (piped input, last line
      // was the final one), readline auto-closes between our iteration
      // exit and the next yield. Calling prompt() on a closing interface
      // throws ERR_USE_AFTER_CLOSE.
      try {
        rl.prompt();
      } catch {
        break;
      }
    }
  });
  try { rl.close(); } catch {}
  out(paint(c.dim, `left chat with ${ctx.their_handle}.`));
}

function chatPromptFor(ctx) {
  if (NO_COLOR) return `@${ctx.their_handle} > `;
  return `\x1b[38;2;91;141;239m@${ctx.their_handle} ›\x1b[0m `;
}

// ---------- partner integrations ----------
//
// CLI surface for the four partner stacks SIGNA composes with:
//   aeon       — ERC-8004 Identity Registry on Ethereum mainnet
//                  read-only · pure on-chain · no signa server in the path
//   gitlawb    — DID-bound decentralized git
//                  wallet-signed link/unlink against /api/users/link-gitlawb
//   bankr      — agent-token trading via the user's Bankr Agent key
//                  wallet-signed trade execution against /api/me/trade
//                  (connect is intentionally web-only — see SECURITY note)
//   miroshark  — swarm-intelligence simulation
//                  gateway-routed via the swarm intent
//
// SECURITY: `signa bankr connect <api_key>` is NOT exposed in the CLI.
// API keys pasted on a command line land in shell history (~/.bash_history,
// ~/.zsh_history, cmd doskey buffer). That's an unacceptable persistence
// path for a credential the user expects to be encrypted. Users connect
// the key on the website (where a password input handles it); the CLI
// inherits the connection via wallet signature.

// ----- aeon (ERC-8004) -----

const ERC8004_ABI = [
  {
    type: "function",
    name: "agentURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

async function ethClient() {
  const vi = await viem();
  return vi.createPublicClient({
    chain: vi.mainnet ?? (await import("viem/chains")).mainnet,
    transport: vi.http(ETH_RPC),
  });
}

async function fetchAgentRegistration(uri) {
  if (!uri) return null;
  try {
    if (uri.startsWith("data:")) {
      const comma = uri.indexOf(",");
      if (comma < 0) return null;
      const meta = uri.slice(5, comma);
      const payload = uri.slice(comma + 1);
      const decoded = meta.includes("base64")
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
      return JSON.parse(decoded);
    }
    if (uri.startsWith("ipfs://")) {
      const cid = uri.slice(7).replace(/^ipfs\//, "");
      const res = await fetch(`https://ipfs.io/ipfs/${cid}`);
      if (!res.ok) return null;
      return await res.json();
    }
    const res = await fetch(uri);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function cmdAeon(args) {
  const sub = args[0];
  if (sub === "resolve") {
    const idArg = args[1];
    if (!idArg) {
      err("usage: aeon resolve <token_id>");
      bail(2);
    }
    let tokenId;
    try {
      tokenId = BigInt(idArg);
    } catch {
      err("token_id must be an integer");
      bail(2);
    }
    const client = await ethClient();
    let uri;
    let owner;
    try {
      [uri, owner] = await Promise.all([
        client.readContract({
          address: ERC8004_REGISTRY,
          abi: ERC8004_ABI,
          functionName: "agentURI",
          args: [tokenId],
        }),
        client.readContract({
          address: ERC8004_REGISTRY,
          abi: ERC8004_ABI,
          functionName: "ownerOf",
          args: [tokenId],
        }),
      ]);
    } catch (e) {
      err(paint(c.red, "✗"), `token #${idArg} not found or RPC failed: ${e?.shortMessage ?? e?.message ?? e}`);
      bail(1);
    }
    const registration = await fetchAgentRegistration(uri);
    out("");
    out(paint(c.bold, "ERC-8004 agent #" + idArg.toString()));
    out(paint(c.dim, "─".repeat(48)));
    out(paint(c.dim, "owner".padEnd(14)), paint(c.cyan, owner));
    out(paint(c.dim, "registry".padEnd(14)), ERC8004_REGISTRY);
    out(paint(c.dim, "uri".padEnd(14)), uri);
    if (registration) {
      if (registration.name) out(paint(c.dim, "name".padEnd(14)), paint(c.bold, String(registration.name)));
      if (registration.description) out(paint(c.dim, "desc".padEnd(14)), String(registration.description));
      if (Array.isArray(registration.services) && registration.services.length > 0) {
        out(paint(c.dim, "services".padEnd(14)));
        for (const s of registration.services.slice(0, 4)) {
          out(paint(c.dim, "  • " + (s.name ?? "?")), paint(c.dim, s.endpoint ?? ""));
        }
      }
      if (registration.x402Support === true) {
        out(paint(c.dim, "x402".padEnd(14)), paint(c.green, "supported"));
      }
    } else {
      out(paint(c.yellow, "  (couldn't resolve metadata from URI)"));
    }
    out("");
    out(paint(c.dim, "  source: ethereum mainnet · no signa server in the path"));
    return;
  }
  if (sub === "balance") {
    const addr = args[1];
    if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      err("usage: aeon balance <0x address>");
      bail(2);
    }
    const client = await ethClient();
    let bal;
    try {
      bal = await client.readContract({
        address: ERC8004_REGISTRY,
        abi: ERC8004_ABI,
        functionName: "balanceOf",
        args: [addr],
      });
    } catch (e) {
      err(paint(c.red, "✗"), `read failed: ${e?.shortMessage ?? e?.message ?? e}`);
      bail(1);
    }
    out("");
    out(paint(c.bold, "ERC-8004 token balance"));
    out(paint(c.dim, "─".repeat(48)));
    out(paint(c.dim, "address".padEnd(14)), paint(c.cyan, addr));
    out(paint(c.dim, "registered".padEnd(14)), paint(c.bold, String(bal)) + " " + paint(c.dim, "agent token(s)"));
    out(paint(c.dim, "registry".padEnd(14)), ERC8004_REGISTRY);
    out("");
    return;
  }
  if (sub === "agent") {
    // Convenience: look up the ERC-8004 registration BOUND TO a signa
    // agent. We pull the agent's record from /api/agents/<addr> to get
    // the recorded erc8004_token_id, then resolve it on-chain.
    const sAddr = (args[1] ?? "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(sAddr)) {
      err("usage: aeon agent <0x signa_agent_address>");
      bail(2);
    }
    const r = await httpJson(`/api/agents/${sAddr}`).catch(() => null);
    const agent = r?.agent;
    if (!agent) {
      err(paint(c.red, "✗"), `signa agent ${sAddr} not found`);
      bail(1);
    }
    const tokenId = agent.erc8004_token_id;
    out("");
    out(paint(c.bold, "aeon registration for signa agent"));
    out(paint(c.dim, "─".repeat(64)));
    out(paint(c.dim, "agent".padEnd(14)), paint(c.cyan, agent.address));
    out(paint(c.dim, "name".padEnd(14)), agent.name ?? "?");
    if (!tokenId) {
      out(paint(c.dim, "erc8004".padEnd(14)), paint(c.yellow, "not registered"));
      out(paint(c.dim, "  the agent's owner can register on https://www.8004.org"));
      return;
    }
    out(paint(c.dim, "token_id".padEnd(14)), paint(c.cyan, String(tokenId)));
    // Resolve on-chain to confirm
    const client = await ethClient();
    try {
      const [uri, owner] = await Promise.all([
        client.readContract({
          address: ERC8004_REGISTRY,
          abi: ERC8004_ABI,
          functionName: "agentURI",
          args: [BigInt(tokenId)],
        }),
        client.readContract({
          address: ERC8004_REGISTRY,
          abi: ERC8004_ABI,
          functionName: "ownerOf",
          args: [BigInt(tokenId)],
        }),
      ]);
      out(paint(c.dim, "on-chain owner".padEnd(14)), paint(c.cyan, owner));
      out(paint(c.dim, "agent uri".padEnd(14)), uri);
      out(paint(c.green, "✓"), "verified on Ethereum mainnet");
    } catch (e) {
      err(paint(c.yellow, "!"), `on-chain resolve failed: ${e?.shortMessage ?? e?.message ?? e}`);
    }
    return;
  }
  err("usage:");
  err("  aeon resolve <token_id>            fetch ERC-8004 agent metadata from chain");
  err("  aeon balance <0x address>          count ERC-8004 tokens owned");
  err("  aeon agent <0x signa_agent_addr>   show ERC-8004 binding for a signa agent");
  bail(2);
}

// ----- gitlawb -----

async function signSignaLinkGitlawb({ address, gitlawb_did, ts }) {
  // Mirrors buildMessageToSign("link_gitlawb") on the server.
  const acc = await account();
  const message = [
    "SIGNA link gitlawb v1",
    `ts:${ts}`,
    `address:${address}`,
    `gitlawb_did:${gitlawb_did}`,
    "I attach this gitlawb DID to my SIGNA profile.",
  ].join("\n");
  const signature = await acc.viemAccount.signMessage({ message });
  return { signature, message };
}

/**
 * Direct fetch against gitlawb.com (or any gitlawb node). No signa
 * server in the path — this is the partner-integrated decentralization
 * piece for gitlawb. If signaagent.xyz disappears, these commands
 * keep working as long as the gitlawb node is up.
 */
async function gitlawbFetch(path) {
  try {
    const res = await fetch(`${GITLAWB_NODE}${path}`, {
      headers: {
        accept: "application/json",
        "user-agent": `signa-cli/${VERSION}`,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function cmdGitlawb(args) {
  const sub = args[0];

  // ----- direct-read commands (no signa, no wallet) -----

  if (sub === "resolve") {
    const did = (args[1] ?? "").trim();
    if (!did) {
      err("usage: gitlawb resolve <did:key:z6Mk... | did:gitlawb:<slug>>");
      bail(2);
    }
    out(paint(c.dim, `querying ${GITLAWB_NODE}…`));
    const repos = await gitlawbFetch(
      `/api/v1/repos?owner=${encodeURIComponent(did)}&limit=20`,
    );
    const tasks = await gitlawbFetch(
      `/tasks?assignee=${encodeURIComponent(did)}&status=open&limit=50`,
    );
    out("");
    out(paint(c.bold, "gitlawb profile"));
    out(paint(c.dim, "─".repeat(72)));
    out(paint(c.dim, "did".padEnd(14)), paint(c.cyan, did));
    out(paint(c.dim, "node".padEnd(14)), GITLAWB_NODE);
    const repoList = repos?.repos ?? [];
    out(paint(c.dim, "repos".padEnd(14)), paint(c.cyan, String(repoList.length)));
    const taskList = tasks?.tasks ?? [];
    out(paint(c.dim, "open tasks".padEnd(14)), paint(c.cyan, String(taskList.length)));
    if (repoList.length > 0) {
      out("");
      out(paint(c.bold, "recent repos"));
      for (const r of repoList.slice(0, 8)) {
        const name = r.name ?? "?";
        out("  " + paint(c.cyan, name) + " " + paint(c.dim, (r.description ?? "").slice(0, 60)));
      }
    }
    if (taskList.length > 0) {
      out("");
      out(paint(c.bold, "open tasks"));
      for (const t of taskList.slice(0, 5)) {
        const bounty = t.bounty
          ? `${t.bounty.amount ?? "?"} ${t.bounty.token ?? ""}`
          : "";
        out(
          "  " +
            paint(c.yellow, (t.title ?? "?").slice(0, 50)) +
            " " +
            paint(c.dim, bounty),
        );
      }
    }
    out("");
    out(paint(c.dim, "  source: " + GITLAWB_NODE + " · no signa server in the path"));
    return;
  }

  if (sub === "repos") {
    let owner = null;
    let limit = 20;
    for (const a of args.slice(1)) {
      if (a.startsWith("--owner=")) owner = a.slice(8);
      else if (a.startsWith("--limit=")) limit = Math.max(1, Number(a.slice(8)) || 20);
    }
    const path = owner
      ? `/api/v1/repos?owner=${encodeURIComponent(owner)}&limit=${limit}`
      : `/api/v1/repos?limit=${limit}`;
    const r = await gitlawbFetch(path);
    const repos = r?.repos ?? [];
    out("");
    out(
      paint(c.bold, owner ? `repos for ${owner}` : "recent repos on gitlawb"),
      paint(c.dim, `(${GITLAWB_NODE})`),
    );
    out(paint(c.dim, "─".repeat(72)));
    if (repos.length === 0) {
      out(paint(c.dim, "  no repos found."));
      return;
    }
    for (const r of repos.slice(0, limit)) {
      const name = `${r.owner ?? "?"}/${r.name ?? "?"}`;
      const desc = (r.description ?? "").slice(0, 60);
      out(" " + paint(c.cyan, name) + "  " + paint(c.dim, desc));
    }
  }

  if (sub === "playground") {
    const prompt = args.slice(1).join(" ").trim();
    if (!prompt) {
      err('usage: gitlawb playground "<prompt to seed playground>"');
      bail(2);
    }
    const url = `${GITLAWB_PLAYGROUND}/?prompt=${encodeURIComponent(prompt)}`;
    out("");
    out(paint(c.bold, "gitlawb playground"), paint(c.dim, "→ paste into your browser"));
    out(paint(c.dim, "─".repeat(72)));
    out(paint(c.cyan, url));
    out("");
    out(paint(c.dim, "  opens a fresh Playground session pre-loaded with your prompt."));
    return;
  }

  // ----- wallet-signed commands (link/unlink/status) — existing -----

  const acc = await account();
  const addr = acc.address.toLowerCase();

  if (sub === "link") {
    const did = (args[1] ?? "").trim();
    if (!did || !/^did:(key|gitlawb):[a-zA-Z0-9_-]+$/.test(did)) {
      err("usage: gitlawb link <did:key:z6Mk... | did:gitlawb:<slug>>");
      bail(2);
    }
    const ts = Date.now();
    const { signature } = await signSignaLinkGitlawb({
      address: addr,
      gitlawb_did: did,
      ts,
    });
    const r = await httpJson("/api/users/link-gitlawb", {
      method: "POST",
      body: JSON.stringify({ address: addr, gitlawb_did: did, ts, signature }),
    });
    if (!r.ok) {
      err(paint(c.red, "✗"), r.error ?? "link failed");
      bail(1);
    }
    out(paint(c.green, "✓"), "linked");
    out(paint(c.dim, "did".padEnd(14)), paint(c.cyan, did));
    out(paint(c.dim, "address".padEnd(14)), addr);
    return;
  }

  if (sub === "unlink") {
    const ts = Date.now();
    const { signature } = await signSignaLinkGitlawb({
      address: addr,
      gitlawb_did: "",
      ts,
    });
    const r = await httpJson("/api/users/link-gitlawb", {
      method: "POST",
      body: JSON.stringify({ address: addr, gitlawb_did: "", ts, signature }),
    });
    if (!r.ok) {
      err(paint(c.red, "✗"), r.error ?? "unlink failed");
      bail(1);
    }
    out(paint(c.green, "✓"), "gitlawb DID unlinked");
    return;
  }

  if (sub === "status") {
    const r = await httpJson(
      `/api/users/resolve?handle=${addr}`,
    ).catch(() => null);
    out("");
    out(paint(c.bold, "gitlawb status"));
    out(paint(c.dim, "─".repeat(48)));
    out(paint(c.dim, "address".padEnd(14)), paint(c.cyan, addr));
    if (r?.gitlawb_did) {
      out(paint(c.dim, "did".padEnd(14)), paint(c.green, r.gitlawb_did));
    } else {
      out(paint(c.dim, "did".padEnd(14)), paint(c.dim, "(none linked)"));
      out(
        paint(c.dim, "  link with:"),
        paint(c.cyan, "signa gitlawb link did:key:..."),
      );
    }
    out("");
    return;
  }

  if (sub === "stats") {
    const sAddr = (args[1] ?? "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(sAddr)) {
      err("usage: gitlawb stats <0x signa_wallet_address>");
      bail(2);
    }
    let r;
    try {
      r = await httpJson(`/api/agents/${sAddr}/gitlawb-stats`);
    } catch (e) {
      const msg = e?.message ?? String(e);
      // 404 → no DID bound, 502 → node unreachable. Distinguish both.
      if (msg.includes("HTTP 404")) {
        err(paint(c.yellow, "!"), "no gitlawb DID bound to that wallet.");
        err(
          paint(c.dim, "  link one first:"),
          paint(c.cyan, "signa gitlawb link did:key:..."),
        );
        bail(1);
      }
      if (msg.includes("HTTP 502")) {
        err(paint(c.red, "✗"), "node.gitlawb.com is unreachable right now.");
        bail(1);
      }
      err(paint(c.red, "✗"), msg);
      bail(1);
    }
    if (!r?.ok) {
      err(paint(c.red, "✗"), r?.error ?? "gitlawb-stats read failed");
      bail(1);
    }
    out("");
    out(paint(c.bold, "gitlawb activity"), paint(c.dim, "· " + sAddr));
    out(paint(c.dim, "─".repeat(64)));
    out(paint(c.dim, "did".padEnd(16)), paint(c.green, r.gitlawb_did));
    out(
      paint(c.dim, "node".padEnd(16)),
      paint(c.dim, r.node_url ?? "node.gitlawb.com"),
    );
    out(paint(c.dim, "repos".padEnd(16)), paint(c.cyan, String(r.repo_count)));
    out(
      paint(c.dim, "open tasks".padEnd(16)),
      paint(c.cyan, String(r.open_tasks)),
    );
    out(
      paint(c.dim, "recent commits".padEnd(16)),
      paint(c.cyan, String(r.recent_commits)) +
        paint(c.dim, " (top 3 repos)"),
    );
    if (Array.isArray(r.top_repos) && r.top_repos.length > 0) {
      out("");
      out(paint(c.bold, "top repos"));
      for (const repo of r.top_repos) {
        const name = `${repo.owner ?? "?"}/${repo.name ?? "?"}`;
        out("  " + paint(c.cyan, name));
        if (repo.description) {
          out(
            "    " + paint(c.dim, String(repo.description).slice(0, 80)),
          );
        }
        if (repo.updated_at) {
          out("    " + paint(c.dim, "updated " + repo.updated_at));
        }
      }
    }
    out("");
    return;
  }

  err("usage:");
  err("  gitlawb link <did:key:... | did:gitlawb:<slug>>   wallet-signed bind");
  err("  gitlawb unlink                                     wallet-signed clear");
  err("  gitlawb status                                     show your linked DID");
  err("  gitlawb stats <0x signa_wallet>                    live repos/commits/tasks");
  bail(2);
}

// ----- bankr -----

async function signSignaBankrTrade({ address, prompt, ts }) {
  // Mirrors the SIGNA trade v1 envelope on /api/me/trade.
  const acc = await account();
  const message = [
    "SIGNA trade v1",
    `ts:${ts}`,
    `address:${address}`,
    `prompt:${prompt}`,
  ].join("\n");
  const signature = await acc.viemAccount.signMessage({ message });
  return { signature, message };
}

async function cmdBankr(args) {
  const sub = args[0];
  const acc = await account();
  const addr = acc.address.toLowerCase();

  if (sub === "status") {
    // Lightweight unsigned read — server only exposes a boolean, no key
    // material. Avoids the prompt-validation trap of the trade endpoint.
    const r = await httpJson(`/api/me/bankr-status?address=${addr}`).catch(
      () => null,
    );
    out("");
    out(paint(c.bold, "bankr status"));
    out(paint(c.dim, "─".repeat(48)));
    out(paint(c.dim, "address".padEnd(14)), paint(c.cyan, addr));
    if (r?.connected) {
      out(paint(c.dim, "connected".padEnd(14)), paint(c.green, "yes"));
      out(
        paint(c.dim, "  execute a trade with:"),
        paint(c.cyan, 'signa bankr trade "buy 1 $BNKR"'),
      );
    } else {
      out(paint(c.dim, "connected".padEnd(14)), paint(c.yellow, "no"));
      out(
        paint(c.dim, "  connect on the website — the cli won't accept API keys"),
      );
      out(paint(c.dim, "  on the command line (shell history is unsafe):"));
      out(paint(c.dim, "    "), paint(c.cyan, (await baseUrl()) + "/me"));
    }
    out("");
    return;
  }

  if (sub === "trade") {
    const prompt = args.slice(1).join(" ").trim();
    if (!prompt) {
      err("usage: bankr trade \"<natural-language trade>\"");
      err("  examples:");
      err('    bankr trade "buy 100 $BNKR"');
      err('    bankr trade "swap 0.01 ETH for $USDC"');
      bail(2);
    }
    if (prompt.length > 500) {
      err("prompt max 500 chars");
      bail(2);
    }
    out(paint(c.dim, "submitting trade through bankr… this can take 10–30s"));
    const ts = Date.now();
    const { signature } = await signSignaBankrTrade({
      address: addr,
      prompt,
      ts,
    });
    let r;
    try {
      r = await httpJson("/api/me/trade", {
        method: "POST",
        body: JSON.stringify({ address: addr, prompt, ts, signature }),
      });
    } catch (e) {
      err(paint(c.red, "✗"), `trade failed: ${e?.message ?? e}`);
      bail(1);
    }
    out("");
    if (r.status === "completed" || r.status === "success" || r.ok) {
      out(paint(c.green, "✓ trade completed"));
    } else if (r.status === "failed") {
      out(paint(c.red, "✗ trade failed:"), r.error ?? r.message ?? "(no detail)");
    } else {
      out(paint(c.yellow, "!"), `status: ${r.status ?? "unknown"}`);
    }
    if (r.result) {
      const x = r.result;
      if (x.transactionHash) {
        out(paint(c.dim, "tx".padEnd(14)), paint(c.cyan, x.transactionHash));
        out(paint(c.dim, "view".padEnd(14)), `https://basescan.org/tx/${x.transactionHash}`);
      }
      if (x.tokenSymbol) out(paint(c.dim, "token".padEnd(14)), x.tokenSymbol);
      if (x.amountIn) out(paint(c.dim, "in".padEnd(14)), x.amountIn);
      if (x.amountOut) out(paint(c.dim, "out".padEnd(14)), x.amountOut);
    }
    return;
  }

  err("usage:");
  err("  bankr status                  show whether your bankr key is connected");
  err("  bankr trade \"<prompt>\"        wallet-signed natural-language trade");
  err("");
  err("  to connect a bankr key, visit /me on the website — API keys can't be");
  err("  pasted into a CLI safely (shell history persists them).");
  bail(2);
}

// ---------- verify: cryptographic re-verification of a signed reply ----------
//
// The single command that proves SIGNA's "server cannot forge a message"
// claim. Fetches an interaction by id, pulls the signature + canonical
// signed_message + agent_address, then runs viem's verifyMessage()
// LOCALLY — no signa server in the verification path. The check is
// reproducible by any third party with viem.

async function cmdVerify(args) {
  const id = args[0];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    err("usage: verify <uuid>");
    err("  works on either an interaction id (agent reply) or a post id");
    err("  (wallet-signed feed entry). examples:");
    err("    verify 81a2ebab-f8ba-4d36-a22d-c397e5da8c18    interaction");
    err("    verify b933e4f2-647d-468b-bf6a-9a60a0a4c504    post");
    bail(2);
  }

  // Try interaction first, then post. Both expose signature +
  // signed_message + the signer address so any third party can
  // re-verify with viem locally — no signa in the trust path.
  const iRes = await httpJson(`/api/interactions/${id}`).catch(() => null);
  if (iRes?.interaction) {
    await _verifyInteraction(iRes.interaction, iRes.agent, id);
    return;
  }
  const pRes = await httpJson(`/api/posts/${id}`).catch(() => null);
  if (pRes?.post) {
    await _verifyPost(pRes.post, id);
    return;
  }
  err(paint(c.red, "✗"), `${id} is neither a known interaction nor a post`);
  bail(1);
}

async function _verifyInteraction(i, agent, id) {
  out("");
  out(paint(c.bold, "verifying interaction"), paint(c.dim, id));
  out(paint(c.dim, "─".repeat(56)));
  out(
    paint(c.dim, "agent".padEnd(14)),
    paint(c.cyan, i.agent_address) +
      " " +
      paint(c.dim, agent?.name ? `(${agent.name})` : ""),
  );
  if (i.sender_address) {
    out(paint(c.dim, "sender".padEnd(14)), i.sender_address);
  }
  out(paint(c.dim, "intent".padEnd(14)), paint(intentColor(i.intent), i.intent));
  out(paint(c.dim, "created".padEnd(14)), i.created_at);

  if (!i.signed || !i.signature || !i.signed_message) {
    out("");
    out(paint(c.yellow, "!"), "this reply was not wallet-signed.");
    out(paint(c.dim, "  the agent's owner hasn't enabled custodial signing yet."));
    out(paint(c.dim, "  the row is still authentic — anyone can audit our DB —"));
    out(paint(c.dim, "  but it's not cryptographically attested to the agent's wallet."));
    return;
  }
  await _runVerify(i.agent_address, i.signed_message, i.signature);
}

async function _verifyPost(p, id) {
  out("");
  out(paint(c.bold, "verifying post"), paint(c.dim, id));
  out(paint(c.dim, "─".repeat(56)));
  const who = p.author?.basename || p.author?.ens_name || p.author_address;
  out(paint(c.dim, "author".padEnd(14)), paint(c.cyan, p.author_address) + " " + paint(c.dim, who !== p.author_address ? `(${who})` : ""));
  out(paint(c.dim, "created".padEnd(14)), p.created_at);
  if (p.parent_id) out(paint(c.dim, "reply to".padEnd(14)), p.parent_id);
  out(paint(c.dim, "content".padEnd(14)), (p.content ?? "").slice(0, 80));

  if (!p.signature || !p.signed_message) {
    out("");
    out(paint(c.yellow, "!"), "this post has no signature on record (legacy entry).");
    return;
  }
  await _runVerify(p.author_address, p.signed_message, p.signature);
}

async function _runVerify(expectedAddress, signed_message, signature) {
  // Cryptographic re-verification — same primitive the server uses on
  // ingest, executed CLIENT-SIDE so we depend on viem + math, not on
  // signaagent.xyz being honest.
  const vi = await viem();
  let ok;
  try {
    ok = await vi.verifyMessage({
      address: expectedAddress,
      message: signed_message,
      signature,
    });
  } catch (e) {
    err(paint(c.red, "✗"), `verify threw: ${e?.shortMessage ?? e?.message ?? e}`);
    bail(1);
  }

  out("");
  if (ok) {
    out(paint(c.green, "✓ signature VALID"));
    out(paint(c.dim, "  this content was provably written by the wallet at"));
    out(paint(c.dim, "  " + expectedAddress));
    out(paint(c.dim, "  signaagent.xyz cannot have forged it — we don't hold this key."));
  } else {
    out(paint(c.red, "✗ signature MISMATCH"));
    out(paint(c.dim, "  the on-record signature does not validate against the address."));
    out(paint(c.dim, "  this is either tampering or a serialization bug. report it."));
  }
  out("");
  out(paint(c.dim, "  signer       "), paint(c.cyan, expectedAddress));
  out(
    paint(c.dim, "  signature    "),
    paint(c.dim, signature.slice(0, 22) + "…" + signature.slice(-8)),
  );
  out(
    paint(c.dim, "  signed bytes "),
    paint(
      c.dim,
      (signed_message ?? "")
        .slice(0, 64)
        .replace(/\n/g, " ⏎ ") +
        (signed_message.length > 64 ? "…" : ""),
    ),
  );
}

// ---------- portfolio / trending / token / watchlist ----------

async function signSignaWatchlistToggle({ address, token_address, op, ts }) {
  // Mirrors buildMessageToSign("watchlist_toggle") server-side.
  const acc = await account();
  const message = [
    `SIGNA watchlist ${op} v1`,
    `ts:${ts}`,
    `address:${address}`,
    `token:${token_address}`,
  ].join("\n");
  const signature = await acc.viemAccount.signMessage({ message });
  return { signature, message };
}

async function cmdPortfolio() {
  const acc = await account();
  const addr = acc.address.toLowerCase();
  // Also pull the watchlist so portfolio enriches with bookmarked tokens.
  const watchRes = await httpJson(`/api/me/watchlist?address=${addr}`).catch(
    () => ({ watchlist: [] }),
  );
  const watchlist = watchRes.watchlist ?? [];
  const qs =
    watchlist.length > 0
      ? `&watchlist=${watchlist.join(",")}`
      : "";
  const r = await httpJson(`/api/me/portfolio?address=${addr}${qs}`).catch(
    (e) => ({ ok: false, error: e?.message }),
  );
  if (!r?.ok) {
    err(paint(c.red, "✗"), `portfolio failed: ${r?.error ?? "unknown"}`);
    bail(1);
  }
  out("");
  out(paint(c.bold, "portfolio"), paint(c.dim, addr));
  out(paint(c.dim, "─".repeat(72)));
  if (typeof r.total_usd === "number") {
    out(paint(c.dim, "total usd".padEnd(14)), paint(c.bold, "$" + r.total_usd.toFixed(2)));
  }
  if (Array.isArray(r.holdings) && r.holdings.length > 0) {
    out("");
    out(
      paint(c.bold, " SYMBOL".padEnd(12)) +
        paint(c.bold, " AMOUNT".padEnd(18)) +
        paint(c.bold, " USD"),
    );
    out(paint(c.dim, "─".repeat(56)));
    for (const h of r.holdings.slice(0, 30)) {
      const sym = (h.symbol ?? "?").slice(0, 10);
      const amt = (h.amount ?? "0").toString().slice(0, 16);
      const usd = h.usd_value != null ? "$" + Number(h.usd_value).toFixed(2) : "—";
      out(
        " " +
          paint(c.cyan, sym.padEnd(11)) +
          " " +
          amt.padEnd(17) +
          " " +
          paint(c.dim, usd),
      );
    }
  } else {
    out(paint(c.dim, "  no holdings on base mainnet (or balances are below dust threshold)"));
  }
  out("");
}

async function cmdTrending(args) {
  let kind = "trending";
  let limit = 20;
  for (const a of args) {
    if (a === "--kind=new" || a === "--new") kind = "new";
    else if (a === "--kind=trending") kind = "trending";
    else if (a.startsWith("--limit=")) limit = Math.max(1, Number(a.slice(8)) || 20);
  }
  const r = await httpJson(`/api/tokens/trending?kind=${kind}`).catch(() => null);
  if (!r?.ok) {
    err(paint(c.red, "✗"), "trending fetch failed");
    bail(1);
  }
  const list = (r.tokens ?? []).slice(0, limit);
  if (list.length === 0) {
    out(paint(c.dim, "no tokens to show."));
    return;
  }
  out("");
  out(
    paint(c.bold, kind === "new" ? "new pools on base" : "trending on base"),
    paint(c.dim, `(${r.source})`),
  );
  out(paint(c.dim, "─".repeat(80)));
  out(
    paint(c.bold, " SYMBOL".padEnd(12)) +
      paint(c.bold, " PRICE".padEnd(14)) +
      paint(c.bold, " 24H".padEnd(10)) +
      paint(c.bold, " ADDRESS"),
  );
  out(paint(c.dim, "─".repeat(80)));
  for (const t of list) {
    const sym = (t.symbol ?? "?").slice(0, 10);
    const price = t.price_usd != null ? "$" + Number(t.price_usd).toPrecision(4) : "—";
    const ch = t.change_24h_pct != null ? Number(t.change_24h_pct).toFixed(1) + "%" : "—";
    const chColor = t.change_24h_pct == null ? c.dim : t.change_24h_pct >= 0 ? c.green : c.red;
    const addr = (t.address ?? "").slice(0, 10) + "…" + (t.address ?? "").slice(-4);
    out(
      " " +
        paint(c.cyan, sym.padEnd(11)) +
        " " +
        price.padEnd(13) +
        " " +
        paint(chColor, ch.padEnd(9)) +
        " " +
        paint(c.dim, addr),
    );
  }
  out("");
  out(paint(c.dim, `  ${list.length} tokens · source: ${r.source}`));
}

async function cmdToken(args) {
  const a = args[0];
  if (!a || !/^0x[a-fA-F0-9]{40}$/.test(a)) {
    err("usage: token <0x address on Base>");
    err("  find addresses via: signa trending");
    bail(2);
  }
  const addr = a.toLowerCase();
  const r = await httpJson(`/api/tokens/${addr}`).catch(() => null);
  if (!r?.ok) {
    err(paint(c.red, "✗"), `token ${addr} not found on Base mainnet`);
    bail(1);
  }
  out("");
  out(paint(c.bold, "$" + (r.symbol ?? "?")), paint(c.dim, "·"), r.name ?? "");
  out(paint(c.dim, "─".repeat(48)));
  out(paint(c.dim, "address".padEnd(16)), paint(c.cyan, r.address ?? addr));
  if (r.price_usd != null) out(paint(c.dim, "price".padEnd(16)), paint(c.bold, "$" + Number(r.price_usd).toPrecision(6)));
  if (r.change_24h_pct != null) {
    const ch = Number(r.change_24h_pct).toFixed(2) + "%";
    const col = r.change_24h_pct >= 0 ? c.green : c.red;
    out(paint(c.dim, "24h".padEnd(16)), paint(col, ch));
  }
  if (r.volume_24h_usd != null) out(paint(c.dim, "volume 24h".padEnd(16)), "$" + Number(r.volume_24h_usd).toFixed(0));
  if (r.market_cap_usd != null) out(paint(c.dim, "market cap".padEnd(16)), "$" + Number(r.market_cap_usd).toFixed(0));
  if (r.fdv_usd != null) out(paint(c.dim, "fdv".padEnd(16)), "$" + Number(r.fdv_usd).toFixed(0));
  if (r.top_pool_address) {
    out(paint(c.dim, "top pool".padEnd(16)), paint(c.dim, r.top_pool_address));
  }
  out("");
  out(paint(c.dim, "  basescan: https://basescan.org/token/" + addr));
}

async function cmdWatchlist(args) {
  const sub = args[0];
  const acc = await account();
  const addr = acc.address.toLowerCase();

  // Bare `watchlist` — list current bookmarks.
  if (!sub || sub === "ls" || sub === "list") {
    const r = await httpJson(`/api/me/watchlist?address=${addr}`).catch(
      () => ({ watchlist: [] }),
    );
    const list = r.watchlist ?? [];
    out("");
    out(paint(c.bold, "watchlist"), paint(c.dim, addr));
    out(paint(c.dim, "─".repeat(56)));
    if (list.length === 0) {
      out(paint(c.dim, "  no bookmarked tokens."));
      out(
        paint(c.dim, "  add one with:"),
        paint(c.cyan, "signa watchlist add 0x<token_addr>"),
      );
      return;
    }
    for (const t of list) {
      out("  " + paint(c.cyan, t));
    }
    out("");
    out(paint(c.dim, `${list.length} token${list.length === 1 ? "" : "s"}`));
    return;
  }

  if (sub !== "add" && sub !== "remove" && sub !== "rm") {
    err("usage:");
    err("  watchlist                       list bookmarked tokens");
    err("  watchlist add <0x token_addr>   wallet-signed bookmark");
    err("  watchlist remove <0x token>     wallet-signed unbookmark");
    bail(2);
  }
  const op = sub === "remove" || sub === "rm" ? "remove" : "add";
  const tokenAddr = (args[1] ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(tokenAddr)) {
    err("token must be a 0x… address on Base");
    bail(2);
  }
  const ts = Date.now();
  const { signature } = await signSignaWatchlistToggle({
    address: addr,
    token_address: tokenAddr,
    op,
    ts,
  });
  const r = await httpJson("/api/me/watchlist", {
    method: "POST",
    body: JSON.stringify({
      address: addr,
      token_address: tokenAddr,
      op,
      ts,
      signature,
    }),
  });
  if (!r.ok) {
    err(paint(c.red, "✗"), r.error ?? `${op} failed`);
    bail(1);
  }
  out(paint(c.green, "✓"), op === "add" ? "bookmarked" : "removed", paint(c.cyan, tokenAddr));
}

// ----- miroshark -----

async function cmdMiroshark(args) {
  // Subcommands:
  //   miroshark sim <0x signa_agent>     show miroshark binding for a signa agent
  //   miroshark stats <0x signa_agent>   live sim-activity stats (sims fired,
  //                                       completed, pending, latest verdict)
  //   miroshark <prompt...>              route a swarm sim through the gateway
  const sub = args[0];
  if (sub === "stats") {
    const sAddr = (args[1] ?? "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(sAddr)) {
      err("usage: miroshark stats <0x signa_agent_address>");
      bail(2);
    }
    const r = await httpJson(`/api/agents/${sAddr}/miroshark-stats`).catch(
      () => null,
    );
    if (!r?.ok) {
      err(paint(c.red, "✗"), r?.error ?? "miroshark-stats read failed");
      bail(1);
    }
    out("");
    out(paint(c.bold, "miroshark activity"), paint(c.dim, "· " + sAddr));
    out(paint(c.dim, "─".repeat(64)));
    out(
      paint(c.dim, "sims fired".padEnd(16)),
      paint(c.cyan, String(r.sims_fired)) +
        paint(c.dim, " (audit posts)"),
    );
    out(
      paint(c.dim, "completed".padEnd(16)),
      paint(c.green, String(r.sims_completed)) +
        paint(c.dim, " (verdicts received)"),
    );
    out(
      paint(c.dim, "pending".padEnd(16)),
      paint(
        r.pending_sims > 0 ? c.yellow : c.dim,
        String(r.pending_sims),
      ),
    );
    out(
      paint(c.dim, "active tasks".padEnd(16)),
      paint(c.cyan, String(r.active_tasks)) +
        paint(c.dim, " (recurring miroshark_sim autonomous)"),
    );
    if (r.latest_fired_at) {
      out(
        paint(c.dim, "last fired".padEnd(16)),
        paint(c.dim, r.latest_fired_at),
      );
    }
    if (r.latest_verdict) {
      out("");
      out(paint(c.bold, "latest verdict"));
      out(
        paint(c.dim, "  at".padEnd(8)),
        paint(c.dim, r.latest_verdict.created_at),
      );
      out(
        paint(c.dim, "  text".padEnd(8)),
        String(r.latest_verdict.content).slice(0, 220),
      );
    }
    if (!r.miroshark_bot) {
      out("");
      out(
        paint(
          c.dim,
          "  note: MIROSHARK_BOT_KEY isn't configured on this node, so verdict",
        ),
      );
      out(
        paint(c.dim, "  posts can't be authored. set the env to enable them."),
      );
    }
    out("");
    return;
  }
  if (sub === "sim") {
    const sAddr = (args[1] ?? "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(sAddr)) {
      err("usage: miroshark sim <0x signa_agent_address>");
      bail(2);
    }
    const r = await httpJson(`/api/agents/${sAddr}`).catch(() => null);
    const agent = r?.agent;
    if (!agent) {
      err(paint(c.red, "✗"), `signa agent ${sAddr} not found`);
      bail(1);
    }
    out("");
    out(paint(c.bold, "miroshark binding for signa agent"));
    out(paint(c.dim, "─".repeat(64)));
    out(paint(c.dim, "agent".padEnd(14)), paint(c.cyan, agent.address));
    out(paint(c.dim, "name".padEnd(14)), agent.name ?? "?");
    const simId = agent.miroshark_sim_id;
    if (!simId) {
      out(paint(c.dim, "miroshark".padEnd(14)), paint(c.yellow, "no sim bound yet"));
      out(paint(c.dim, "  run a swarm scenario through the agent to seed a sim:"));
      out(
        paint(c.dim, "  signa miroshark \"simulate 500 holders dumping after a 30% pump\""),
      );
      return;
    }
    out(paint(c.dim, "sim id".padEnd(14)), paint(c.cyan, simId));
    out(paint(c.dim, "  preview: https://www.miroshark.io/sim/" + simId));
    return;
  }
  const prompt = args.join(" ").trim();
  if (!prompt) {
    err("usage:");
    err("  miroshark <prompt>                run a swarm scenario via the gateway");
    err("  miroshark sim <0x signa_agent>    show sim binding for a signa agent");
    err("  e.g.  miroshark \"simulate 500 holders dumping after a 30% pump\"");
    bail(2);
  }
  // Wrap in an explicit swarm directive so the gateway's intent classifier
  // picks miroshark even on prompts that don't read as "obviously swarm".
  const wrapped = `simulate (swarm): ${prompt}`;
  const r = await httpJson("/api/gateway/respond", {
    method: "POST",
    body: JSON.stringify({ prompt: wrapped }),
  });
  if (!r.ok) {
    err(paint(c.red, "✗"), r.error ?? "miroshark failed");
    bail(1);
  }
  out("");
  out(r.response);
  out("");
  printGatewayFooter(r);
}

// ---------- xmtp: real P2P E2E messaging ----------
//
// XMTP is a decentralized messaging network. Messages go peer-to-peer
// through XMTP's relay mesh — signaagent.xyz is NOT in the routing
// path. Encryption is libsignal-style double-ratchet, identity is
// wallet-bound (registration is signed by the user's wallet, proving
// they control the address).
//
// Local state lives at ~/.signa/xmtp/<wallet>.db3 — the SQLite db
// XMTP uses to maintain the conversation ratchet. Losing this file
// loses your end of past conversations (forward secrecy by design).
// Identity itself is re-derivable from the wallet, so you can always
// re-register; just past messages encrypted to the old installation
// won't be readable.
//
// We lazy-load the SDK so users without @xmtp/node-sdk installed
// (older installers, broken native bindings) can still use every
// other signa command. Only `xmtp *` commands hard-require it.

let _xmtp = null;
let _xmtpLoadFailed = false;

/**
 * Load @xmtp/node-sdk on first use. By default this BAILS the command
 * if the SDK can't be imported — e.g. native bindings missing on this
 * platform, or the user installed v0.8 and never re-ran the installer.
 *
 * Pass { soft: true } to get a graceful null return instead. Used by
 * the unified `chat` command, which falls back to the wallet-signed
 * @-mention path when XMTP isn't available, instead of refusing to
 * start.
 */
async function xmtp({ soft = false } = {}) {
  if (_xmtp) return _xmtp;
  if (_xmtpLoadFailed && soft) return null;
  try {
    _xmtp = await import("@xmtp/node-sdk");
    return _xmtp;
  } catch (e) {
    _xmtpLoadFailed = true;
    if (soft) return null;
    err(paint(c.red, "✗"), "@xmtp/node-sdk is not available.");
    err(
      paint(c.dim, "  re-run the installer to pull it (and native bindings):"),
    );
    err(
      paint(
        c.cyan,
        "    curl -fsSL https://www.signaagent.xyz/install.sh | bash   # mac/linux",
      ),
    );
    err(
      paint(
        c.cyan,
        '    powershell -ExecutionPolicy Bypass -Command "iwr https://www.signaagent.xyz/install.ps1 -UseBasicParsing | iex"   # windows',
      ),
    );
    err(paint(c.dim, `  (underlying error: ${e?.message ?? e})`));
    bail(1);
  }
}

/**
 * Build the XMTP Signer object from a viem account. XMTP's signer
 * contract wants:
 *   - type: "EOA"
 *   - signMessage(message: string) → Uint8Array
 *   - getIdentifier() → { identifier: string, identifierKind: 0 }
 *
 * The signMessage callback must return RAW BYTES, not the 0x-prefixed
 * hex string viem returns. We strip the prefix and hex-decode into a
 * Uint8Array.
 */
async function xmtpSigner() {
  const acc = await account();
  return {
    type: "EOA",
    getIdentifier: () => ({
      identifier: acc.address.toLowerCase(),
      identifierKind: 0, // Ethereum
    }),
    signMessage: async (message) => {
      const hexSig = await acc.viemAccount.signMessage({ message });
      const raw = hexSig.startsWith("0x") ? hexSig.slice(2) : hexSig;
      const bytes = new Uint8Array(raw.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    },
  };
}

async function xmtpDbPath() {
  const acc = await account();
  await mkdir(XMTP_DIR, { recursive: true });
  return join(XMTP_DIR, `${acc.address.toLowerCase()}.db3`);
}

/**
 * Open (or create) an XMTP client for the current wallet. First call
 * after `xmtp init` is fast; first ever call performs the on-network
 * identity registration which signs a "create_inbox" payload with the
 * wallet. We always use production by default; SIGNA_XMTP_ENV can
 * override to "dev" or "local" for development.
 */
async function xmtpClient() {
  const m = await xmtp();
  const signer = await xmtpSigner();
  const dbPath = await xmtpDbPath();
  const xmtpEnv = env.SIGNA_XMTP_ENV || "production";
  try {
    return await m.Client.create(signer, {
      env: xmtpEnv,
      dbPath,
    });
  } catch (e) {
    err(paint(c.red, "✗"), `xmtp client init failed: ${e?.message ?? e}`);
    bail(1);
  }
}

async function cmdXmtp(args) {
  const sub = args[0];
  if (sub === "init") return cmdXmtpInit();
  if (sub === "status") return cmdXmtpStatus();
  if (sub === "dm") return cmdXmtpDm(args.slice(1));
  if (sub === "inbox") return cmdXmtpInbox(args.slice(1));
  if (sub === "check") return cmdXmtpCheck(args.slice(1));
  if (sub === "stream" || sub === "watch") return cmdXmtpStream();
  err("usage:");
  err("  xmtp init                    one-time identity registration on the XMTP network");
  err("  xmtp status                  show your XMTP inbox id, installation count");
  err("  xmtp check <0x address>      can this address receive XMTP messages?");
  err("  xmtp dm <addr|name> <msg>    E2E-encrypted DM via XMTP (no signa in path)");
  err("  xmtp inbox                   list your XMTP conversations + latest message");
  err("  xmtp stream                  real-time XMTP message stream (live)");
  bail(2);
}

/**
 * Check whether an address has a registered XMTP V3 identity. Returns
 * true | false. Soft — never throws, returns false on any error so the
 * caller can default to the wallet-signed @-mention path.
 */
async function xmtpReachable(address) {
  try {
    const m = await xmtp({ soft: true });
    if (!m) return false;
    const xmtpEnv = env.SIGNA_XMTP_ENV || "production";
    const result = await m.Client.canMessage(
      [{ identifier: address.toLowerCase(), identifierKind: 0 }],
      xmtpEnv,
    );
    return result.get(address.toLowerCase()) === true;
  } catch {
    return false;
  }
}

/**
 * Real-time stream of inbound XMTP messages. Uses the SDK's
 * streamAllMessages() async iterator and pipes each new message to
 * stdout as it arrives. Cooperative-stop via runLongRunning — ctrl-c
 * ends the stream cleanly in both standalone and REPL contexts.
 *
 * Filters out messages we sent ourselves (sender_inbox_id === ours) +
 * group_updated frames (membership change events) so the output is
 * just the messages a human cares about.
 */
async function cmdXmtpStream() {
  const client = await xmtpClient();
  out("");
  out(paint(c.bold, "xmtp stream"), paint(c.dim, "(real-time E2E messages)"));
  out(paint(c.dim, "  press ctrl-c to stop"));
  out("");
  out(paint(c.dim, `[${new Date().toISOString().slice(11, 19)}] connected — waiting for messages…`));

  // Ensure conversations list is current before streaming.
  try {
    await client.conversations.sync();
  } catch {
    // non-fatal — stream still works even without a pre-sync
  }

  const myInbox = client.inboxId;
  await runLongRunning(async (stop) => {
    const stream = await client.conversations.streamAllMessages();
    stop.onstop = () => {
      try {
        stream.end();
      } catch {
        // ignore
      }
    };
    try {
      for await (const msg of stream) {
        if (stop.stopped) break;
        if (!msg) continue;
        // skip our own outbound + system events
        if (msg.senderInboxId === myInbox) continue;
        if (msg.contentType?.typeId === "group_updated") continue;
        const ts = new Date().toISOString().slice(11, 19);
        const peer = msg.senderInboxId
          ? msg.senderInboxId.slice(0, 16) + "…"
          : "?";
        const body = (() => {
          try {
            return typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content);
          } catch {
            return "(non-string content)";
          }
        })();
        out(
          paint(c.dim, `[${ts}]`) +
            " " +
            paint(c.yellow, "XMTP") +
            " from " +
            paint(c.cyan, peer),
        );
        out("  " + sanitizeForDisplay(body));
      }
    } catch (e) {
      if (!stop.stopped) {
        err(paint(c.red, "stream error:"), e?.shortMessage ?? e?.message ?? String(e));
      }
    }
  });
  out(paint(c.dim, "xmtp stream stopped."));
}

async function cmdXmtpInit() {
  out(paint(c.dim, "registering this wallet on the XMTP network…"));
  out(paint(c.dim, "  first run takes ~5s · subsequent runs are instant"));
  const client = await xmtpClient();
  const inboxId = client.inboxId;
  const installationId = client.installationId;
  out("");
  out(paint(c.green, "✓"), "xmtp identity ready");
  out(paint(c.dim, "inbox id".padEnd(16)), paint(c.cyan, inboxId));
  out(
    paint(c.dim, "installation".padEnd(16)),
    paint(c.dim, installationId.slice(0, 16) + "…"),
  );
  out(paint(c.dim, "db".padEnd(16)), await xmtpDbPath());
  out("");
  out(paint(c.dim, "  now you can:"));
  out(paint(c.dim, "    signa xmtp dm vitalik.eth \"hello via xmtp\""));
  out(paint(c.dim, "    signa xmtp inbox"));
}

async function cmdXmtpStatus() {
  const client = await xmtpClient();
  out("");
  out(paint(c.bold, "xmtp status"));
  out(paint(c.dim, "─".repeat(56)));
  out(paint(c.dim, "inbox id".padEnd(16)), paint(c.cyan, client.inboxId));
  out(
    paint(c.dim, "installation".padEnd(16)),
    paint(c.dim, client.installationId.slice(0, 16) + "…"),
  );
  out(paint(c.dim, "env".padEnd(16)), env.SIGNA_XMTP_ENV || "production");
  out(paint(c.dim, "db".padEnd(16)), await xmtpDbPath());
  // Count conversations
  try {
    await client.conversations.sync();
    const convos = await client.conversations.list();
    out(paint(c.dim, "conversations".padEnd(16)), paint(c.cyan, String(convos.length)));
  } catch {
    // ignore — sync issues shouldn't block status read
  }
}

async function cmdXmtpCheck(args) {
  const addr = (args[0] ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    err("usage: xmtp check <0x address>");
    bail(2);
  }
  const m = await xmtp();
  const xmtpEnv = env.SIGNA_XMTP_ENV || "production";
  const result = await m.Client.canMessage(
    [{ identifier: addr, identifierKind: 0 }],
    xmtpEnv,
  );
  const canMessage = result.get(addr) === true;
  out("");
  out(paint(c.bold, "xmtp reachability"));
  out(paint(c.dim, "─".repeat(56)));
  out(paint(c.dim, "address".padEnd(16)), paint(c.cyan, addr));
  if (canMessage) {
    out(
      paint(c.dim, "reachable".padEnd(16)),
      paint(c.green, "yes — they have a registered XMTP identity"),
    );
    out(paint(c.dim, "  dm them with: signa xmtp dm " + addr + " \"...\""));
  } else {
    out(
      paint(c.dim, "reachable".padEnd(16)),
      paint(c.yellow, "no — no XMTP identity registered for this address"),
    );
    out(paint(c.dim, "  the recipient must xmtp init first before they can receive."));
  }
}

async function cmdXmtpDm(args) {
  const recipient = args[0];
  const message = args.slice(1).join(" ").trim();
  if (!recipient || !message) {
    err("usage: xmtp dm <0x address | basename | ens> \"<message>\"");
    bail(2);
  }
  // Resolve handle to address.
  let toAddr = recipient.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(toAddr)) {
    const resolved = await httpJson(
      `/api/users/resolve?handle=${encodeURIComponent(recipient)}`,
    ).catch(() => null);
    if (!resolved?.address) {
      err(paint(c.red, "✗"), `couldn't resolve "${recipient}"`);
      bail(1);
    }
    toAddr = resolved.address.toLowerCase();
  }

  const m = await xmtp();
  const client = await xmtpClient();
  const xmtpEnv = env.SIGNA_XMTP_ENV || "production";

  // Pre-flight reachability check so we fail fast with a useful message
  // instead of a cryptic XMTP error.
  const reach = await m.Client.canMessage(
    [{ identifier: toAddr, identifierKind: 0 }],
    xmtpEnv,
  );
  if (reach.get(toAddr) !== true) {
    err(paint(c.red, "✗"), `${toAddr} has no XMTP identity registered.`);
    err(paint(c.dim, "  XMTP is opt-in — recipient must `xmtp init` first."));
    err(
      paint(c.dim, "  use `signa dm` for the legacy wallet-signed @-mention path"),
    );
    bail(1);
  }

  out(paint(c.dim, "opening conversation…"));
  const dm = await client.conversations.newDmWithIdentifier({
    identifier: toAddr,
    identifierKind: 0,
  });
  await dm.send(message);
  out("");
  out(paint(c.green, "✓"), "xmtp message sent");
  out(paint(c.dim, "to".padEnd(16)), paint(c.cyan, toAddr));
  out(paint(c.dim, "conversation".padEnd(16)), paint(c.dim, dm.id));
  out(paint(c.dim, "  delivered through the XMTP relay network."));
  out(paint(c.dim, "  signaagent.xyz was not in the path."));
}

async function cmdXmtpInbox(args) {
  let limit = 10;
  for (const a of args) {
    if (a.startsWith("--limit=")) limit = Math.max(1, Number(a.slice(8)) || 10);
  }
  const client = await xmtpClient();
  out(paint(c.dim, "syncing xmtp conversations…"));
  await client.conversations.sync();
  const convos = await client.conversations.list();
  if (convos.length === 0) {
    out("");
    out(paint(c.dim, "no xmtp conversations yet."));
    out(paint(c.dim, "  start one with: signa xmtp dm <addr> \"...\""));
    return;
  }
  out("");
  out(paint(c.bold, "xmtp inbox"));
  out(paint(c.dim, "─".repeat(72)));
  for (const conv of convos.slice(0, limit)) {
    let lastMsg = null;
    try {
      // sync this specific conversation so we see the latest messages
      // (top-level conversations.sync() only syncs the conversation
      // LIST, not the messages inside each one).
      await conv.sync();
      // XMTP node-sdk expects { limit: number } here. Earlier versions
      // documented BigInt; v4 does not — passing a BigInt crashes the
      // napi bridge with "Failed to convert napi value BigInt into i64".
      const msgs = await conv.messages({ limit: 5 });
      // Take the most recent text message — skip group_updated frames
      // (membership change events that XMTP interleaves with messages).
      for (const m of msgs) {
        if (m?.contentType?.typeId !== "group_updated") {
          lastMsg = m;
          break;
        }
      }
      if (!lastMsg && msgs[0]) lastMsg = msgs[0];
    } catch {
      // ignore — empty conversation or sync hiccup
    }
    const id = conv.id.slice(0, 8) + "…";
    const peer = (() => {
      try {
        return conv.peerInboxId
          ? conv.peerInboxId.slice(0, 16) + "…"
          : "?";
      } catch {
        return "?";
      }
    })();
    out(
      " " +
        paint(c.cyan, id) +
        "  " +
        paint(c.dim, "peer:") +
        " " +
        peer,
    );
    if (lastMsg) {
      const content = (() => {
        try {
          return typeof lastMsg.content === "string"
            ? lastMsg.content
            : JSON.stringify(lastMsg.content);
        } catch {
          return "(non-string content)";
        }
      })();
      out(
        "   " +
          paint(c.dim, "last:") +
          " " +
          content.slice(0, 80).replace(/\n/g, " "),
      );
    }
    out("");
  }
  out(paint(c.dim, `${convos.length} total · showing ${Math.min(limit, convos.length)}`));
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

// ---------- REPL: history persistence + tab completion ----------

/**
 * Canonical list of REPL-callable tokens. Used by the tab completer and
 * by the REPL meta-command short-circuits. Keep this in sync with the
 * dispatchCommand switch — anything reachable from the user should be
 * here, plus the meta commands ('help', 'clear', 'exit', 'quit').
 */
const REPL_COMMANDS = [
  "ask", "stream", "agent", "agents", "search", "live", "stats", "metrics",
  "feed", "thread", "profile",
  "launch", "chat",
  "login", "logout", "wallet", "whoami",
  "post", "dm", "reply", "like", "unlike", "rate",
  "inbox", "watch", "receipts",
  "send",
  // partner integrations
  "aeon", "gitlawb", "bankr", "miroshark",
  // P2P E2E messaging via XMTP
  "xmtp",
  // daily-use + verify showpiece
  "verify", "portfolio", "trending", "token", "watchlist",
  "digest", "holders",
  "update",
  "nodes", "node", "sync",
  "a2a",
  "config", "version", "banner",
  "help", "clear", "exit", "quit",
];

/**
 * Tab-completion. readline's `completer` receives the prefix the user
 * has typed and expects [matches, common-prefix] back. We support:
 *   - top-level command names
 *   - second-token subcommands for `agent`, `config`
 *   - `send <to> <amount> ETH|USDC` token slot
 *   - long-flag completion for `search --kind=…` and `live --intent=…`
 * Anything we don't recognize returns an empty match list (no completion),
 * which is the right behavior — silently doing nothing beats a wrong guess.
 */
function replCompleter(line) {
  const tokens = line.split(/\s+/);
  const last = tokens[tokens.length - 1] ?? "";

  if (tokens.length <= 1) {
    const hits = REPL_COMMANDS.filter((c) => c.startsWith(last));
    return [hits.length ? hits : REPL_COMMANDS, last];
  }
  const head = tokens[0];
  if (head === "agent" && tokens.length === 2) {
    const opts = [
      "ls",
      "get",
      "mine",
      "find",
      "enable-runtime",
      "disable-runtime",
      "autonomous",
    ];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "agent" && tokens.length === 3 && tokens[1] === "autonomous") {
    const opts = ["create", "list", "cancel"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (
    head === "agent" &&
    tokens[1] === "autonomous" &&
    tokens[2] === "create" &&
    last.startsWith("--kind")
  ) {
    const opts = ["--kind=post", "--kind=miroshark-sim", "--kind=payment"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (
    head === "agent" &&
    tokens[1] === "autonomous" &&
    tokens[2] === "create" &&
    last.startsWith("--token")
  ) {
    const opts = ["--token=ETH", "--token=USDC"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "digest" && tokens.length === 2) {
    const opts = ["enable", "disable"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "config" && tokens.length === 2) {
    const opts = ["set", "get", "clear"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "send" && tokens.length === 4) {
    const opts = ["ETH", "USDC"];
    const hits = opts.filter((s) =>
      s.toUpperCase().startsWith(last.toUpperCase()),
    );
    return [hits.length ? hits : opts, last];
  }
  if (head === "search" && last.startsWith("--kind")) {
    const opts = ["--kind=all", "--kind=replies", "--kind=agents", "--kind=posts"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "metrics" && last.startsWith("--")) {
    return [["--watch"], last];
  }
  if (head === "live" && last.startsWith("--intent")) {
    const opts = [
      "--intent=facts",
      "--intent=chat",
      "--intent=code",
      "--intent=swarm",
      "--intent=action",
    ];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "update" && last.startsWith("--")) {
    return [["--check"], last];
  }
  if (head === "node" && tokens.length === 2) {
    const opts = [
      "info",
      "ping",
      "verify",
      "use",
      "sign-attestation",
      "register",
      "deregister",
      "registry",
    ];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "sync" && tokens.length === 2) {
    const opts = ["status", "run"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "a2a" && tokens.length === 2) {
    const opts = ["send", "inbox", "outbox", "thread", "verify"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  // partner subcommands
  if (head === "aeon" && tokens.length === 2) {
    const opts = ["resolve", "balance", "agent"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "gitlawb" && tokens.length === 2) {
    const opts = ["resolve", "repos", "playground", "link", "unlink", "status", "stats"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "miroshark" && tokens.length === 2) {
    const opts = ["sim", "stats"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "bankr" && tokens.length === 2) {
    const opts = ["status", "trade"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "xmtp" && tokens.length === 2) {
    const opts = ["init", "status", "check", "dm", "inbox", "stream"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "chat" && last.startsWith("--")) {
    const opts = ["--transport=auto", "--transport=xmtp", "--transport=posts"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "watchlist" && tokens.length === 2) {
    const opts = ["add", "remove", "ls"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  if (head === "trending" && last.startsWith("--")) {
    const opts = ["--kind=trending", "--kind=new", "--limit=10", "--limit=30"];
    const hits = opts.filter((s) => s.startsWith(last));
    return [hits.length ? hits : opts, last];
  }
  return [[], last];
}

/**
 * Load up to 200 prior REPL lines from disk. readline expects history
 * in reverse-chronological order (newest first), so we reverse before
 * returning.
 */
async function loadHistory() {
  try {
    const raw = await readFile(HISTORY_PATH, "utf8");
    return raw.split("\n").filter(Boolean).slice(-200).reverse();
  } catch {
    return [];
  }
}

/**
 * Persist the REPL's current history. Stored in chronological order
 * (oldest first), which is how a human reads a log. Capped at 200 lines
 * so the file doesn't grow unbounded. Best-effort — never throws.
 */
async function saveHistory(rl) {
  if (!rl?.history) return;
  try {
    await mkdir(SIGNA_HOME, { recursive: true });
    const lines = [...rl.history].reverse().slice(-200);
    await writeFile(HISTORY_PATH, lines.join("\n") + "\n");
  } catch {
    // ignore — history is convenience, not correctness
  }
}

/**
 * Synchronous variant for the ctrl-c path, where we can't safely await
 * before process.exit. Async fs would race the exit and lose the last
 * few commands. writeFileSync inside a signal handler is normally
 * frowned on, but at shutdown it's the right tool.
 */
function saveHistorySync(rl) {
  if (!rl?.history) return;
  try {
    const lines = [...rl.history].reverse().slice(-200);
    writeFileSync(HISTORY_PATH, lines.join("\n") + "\n");
  } catch {
    // ignore
  }
}

// ---------- self-update ----------

/**
 * Numeric semver compare. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Parses up to three integer components; anything missing is treated as
 * 0, so "0.4" and "0.4.0" are equal. Pre-release tags (e.g. "-rc.1") are
 * ignored — we strip everything after the first non-numeric char per
 * component to stay lenient. This is enough for our use; we don't ship
 * pre-releases through the same URL.
 */
function compareSemver(a, b) {
  const parse = (v) =>
    v
      .split(".")
      .slice(0, 3)
      .map((p) => parseInt(p, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

/**
 * Pull the latest signa.mjs from the configured SIGNA_BASE_URL and
 * atomically replace this very file on disk. The running process keeps
 * the old code in memory — we surface that explicitly so the user
 * restarts their shell instead of being confused by a partial upgrade.
 *
 *   signa update           — download + atomic-replace, then advise restart
 *   signa update --check   — compare versions only, no write
 */
async function cmdUpdate(args) {
  const checkOnly = args.includes("--check");
  const base = await baseUrl();
  const url = `${base}/signa.mjs`;

  let res;
  try {
    res = await fetch(url, {
      headers: { "user-agent": `signa-cli/${VERSION}` },
    });
  } catch (e) {
    err(paint(c.red, "✗"), `couldn't reach ${url}: ${e?.message ?? e}`);
    bail(1);
  }
  if (!res.ok) {
    err(paint(c.red, "✗"), `couldn't fetch ${url} (HTTP ${res.status})`);
    bail(1);
  }
  const content = await res.text();

  // Extract VERSION from the downloaded file. We do a generous regex
  // rather than executing the JS so a corrupted download can't side-
  // effect our process.
  const match = content.match(/const\s+VERSION\s*=\s*"([^"]+)"/);
  const remoteVersion = match?.[1] ?? null;
  if (!remoteVersion) {
    err(paint(c.red, "✗"), "downloaded file is missing a VERSION constant — aborting.");
    bail(1);
  }

  // Proper semver compare so "0.10.0" sorts after "0.9.0", and so we
  // can detect dev-ahead-of-prod ("local is newer than the source URL").
  const cmp = compareSemver(VERSION, remoteVersion);
  out("");
  out(
    paint(c.dim, "local".padEnd(12)),
    paint(c.cyan, `v${VERSION}`),
  );
  out(
    paint(c.dim, "remote".padEnd(12)),
    cmp === 0
      ? paint(c.dim, `v${remoteVersion} (same)`)
      : cmp < 0
        ? paint(c.green, `v${remoteVersion}`) +
          " " +
          paint(c.dim, "(upgrade available)")
        : paint(c.dim, `v${remoteVersion}`) +
          " " +
          paint(c.yellow, "(local is ahead — likely a dev build)"),
  );
  out("");

  if (cmp === 0) {
    out(paint(c.green, "✓"), `signa cli is up to date.`);
    return;
  }
  if (cmp > 0) {
    out(
      paint(c.yellow, "!"),
      "local is newer than the published version. nothing to do.",
    );
    return;
  }
  if (checkOnly) {
    out(paint(c.dim, "run 'signa update' (without --check) to upgrade."));
    return;
  }

  // Atomic write: download → tmp → rename. rename() on the same volume
  // is atomic on every POSIX filesystem and on NTFS, so the user never
  // sees a torn signa.mjs even if power is cut mid-write.
  const ownPath = fileURLToPath(import.meta.url);
  const tmpPath = ownPath + ".new";
  try {
    await writeFile(tmpPath, content);
    await rename(tmpPath, ownPath);
  } catch (e) {
    err(paint(c.red, "✗"), `write failed: ${e?.message ?? e}`);
    err(paint(c.dim, "  if this is a permissions issue, re-run the installer:"));
    err(paint(c.cyan, "    curl -fsSL https://www.signaagent.xyz/install.sh | bash"));
    bail(1);
  }

  out(paint(c.green, "✓"), `upgraded to v${remoteVersion}.`);
  out(
    paint(c.yellow, "!"),
    "the running process still has the old code in memory.",
  );
  out(paint(c.dim, "  exit + re-open the REPL (or restart your shell) to pick it up."));
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
    // Tab completion. readline calls this synchronously on every TAB.
    completer: replCompleter,
  });

  // Hydrate history from disk so the user's up-arrow works across
  // sessions. readline holds history newest-first; loadHistory returns
  // newest-first too, so we can just assign.
  try {
    const persisted = await loadHistory();
    if (persisted.length) {
      // rl.history is a public-but-undocumented array. Push at the back
      // so the user's existing in-session navigation isn't disrupted.
      rl.history.push(...persisted);
    }
  } catch {
    // ignore — history is best-effort
  }

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
      // ctrl-c exit path runs in a signal handler — async writeFile would
      // race the process exit and lose the last few commands. saveHistorySync
      // is the right tool here, despite the usual "no sync I/O in handlers"
      // rule, because we're already on the way out.
      saveHistorySync(rl);
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

    // ----- CHAT MODE: every line is a DM until `:q` / `exit` -----
    if (CHAT_MODE) {
      if (line === ":q" || line === "exit" || line === "quit") {
        out(paint(c.dim, `left chat with ${CHAT_MODE.their_handle}.`));
        CHAT_MODE = null;
        rl.setPrompt(promptStr);
        rl.prompt();
        continue;
      }
      try {
        if (line.length > 0) {
          await sendChatLine(CHAT_MODE, line);
        }
        await pollAndShowChat(CHAT_MODE);
      } catch (e) {
        if (!(e && e.isBail)) {
          err(paint(c.red, "chat error:"), e?.message ?? String(e));
        }
      }
      rl.prompt();
      continue;
    }

    // ----- NORMAL REPL DISPATCH -----
    if (!line) {
      rl.prompt();
      continue;
    }
    if (line === "exit" || line === "quit" || line === ":q") {
      out(paint(c.dim, "bye."));
      await saveHistory(rl);
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
      // Pass rl so dispatchCommand can hand it to cmdChat when entering
      // chat mode from inside the REPL.
      await dispatchCommand(tokens, { fromRepl: true, replRl: rl });
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

async function dispatchCommand(args, { fromRepl = false, replRl = null } = {}) {
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
    case "agents":
      await cmdAgents(rest);
      break;
    case "launch":
      await cmdLaunch(rest);
      break;
    case "chat":
      await cmdChat(rest, { fromRepl, replRl });
      break;
    case "aeon":
      await cmdAeon(rest);
      break;
    case "gitlawb":
      await cmdGitlawb(rest);
      break;
    case "bankr":
      await cmdBankr(rest);
      break;
    case "miroshark":
      await cmdMiroshark(rest);
      break;
    case "xmtp":
      await cmdXmtp(rest);
      break;
    case "verify":
      await cmdVerify(rest);
      break;
    case "portfolio":
      await cmdPortfolio();
      break;
    case "trending":
      await cmdTrending(rest);
      break;
    case "token":
      await cmdToken(rest);
      break;
    case "watchlist":
      await cmdWatchlist(rest);
      break;
    case "digest":
      await cmdDigest(rest);
      break;
    case "holders":
      await cmdHolders(rest);
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
    case "metrics":
      await cmdMetrics(rest);
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
    case "update":
      await cmdUpdate(rest);
      break;
    case "nodes":
      await cmdNodes();
      break;
    case "node":
      await cmdNode(rest);
      break;
    case "sync":
      await cmdSync(rest);
      break;
    case "a2a":
      await cmdA2A(rest);
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
