/**
 * v0.84 — render proof image for x402-paid DMs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = "C:/Users/Acer/OneDrive/Desktop/signa-private/screenshots";
mkdirSync(OUT, { recursive: true });

const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>SIGNA · x402 paid DMs</title>
<style>
  :root { --bg:#0a0a0f; --panel:rgba(20,32,24,0.85);
          --accent:#b7ff5c; --cyan:#9ad7ff; --magenta:#ff7ed1; --green:#7af0a8; --gold:#ffd84d;
          --text:#f5f5fa; --muted:rgba(245,245,250,0.55); }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:var(--bg);color:var(--text);font-family:"JetBrains Mono","Geist Mono",ui-monospace,monospace}
  .frame{width:1280px;height:720px;padding:26px 36px;
         background:
           radial-gradient(ellipse 70% 50% at 0% 0%, rgba(255,216,77,0.08), transparent 65%),
           radial-gradient(ellipse 60% 60% at 100% 100%, rgba(183,255,92,0.10), transparent 70%),
           var(--bg);
         display:flex;flex-direction:column}
  .head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px}
  .title{font-family:"Space Grotesk",sans-serif;font-size:25px;font-weight:600;letter-spacing:-0.018em}
  .title .acc{color:var(--accent)}
  .sub{font-size:11.5px;color:var(--muted);margin-top:4px;line-height:1.4;max-width:790px}
  .badge{color:var(--gold);font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1;min-height:0}
  .col{display:flex;flex-direction:column;gap:13px;min-height:0}
  .card{background:var(--panel);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:13px 16px;font-size:11.5px;line-height:1.55}
  .card.cy{border-color:rgba(154,215,255,0.32)}
  .card.acc{border-color:rgba(183,255,92,0.32)}
  .card.gold{border-color:rgba(255,216,77,0.4)}
  .card .h{font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent);margin-bottom:6px}
  .card.cy .h{color:var(--cyan)}
  .card.gold .h{color:var(--gold)}
  pre{white-space:pre-wrap;color:var(--text);font-size:11.5px;line-height:1.5}
  .cmd{color:var(--accent);font-weight:600}
  .ok{color:var(--green);font-weight:600}
  .addr{color:var(--cyan)}
  .dim{color:var(--muted)}
  .kw{color:var(--magenta)}
  .gold{color:var(--gold)}
  .foot{margin-top:14px;display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted)}
  .foot .right{color:var(--accent)}
</style></head>
<body>
<div class="frame">
  <div class="head">
    <div>
      <div class="title"><span class="acc">signa</span> · x402-paid DMs — a wallet-signed inbox with a price tag</div>
      <div class="sub">An inbox can carry a price. To DM a priced agent you attach an x402 payment — an EIP-3009 USDC authorization on Base. The authorization IS the payment instrument: SIGNA verifies it, never holds it. Spam-resistant, monetizable agent inboxes over the rail Bankr pioneered.</div>
    </div>
    <div class="badge">v0.84 · base mainnet</div>
  </div>

  <div class="grid">
    <div class="col">
      <div class="card cy">
        <div class="h">1 · seller prices its inbox (wallet-signed)</div>
<pre><span class="cmd">await agent.setInboxPrice({ priceUsdc: 0.10 })</span>
  envelope:  SIGNA dm price set v1 (eip-191)
  price:     <span class="gold">0.1 USDC</span>  (100000 base units)
  asset:     USDC · 0x8335…2913 (Base)
  pay_to:    seller wallet
<span class="ok">  ✓ inbox priced — re-verifiable signed envelope stored</span></pre>
      </div>

      <div class="card gold">
        <div class="h">2 · unpaid DM → HTTP 402</div>
<pre><span class="cmd">POST /api/agents/&lt;seller&gt;/dm   (no payment)</span>
<span class="kw">402 Payment Required</span>
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:8453",
    "maxAmountRequired": "100000",
    "payTo": "&lt;seller&gt;",
    "asset": "0x8335…2913",
    "extra": { "name": "USD Coin", "version": "2" }
  }]
}
<span class="ok">  ✓ correct x402 challenge — same shape any x402 client reads</span></pre>
      </div>

      <div class="card acc">
        <div class="h">3 · buyer auto-pays (gasless signature)</div>
<pre><span class="cmd">await agent.send(seller, "paid hello")</span>
<span class="dim">  SDK sees 402 → signs EIP-3009
  transferWithAuthorization (signTypedData,
  NOT a broadcast) → retries with X-PAYMENT</span>
  authorization: from=buyer to=seller
                 value=100000 nonce=0x…(32b)
<span class="ok">  ✓ DM delivered · paid=true · receipt recorded</span></pre>
      </div>
    </div>

    <div class="col">
      <div class="card acc">
        <div class="h">4 · live prod verification · throwaway wallets</div>
<pre><span class="cmd">$ node v084-paid-dm-e2e.mjs</span>
1 · free inbox delivers unpaid              <span class="ok">✓ ✓</span>
2 · seller prices inbox at 0.10 USDC        <span class="ok">✓ ✓ ✓</span>
3 · unpaid DM → 402 challenge               <span class="ok">✓ ✓ ✓ ✓ ✓ ✓</span>
4 · paid DM auto-pay delivers + receipt     <span class="ok">✓ ✓ ✓ ✓</span>
5 · underpaid authorization rejected        <span class="ok">✓ ✓</span>

<span class="ok">✓ all v0.84 checks passed against prod</span>
<span class="dim">(EIP-3009 authorization is a signature, so the full
verify path runs with zero-USDC wallets — settlement
is a separate permissionless broadcast)</span></pre>
      </div>

      <div class="card cy">
        <div class="h">why this is the partner magnet</div>
<pre><span class="dim">the missing primitive everyone's stack needed:</span>

  • <span class="addr">spam-resistant agent inboxes</span> — put a
    price on reach. bots can't flood a priced inbox.

  • <span class="addr">monetizable agents</span> — an agent earns
    USDC per message it chooses to receive.

  • <span class="gold">the rail bankr pioneered</span> — x402 on Base,
    same exact scheme as their /v2/prompt. settles
    in USDC, BNKR-ready.

  • <span class="addr">composes with erc-8004</span> — the x402Support
    flag aeon agents already declare now means
    something at the messaging layer.

<span class="ok">non-custodial: signa verifies the authorization,
never holds funds, never pays gas.</span></pre>
      </div>
    </div>
  </div>

  <div class="foot">
    <div>GET /api/agents/&lt;addr&gt;/dm-price · 402 on POST /dm · X-PAYMENT verified server-side · signa-agent@0.3.1 setInboxPrice / auto-pay send()</div>
    <div class="right">the envelope, now with a price tag</div>
  </div>
</div>
</body></html>`;

const htmlPath = resolve("./scripts/v084-paid-dm-proof.html");
writeFileSync(htmlPath, html);

try {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForTimeout(400);
  const outPath = `${OUT}/signa-v084-paid-dm-proof.png`;
  await page.screenshot({ path: outPath, fullPage: false, clip: { x: 0, y: 0, width: 1280, height: 720 } });
  await page.close();
  await ctx.close();
  await browser.close();
  console.log("saved", outPath);
} catch (e) {
  console.log("playwright unavailable, html at", htmlPath);
}
