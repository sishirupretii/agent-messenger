#!/usr/bin/env node
/**
 * signa-trust-gate — composite trust decision combining
 * ERC-8004 identity + SIGNA room gate + custom ERC-20 minimum.
 *
 * Usage:
 *   node run.mjs "0xsender [room=<slug>] [min_token=<0xt>:<chain>:<minraw>] [require_8004=1]"
 */
import { createPublicClient, http } from "viem";
import { mainnet, base } from "viem/chains";
import { mkdirSync, writeFileSync } from "node:fs";

const input = (process.argv[2] ?? "").trim();
if (!input) {
  console.error("usage: run.mjs \"0xsender [room=<slug>] [min_token=...] [require_8004=1]\"");
  process.exit(2);
}

const tokens = input.split(/\s+/);
const sender = (tokens.shift() ?? "").toLowerCase();
if (!/^0x[a-f0-9]{40}$/.test(sender)) {
  console.error("first token must be a 0x... wallet address");
  process.exit(2);
}

const params = new Map();
for (const t of tokens) {
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  params.set(t.slice(0, eq).toLowerCase(), t.slice(eq + 1));
}

const baseUrl = process.env.SIGNA_BASE_URL ?? "https://www.signaagent.xyz";
const ethRpc = process.env.ETHEREUM_RPC_URL ?? "https://ethereum.publicnode.com";
const baseRpc = process.env.BASE_RPC_URL ?? "https://base.publicnode.com";

const ERC8004_IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const erc8004Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tokenOfOwnerByIndex", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "index", type: "uint256" }],
    outputs: [{ type: "uint256" }] },
  { type: "function", name: "agentURI", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "string" }] },
];
const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view",
    inputs: [], outputs: [{ type: "string" }] },
];

const ethClient = createPublicClient({ chain: mainnet, transport: http(ethRpc) });
const baseClient = createPublicClient({ chain: base, transport: http(baseRpc) });

async function check8004(addr) {
  try {
    const bal = await ethClient.readContract({
      address: ERC8004_IDENTITY, abi: erc8004Abi,
      functionName: "balanceOf", args: [addr],
    });
    if (bal === 0n) {
      return { ok: false, detail: "no agent-NFT held on Ethereum mainnet" };
    }
    const tokenId = await ethClient.readContract({
      address: ERC8004_IDENTITY, abi: erc8004Abi,
      functionName: "tokenOfOwnerByIndex", args: [addr, 0n],
    });
    let card = null;
    try {
      const uri = await ethClient.readContract({
        address: ERC8004_IDENTITY, abi: erc8004Abi,
        functionName: "agentURI", args: [tokenId],
      });
      const url = uri.startsWith("ipfs://")
        ? `https://ipfs.io/ipfs/${uri.slice(7)}`
        : uri;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (r.ok) card = await r.json().catch(() => null);
    } catch {
      /* card optional */
    }
    return {
      ok: true,
      detail: `token_id=${tokenId}${card?.name ? ` name="${card.name}"` : ""}${
        card?.x402Support ? " x402=true" : ""
      }${Array.isArray(card?.services) ? ` services=${card.services.length}` : ""}`,
      card,
      tokenId: String(tokenId),
    };
  } catch (e) {
    return { ok: false, detail: `ERC-8004 read failed: ${e?.shortMessage ?? e?.message ?? e}` };
  }
}

async function checkRoom(addr, slug) {
  try {
    const r = await fetch(
      `${baseUrl}/api/rooms/${slug}/gate-check?address=${addr.toLowerCase()}`,
      { cache: "no-store" },
    );
    const j = await r.json().catch(() => ({}));
    if (!j?.ok) return { ok: false, detail: `gate-check failed: ${j?.error ?? r.status}` };
    if (!j.gated) return { ok: true, detail: `room #${slug} is ungated` };
    if (j.eligible) {
      return {
        ok: true,
        detail: `#${slug} — sender holds ${j.held ?? "?"} $${j.symbol ?? "TOKEN"} (min ${j.min ?? "?"})`,
      };
    }
    return {
      ok: false,
      detail: `#${slug} — sender holds ${j.held ?? "0"} $${j.symbol ?? "TOKEN"} (min ${j.min ?? "?"})`,
    };
  } catch (e) {
    return { ok: false, detail: `room check failed: ${e?.message ?? e}` };
  }
}

async function checkErc20Min(addr, spec) {
  // spec = "<0xtoken>:<chain>:<min_raw>"
  const parts = spec.split(":");
  if (parts.length !== 3) return { ok: false, detail: `bad min_token spec "${spec}"` };
  const [token, chainName, minRaw] = parts;
  if (!/^0x[a-f0-9]{40}$/i.test(token)) return { ok: false, detail: "invalid token address" };
  const min = BigInt(minRaw);
  const client = chainName.toLowerCase() === "base" ? baseClient : ethClient;
  try {
    const [bal, dec, sym] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "decimals", args: [] }).catch(() => 18),
      client.readContract({ address: token, abi: erc20Abi, functionName: "symbol", args: [] }).catch(() => "TOKEN"),
    ]);
    const pass = bal >= min;
    const human = (raw) => {
      const base = 10n ** BigInt(dec);
      const whole = raw / base;
      const frac = raw % base;
      if (frac === 0n) return whole.toString();
      return `${whole}.${frac.toString().padStart(Number(dec), "0").replace(/0+$/, "").slice(0, 4)}`;
    };
    return {
      ok: pass,
      detail: `${chainName} $${sym} — sender holds ${human(bal)} (min ${human(min)})`,
    };
  } catch (e) {
    return { ok: false, detail: `erc20 read failed: ${e?.shortMessage ?? e?.message ?? e}` };
  }
}

const require8004 = params.get("require_8004") === "1";
const room = params.get("room");
const minToken = params.get("min_token");

const [r8004, rRoom, rMin] = await Promise.all([
  check8004(sender),
  room ? checkRoom(sender, room) : Promise.resolve(null),
  minToken ? checkErc20Min(sender, minToken) : Promise.resolve(null),
]);

const lines = [];
function add(prefix, res) {
  if (res === null) return null;
  lines.push(`    [${res.ok ? "PASS" : "FAIL"}] ${prefix.padEnd(22)} ${res.detail}`);
  return res.ok;
}

const used = [];
const id = require8004 ? add("ERC-8004 identity", r8004) : null;
if (id !== null) used.push(id);
if (!require8004) lines.push(`    [INFO] ERC-8004 identity      ${r8004.detail}`);

const rm = room ? add("hold-to-chat room", rRoom) : null;
if (rm !== null) used.push(rm);
else if (!room) lines.push(`    [SKIP] hold-to-chat room     (no room specified)`);

const er = minToken ? add("custom ERC-20 min", rMin) : null;
if (er !== null) used.push(er);
else if (!minToken) lines.push(`    [SKIP] custom ERC-20 min     (not requested)`);

const decision = used.length === 0 ? true : used.every(Boolean);

const out = [
  `SIGNA trust gate · decision ${decision ? "YES" : "NO"}`,
  ``,
  `  sender:     ${sender.slice(0, 6)}…${sender.slice(-4)}`,
  `  checks:`,
  ...lines,
  ``,
  `  rationale:  ${
    decision
      ? used.length === 0
        ? "no hard requirements set — defaulting to YES (informational only)"
        : "every requested check passed"
      : "at least one required check failed"
  }`,
].join("\n");

process.stdout.write(out + "\n");
try {
  mkdirSync(".outputs", { recursive: true });
  writeFileSync(".outputs/signa-trust-gate.md", out + "\n");
} catch {}
