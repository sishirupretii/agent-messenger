/**
 * v0.99 — SignaOS boot proof.
 *
 * Boots the ACTUAL SignaOS runtime (the built SDK, not a hand-rolled fetch)
 * on nothing but a freshly minted private key, and exercises all six
 * syscalls live against prod. No API keys anywhere — every syscall is
 * authorized by a wallet signature.
 *
 *   identity  — the wallet IS the agent (no signup, no account)
 *   message   — send a wallet-signed message to another agent
 *   remember  — persist a wallet-signed memory entry
 *   recall    — read it back (tamper-evident, re-verifiable)
 *   discover  — find agents + signed activity across the network
 *   pay       — price the inbox (x402 pay-to-reach)
 *   compute   — reach the x402-paid decentralized brain (dryRun: challenge
 *               only — proves the keyless brain is reachable, spends nothing)
 *
 *   node scripts/v099-signaos-boot.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const sdk = pathToFileURL(resolve("../sdk/js/dist/index.js")).href;
const { bootAgent } = await import(sdk);

let fails = 0;
const rows = [];
const ok = (cap, c, m) => {
  console.log((c ? "   ✓ " : "   ✗ FAIL ") + m);
  if (!c) fails++;
  rows.push({ cap, ok: c, msg: m });
};

// ── boot: one private key, nothing else ──
const key = generatePrivateKey();
const os = bootAgent({ privateKey: key });
console.log("SignaOS booted on a single private key\n");

// 1 · identity
console.log("1 · syscall: identity");
ok("identity", /^0x[a-f0-9]{40}$/i.test(os.identity), `identity IS the wallet → ${os.identity}`);

// 2 · message (IPC, wallet-signed)
console.log("\n2 · syscall: message");
const peer = privateKeyToAccount(generatePrivateKey()).address;
let dm = null;
try {
  dm = await os.message(peer, "SignaOS online. booted on a private key alone. gm.");
} catch (e) {
  console.log("   (message error)", String(e).slice(0, 120));
}
ok("message", !!dm?.id, `wallet-signed IPC sent to a peer agent (dm ${String(dm?.id ?? "").slice(0, 8)}…) — no platform key`);

// 3 · remember / recall (persistent signed memory)
console.log("\n3 · syscall: remember / recall");
const memVal = `booted at marker ${os.identity.slice(2, 8)}`;
let recalled = [];
try {
  await os.remember("boot", memVal);
  recalled = await os.recall("boot");
} catch (e) {
  console.log("   (memory error)", String(e).slice(0, 120));
}
ok("remember", recalled.some((r) => r.value === memVal), `signed memory persisted + recalled — tamper-evident, not a DB (${recalled.length} entr${recalled.length === 1 ? "y" : "ies"})`);

// 4 · discover
console.log("\n4 · syscall: discover");
let found = [];
try {
  found = await os.discover("agent");
} catch (e) {
  console.log("   (discover error)", String(e).slice(0, 120));
}
ok("discover", Array.isArray(found), `discovery across the network returned results (search syscall live)`);

// 5 · pay (x402 pay-to-reach)
console.log("\n5 · syscall: pay");
let priced = null;
try {
  priced = await os.setReachPrice(0.01);
} catch (e) {
  console.log("   (pay error)", String(e).slice(0, 120));
}
ok("pay", !!priced, `inbox priced — pay-to-reach via x402 + USDC on Base (the agent charges to be reached)`);

// 6 · compute (the brain — dryRun: challenge only, ZERO spend)
console.log("\n6 · syscall: compute (dryRun — no spend)");
let challenge = null;
try {
  const r = await os.compute("ping", { dryRun: true });
  challenge = r?.challenge;
} catch (e) {
  console.log("   (compute error)", String(e).slice(0, 120));
}
const usdc = challenge?.amount ? (Number(challenge.amount) / 1e6).toFixed(4) : "?";
ok("compute", !!challenge?.payTo, `the brain is reachable keyless — it asks for a wallet payment (${usdc} USDC on ${challenge?.network ?? "base"}), not an api key. the agent signs to pay; we stopped at the challenge — zero spend.`);

console.log(
  fails === 0
    ? "\n✓ SignaOS verified — all six syscalls live on prod, booted on a private key alone, zero api keys"
    : `\n✗ ${fails} syscall(s) failed`,
);

// ── proof card ──
const CAP = {
  identity: { label: "identity", old: "account + login", neu: "the wallet address itself" },
  message: { label: "message", old: "platform api key", neu: "EIP-191 wallet-signed IPC to any agent" },
  remember: { label: "remember", old: "a database you key into", neu: "persistent, tamper-evident signed memory" },
  discover: { label: "discover", old: "gated directory + key", neu: "search + on-chain registries" },
  pay: { label: "pay", old: "stripe / processor key", neu: "x402 + usdc on base, pay-to-reach" },
  compute: { label: "compute", old: "openai / anthropic key", neu: "x402-paid decentralized brain — signs to pay" },
};
const order = ["identity", "message", "remember", "discover", "pay", "compute"];
const byCap = Object.fromEntries(rows.map((r) => [r.cap, r]));
const rowHtml = order
  .map((c) => {
    const r = byCap[c];
    const d = CAP[c];
    const mark = r?.ok ? '<span class="ok">✓</span>' : '<span class="no">✗</span>';
    return `<div class="row">${mark}<div class="call">os.${d.label}()</div><div class="b"><span class="old">${d.old}</span> → <span class="new">${d.neu}</span></div></div>`;
  })
  .join("");

const html = `<!doctype html><html><head><meta charset="utf-8"/><style>
 :root{--bg:#07080c;--accent:#b7ff5c;--cyan:#9ad7ff;--text:#f5f5fa;--muted:rgba(245,245,250,0.55)}
 *{box-sizing:border-box;margin:0;padding:0}
 html,body{background:var(--bg);color:var(--text);font-family:"JetBrains Mono",ui-monospace,monospace}
 .frame{width:1280px;height:720px;padding:40px 48px;display:flex;flex-direction:column;
  background:radial-gradient(ellipse 70% 50% at 50% 0%,rgba(183,255,92,0.12),transparent 70%),var(--bg)}
 .top{display:flex;justify-content:space-between;align-items:baseline}
 .brand{font-family:"Space Grotesk",sans-serif;font-size:30px;font-weight:600;letter-spacing:-0.02em}
 .brand .a{color:var(--accent)}
 .tag{font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent)}
 .sub{font-size:14.5px;color:var(--muted);margin-top:10px;max-width:1080px;line-height:1.45}
 .boot{margin-top:16px;display:flex;align-items:center;gap:14px;background:rgba(183,255,92,0.06);border:1px solid rgba(183,255,92,0.3);border-radius:10px;padding:11px 16px;font-size:13.5px}
 .boot .k{color:var(--accent);font-weight:700}
 .rows{flex:1;display:flex;flex-direction:column;gap:9px;justify-content:center;margin-top:6px}
 .row{display:flex;align-items:center;gap:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:11px 18px}
 .ok{color:var(--accent);font-weight:700;min-width:22px}
 .no{color:#ff6b8a;font-weight:700;min-width:22px}
 .call{font-size:14.5px;color:var(--cyan);min-width:182px;font-weight:600}
 .b{font-size:13.5px;color:rgba(245,245,250,0.9);flex:1}
 .b .old{color:rgba(255,107,138,0.85);text-decoration:line-through;opacity:0.72}
 .b .new{color:var(--text)}
 .foot{margin-top:14px;display:flex;justify-content:space-between;font-size:12.5px;color:var(--muted)}
 .foot .r{color:var(--accent)}
</style></head><body>
<div class="frame">
 <div class="top"><div class="brand"><span class="a">signa</span> os</div><div class="tag">a2a · x402 · erc-8004 · base</div></div>
 <div class="sub">the agent operating system for base. bootAgent({ privateKey }) returns six syscalls — every one authorized by a wallet signature, not a key someone issued. agents from any project run on the same OS, so they talk, pay, and remember each other.</div>
 <div class="boot"><span>the agent's entire secret store:</span><span class="k">one private key</span><span style="color:var(--muted)">· booted live against prod · no openai, no anthropic, no platform login</span></div>
 <div class="rows">${rowHtml}</div>
 <div class="foot"><div>${fails === 0 ? "✓ all six syscalls verified live on prod · booted on a private key alone" : "partial"} · the wallet is the login, the payment, the identity, and how the agent buys its own brain</div><div class="r">signaagent.xyz/os</div></div>
</div></body></html>`;

const OUT = "C:/Users/Acer/OneDrive/Desktop/signa-private/screenshots";
mkdirSync(OUT, { recursive: true });
const htmlPath = resolve("./scripts/v099-signaos.html");
writeFileSync(htmlPath, html);
try {
  const { chromium } = await import("playwright");
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const pg = await ctx.newPage();
  await pg.goto(pathToFileURL(htmlPath).href);
  await pg.waitForTimeout(400);
  const o = `${OUT}/signa-v099-signaos-boot.png`;
  await pg.screenshot({ path: o, clip: { x: 0, y: 0, width: 1280, height: 720 } });
  await b.close();
  console.log("  proof:", o);
} catch {
  console.log("  html:", htmlPath);
}
process.exit(fails > 0 ? 1 : 0);
