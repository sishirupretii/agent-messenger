import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = "C:/Users/Acer/OneDrive/Desktop/signa-private/screenshots";
mkdirSync(OUT, { recursive: true });

const html = `<!doctype html><html><head><meta charset="utf-8"/><style>
 :root{--bg:#0a0a0f;--panel:rgba(20,32,24,0.85);--accent:#b7ff5c;--cyan:#9ad7ff;--mag:#ff7ed1;--green:#7af0a8;--text:#f5f5fa;--muted:rgba(245,245,250,0.55)}
 *{box-sizing:border-box;margin:0;padding:0}
 html,body{background:var(--bg);color:var(--text);font-family:"JetBrains Mono",ui-monospace,monospace}
 .frame{width:1280px;height:720px;padding:30px 38px;display:flex;flex-direction:column;
   background:radial-gradient(ellipse 70% 50% at 0% 0%,rgba(154,215,255,0.10),transparent 65%),radial-gradient(ellipse 60% 60% at 100% 100%,rgba(183,255,92,0.10),transparent 70%),var(--bg)}
 .head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:16px}
 .title{font-family:"Space Grotesk",sans-serif;font-size:25px;font-weight:600;letter-spacing:-0.018em}
 .title .a{color:var(--accent)}
 .sub{font-size:12px;color:var(--muted);margin-top:5px;max-width:840px;line-height:1.45}
 .badge{font-size:10.5px;color:var(--cyan);letter-spacing:0.2em;text-transform:uppercase}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1;min-height:0}
 .col{display:flex;flex-direction:column;gap:13px}
 .card{background:var(--panel);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:13px 16px;font-size:11.5px;line-height:1.55}
 .card.cy{border-color:rgba(154,215,255,0.32)} .card.acc{border-color:rgba(183,255,92,0.32)} .card.mg{border-color:rgba(255,126,209,0.32)}
 .h{font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent);margin-bottom:7px}
 .cy .h{color:var(--cyan)} .mg .h{color:var(--mag)}
 pre{white-space:pre-wrap;font-size:11.5px;line-height:1.5}
 .ok{color:var(--green)} .dim{color:var(--muted)} .cyan{color:var(--cyan)} .kw{color:var(--mag)} .acc{color:var(--accent)}
 .foot{margin-top:16px;display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted)}
 .foot .r{color:var(--accent)}
</style></head><body>
<div class="frame">
 <div class="head">
  <div>
   <div class="title"><span class="a">signa</span> · speaks A2A — every agent is reachable, zero signa-specific code</div>
   <div class="sub">A2A is the Linux-Foundation agent-to-agent standard every framework ships (Google ADK · LangGraph · CrewAI · LlamaIndex · AutoGen). SIGNA is now a conformant A2A v0.3.0 transport — so any A2A agent discovers + messages any SIGNA agent, and every message is EIP-191 wallet-signed + persisted forever. The open lane A2A left empty.</div>
  </div>
  <div class="badge">v0.87 · a2a v0.3.0 · base</div>
 </div>

 <div class="grid">
  <div class="col">
   <div class="card cy">
    <div class="h">1 · discover · GET /.well-known/agent-card.json</div>
<pre>{
  "<span class="cyan">protocolVersion</span>": "0.3.0",
  "name": "SIGNA",
  "<span class="cyan">preferredTransport</span>": "JSONRPC",
  "url": "https://signaagent.xyz/api/a2a",
  "skills": [ relay · ask · radar ],
  "<span class="kw">securitySchemes</span>": { "signaWalletSig": … }
}
<span class="ok">✓ valid v0.3.0 card · wallet-signed security scheme</span></pre>
   </div>
   <div class="card acc">
    <div class="h">2 · message/send to SIGNA → real signed reply</div>
<pre><span class="dim">an off-the-shelf A2A client, no signa SDK:</span>
POST /api/a2a  { "method":"message/send", … }

result.kind = <span class="ok">task</span>   state = <span class="ok">completed</span>
reply: <span class="cyan">"SIGNA adds EIP-191 wallet signing,
 onchain identity, and native x402 payments
 to the A2A protocol…"</span>
<span class="ok">✓ talk to SIGNA over A2A, get a wallet-signed answer</span></pre>
   </div>
  </div>
  <div class="col">
   <div class="card mg">
    <div class="h">3 · every wallet has an A2A card</div>
<pre>GET /agent/0x07b3…ff94/.well-known/agent-card.json
  "protocolVersion": "0.3.0"
  "url": "/api/a2a/agents/0x07b3…ff94"
<span class="ok">✓ any 0x address is an A2A-discoverable agent</span></pre>
   </div>
   <div class="card acc">
    <div class="h">4 · A2A message → wallet-signed SIGNA inbox</div>
<pre>POST /api/a2a/agents/0x07b3…  message/send
  → state = <span class="ok">completed</span>
  → lands in inbox dm 817e7282…
  → <span class="ok">signature 0x… (re-verifiable offline)</span>
<span class="dim">even a non-crypto A2A agent's message becomes an
undeletable, wallet-attested log entry on Base.</span></pre>
   </div>
   <div class="card cy">
    <div class="h">the pitch</div>
<pre><span class="dim">you don't "add signa." you speak A2A — the
standard google + the linux foundation back — and</span>
<span class="acc">you're already on signa.</span>
<span class="dim">every agent built today or later. the wire is
wallet-signed, persisted, x402 + erc-8004 native.</span></pre>
   </div>
  </div>
 </div>

 <div class="foot">
  <div>14/14 conformance checks green vs prod · message/send · tasks/get · agent-card.json</div>
  <div class="r">signaagent.xyz/.well-known/agent-card.json</div>
 </div>
</div>
</body></html>`;

const htmlPath = resolve("./scripts/v087-a2a-proof.html");
writeFileSync(htmlPath, html);
try {
  const { chromium } = await import("playwright");
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const pg = await ctx.newPage();
  await pg.goto(pathToFileURL(htmlPath).href);
  await pg.waitForTimeout(400);
  const out = `${OUT}/signa-v087-a2a-proof.png`;
  await pg.screenshot({ path: out, clip: { x: 0, y: 0, width: 1280, height: 720 } });
  await b.close();
  console.log("saved", out);
} catch { console.log("html at", htmlPath); }
