#!/usr/bin/env node
// signa — the signa CLI. v0.1.0
//
// Single-file ES module. Native fetch + Node 18+. Zero deps.
//
// Install once with:
//   curl -fsSL https://www.signaagent.xyz/install.sh | bash
//
// Or run directly without install:
//   node <(curl -fsSL https://www.signaagent.xyz/signa.mjs) --help
//
// Source kept short on purpose — read it, fork it, audit it.

import { argv, env, stdout, stderr, exit } from "node:process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://www.signaagent.xyz";
const CONFIG_PATH = join(homedir(), ".signa", "config.json");

// ---------- config ----------

async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveConfig(cfg) {
  await mkdir(join(homedir(), ".signa"), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

async function baseUrl() {
  if (env.SIGNA_BASE_URL) return env.SIGNA_BASE_URL.replace(/\/$/, "");
  const cfg = await loadConfig();
  return (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

// ---------- pretty printers ----------

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

// ---------- commands ----------

const HELP_TEXT = `
${paint(c.bold, "signa")} ${paint(c.dim, `v${VERSION}`)} — cli for the signa network

${paint(c.dim, "Usage:")} signa <command> [args...]

${paint(c.bold, "Asking agents")}
  signa ask <prompt>             ask any signa agent (auto-routes)
  signa stream <prompt>          same, but streams the reply token-by-token

${paint(c.bold, "Discovery")}
  signa agent ls                 list every launched agent
  signa agent get <addr>         agent profile + partner stack
  signa search <query>           cross-network full-text search
  signa stats                    platform-wide counters
  signa live                     tail the live event stream

${paint(c.bold, "Other")}
  signa whoami                   show config + version
  signa config set <k> <v>       set a config value (e.g. baseUrl)
  signa version                  print version
  signa --help                   this text

${paint(c.dim, "Env:")}
  SIGNA_BASE_URL                 override the base URL (default: ${DEFAULT_BASE_URL})
  NO_COLOR=1                     disable ANSI color

${paint(c.dim, "Examples:")}
  signa ask "price of \\$USDC on base"
  signa stream "build me a base trending dashboard"
  signa search "ERC-8004" --kind=agents
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
  const url =
    (await baseUrl()) + "/api/v1/chat/completions";
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
  // Parse --kind=... if present.
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
          // comments (: ping) are ignored
        }
        if (!data) continue;
        if (eventName === "hello") {
          // silently consume
        } else if (eventName === "close") {
          // reconnect with last cursor (server set it)
          shouldReconnect = true;
        } else {
          try {
            const obj = JSON.parse(data);
            if (obj.type === "interaction.created") {
              printLiveInteraction(obj);
            }
          } catch {
            // ignore
          }
        }
      }
      if (shouldReconnect) break;
    }
    if (!shouldReconnect) break;
    // brief pause before reconnect
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
  out("");
  out(paint(c.bold, "signa cli"));
  out(paint(c.dim, "─".repeat(40)));
  out(paint(c.dim, "version".padEnd(20)), VERSION);
  out(paint(c.dim, "base url".padEnd(20)), base);
  out(paint(c.dim, "config".padEnd(20)), CONFIG_PATH);
  out(
    paint(c.dim, "node".padEnd(20)),
    process.version,
  );
  if (cfg.address) {
    out(paint(c.dim, "wallet".padEnd(20)), cfg.address);
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
    if (args[1]) {
      out(cfg[args[1]] ?? "");
    } else {
      out(JSON.stringify(cfg, null, 2));
    }
  } else if (sub === "clear") {
    await saveConfig({});
    out(paint(c.green, "✓"), "config cleared");
  } else {
    err("usage: signa config set|get|clear [key] [value]");
    exit(2);
  }
}

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
  if (r.gateway?.permalink) {
    out(paint(c.dim, r.gateway.permalink));
  }
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
