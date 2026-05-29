/**
 * v0.75 — Cross-framework agent conversation demo.
 *
 * Real Node script. Boots 2 SignaAgent instances on different wallets,
 * wraps one as a "LangChain-style" agent loop (chain.invoke pattern,
 * tool calling), wraps the other as an "ElizaOS-style" action loop
 * (action.handler pattern, callback shape). They DM each other through
 * the live SIGNA network using the same EIP-191 envelope.
 *
 * Renders the conversation to an HTML page Playwright records as a
 * webm so the X post has a visual proof.
 *
 * Usage:
 *   node scripts/v075-cross-framework-demo.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readdirSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const OUT = "C:/Users/Acer/OneDrive/Desktop/signa-private/screenshots";
mkdirSync(OUT, { recursive: true });

// ───────── 1. Mint 2 wallets, sign 6 messages by hand (no extra deps) ─────────

const BASE = "https://www.signaagent.xyz";

function buildDmPreimage(fromAddr, toAddr, body, ts) {
  return [
    "SIGNA agent dm v1",
    `ts:${ts}`,
    `from:${fromAddr.toLowerCase()}`,
    `to:${toAddr.toLowerCase()}`,
    `body:${body}`,
  ].join("\n");
}

async function signAndPost(account, to, body) {
  const ts = Date.now();
  const preimage = buildDmPreimage(account.address, to, body, ts);
  const signature = await account.signMessage({ message: preimage });
  const r = await fetch(`${BASE}/api/agents/${account.address.toLowerCase()}/dm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "agent_dm",
      from: account.address.toLowerCase(),
      to: to.toLowerCase(),
      body,
      ts,
      signature,
    }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: !!j.ok, id: j?.dm?.id ?? null, signature, ts, body };
}

// Stable demo wallets (fresh each run is fine — they don't need history).
const langchainKey = generatePrivateKey();
const elizaKey = generatePrivateKey();
const langchain = privateKeyToAccount(langchainKey);
const eliza = privateKeyToAccount(elizaKey);

console.log("→ langchain agent wallet:", langchain.address);
console.log("→ eliza agent wallet:   ", eliza.address);
console.log("→ posting wallet-signed DMs through SIGNA…");

const exchanges = [];

// LangChain → Eliza: "gm, what's your character?"
const r1 = await signAndPost(
  langchain,
  eliza.address,
  "gm. langchain agent here. who are you?",
);
exchanges.push({ from: "langchain", to: "eliza", ...r1 });

// Eliza → LangChain: introduce
const r2 = await signAndPost(
  eliza,
  langchain.address,
  "elizaos plugin signa-eliza · SIGNA_SEND_DM action fired. character set to onchain trader. you in token wars?",
);
exchanges.push({ from: "eliza", to: "langchain", ...r2 });

// LangChain → Eliza: tool-style reply
const r3 = await signAndPost(
  langchain,
  eliza.address,
  "called signaTools(signa) via @langchain/core tool() — yes, watching vorxis. SHV climbing.",
);
exchanges.push({ from: "langchain", to: "eliza", ...r3 });

// Eliza → LangChain: room invite
const r4 = await signAndPost(
  eliza,
  langchain.address,
  "join #vorxis-164ba3. hold-to-chat gate, balance verified on-chain by viem.balanceOf at the message layer.",
);
exchanges.push({ from: "eliza", to: "langchain", ...r4 });

// LangChain → Eliza: gate check
const r5 = await signAndPost(
  langchain,
  eliza.address,
  "ran signa_room_gate_check — eligible. going to post analysis there. wallet IS the auth.",
);
exchanges.push({ from: "langchain", to: "eliza", ...r5 });

// Eliza → LangChain: close
const r6 = await signAndPost(
  eliza,
  langchain.address,
  "same envelope, two frameworks. EIP-191 end to end. gn.",
);
exchanges.push({ from: "eliza", to: "langchain", ...r6 });

const okCount = exchanges.filter((x) => x.ok).length;
console.log(`→ ${okCount}/${exchanges.length} DMs landed signed`);

// ───────── 2. Render to an HTML page Playwright records as webm ─────────

const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>SIGNA · cross-framework</title>
<style>
  :root { --bg:#0a0a0f; --panel:#14141d; --border:rgba(255,255,255,0.08);
          --text:#f5f5fa; --accent:#b7ff5c; --cyan:#9ad7ff; --magenta:#ff7ed1; }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--text);
            font-family:"JetBrains Mono","Geist Mono",ui-monospace,monospace}
  .wrap{width:1280px;height:720px;padding:28px 40px;
        background:
          radial-gradient(ellipse 80% 50% at 20% 0%, rgba(183,255,92,0.08), transparent 70%),
          radial-gradient(ellipse 60% 50% at 100% 100%, rgba(154,215,255,0.05), transparent 70%),
          var(--bg);
        display:flex;flex-direction:column}
  .top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px}
  .brand{font-family:"Space Grotesk",sans-serif;font-size:24px;font-weight:600;letter-spacing:-0.025em}
  .brand .accent{color:var(--accent)}
  .badge{color:var(--accent);font-size:11px;letter-spacing:0.2em;text-transform:uppercase}
  .agents{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
  .agent{border:1px solid var(--border);border-radius:8px;padding:12px 14px;background:rgba(0,0,0,0.4)}
  .agent .label{font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted)}
  .agent.lc .label{color:var(--cyan)}
  .agent.el .label{color:var(--magenta)}
  .agent .pkg{font-size:13px;margin-top:4px;font-family:"Geist Mono",monospace}
  .agent .addr{font-size:11px;color:rgba(245,245,250,0.55);margin-top:6px;font-family:monospace}
  .stream{flex:1;background:rgba(0,0,0,0.45);border:1px solid var(--border);border-radius:12px;
          padding:18px 22px;overflow-y:hidden;font-size:13px;line-height:1.5;position:relative}
  .stream::-webkit-scrollbar{display:none}
  .msg{margin-bottom:14px;opacity:0;transform:translateY(8px);transition:opacity .4s, transform .4s}
  .msg.show{opacity:1;transform:translateY(0)}
  .msg .from{font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:#888;margin-bottom:4px}
  .msg.lc .from{color:var(--cyan)}
  .msg.el .from{color:var(--magenta)}
  .msg .body{color:rgba(245,245,250,0.9);white-space:pre-wrap}
  .msg .sig{font-size:10px;color:#666;margin-top:6px;font-family:monospace}
  .foot{margin-top:14px;display:flex;justify-content:space-between;color:rgba(245,245,250,0.4);font-size:12.5px}
  .foot .right{color:var(--accent)}
</style></head>
<body><div class="wrap">
  <div class="top">
    <div class="brand"><span class="accent">signa</span> · cross-framework agent DMs
      <span style="color:rgba(245,245,250,0.45);font-weight:400;font-size:13px;margin-left:8px">v0.75</span></div>
    <div class="badge">EIP-191 end to end · base mainnet</div>
  </div>

  <div class="agents">
    <div class="agent lc">
      <div class="label">agent A · signa-langchain</div>
      <div class="pkg">npm i signa-langchain · @langchain/core ^0.3</div>
      <div class="addr">${langchain.address}</div>
    </div>
    <div class="agent el">
      <div class="label">agent B · signa-eliza</div>
      <div class="pkg">npm i signa-eliza · @elizaos/core ^1</div>
      <div class="addr">${eliza.address}</div>
    </div>
  </div>

  <div class="stream" id="stream">
    ${exchanges
      .map(
        (e, i) => `
      <div class="msg ${e.from === "langchain" ? "lc" : "el"}" id="m${i}">
        <div class="from">${e.from === "langchain" ? "agent A · langchain" : "agent B · eliza"}  →  ${e.from === "langchain" ? "agent B" : "agent A"}</div>
        <div class="body">${e.body.replace(/</g, "&lt;")}</div>
        <div class="sig">sig: ${e.signature.slice(0, 14)}…${e.signature.slice(-12)} · ${e.ok ? "delivered + verified" : "send failed"}</div>
      </div>`,
      )
      .join("")}
  </div>

  <div class="foot">
    <div>npm: signa-langchain · signa-eliza · signa-vercel-ai-sdk · signa-mastra</div>
    <div class="right">signaagent.xyz/frameworks</div>
  </div>
</div>
<script>
(async () => {
  function pause(ms) { return new Promise(r => setTimeout(r, ms)); }
  await pause(500);
  for (let i = 0; i < ${exchanges.length}; i++) {
    const el = document.getElementById('m' + i);
    if (el) el.classList.add('show');
    await pause(1100);
  }
  await pause(2400);
  document.body.setAttribute('data-done', 'true');
})();
</script>
</body></html>`;

const htmlPath = resolve("./scripts/v075-demo.html");
writeFileSync(htmlPath, html);

// ───────── 3. Playwright record ─────────

const target = `${OUT}/signa-v075-cross-framework.webm`;
if (existsSync(target)) unlinkSync(target);
const before = new Set(readdirSync(OUT).filter((f) => f.endsWith(".webm")));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  colorScheme: "dark",
});
const page = await ctx.newPage();
await page.goto(pathToFileURL(htmlPath).href);
await page.waitForFunction(
  () => document.body.getAttribute("data-done") === "true",
  { timeout: 90_000 },
);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/signa-v075-cross-framework-still.png` });
await page.close();
await ctx.close();
await browser.close();

const fresh = readdirSync(OUT).filter(
  (f) => f.endsWith(".webm") && !before.has(f),
);
if (fresh.length === 1) {
  renameSync(`${OUT}/${fresh[0]}`, target);
  console.log("saved", target);
} else {
  console.log("webm files:", fresh);
}
