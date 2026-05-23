/**
 * verify-ui-live.mjs
 *
 * Headless Playwright drive of the production agent page. Confirms:
 *   - page renders without runtime errors
 *   - the "$ miroshark sim" toggle exists and is interactive
 *   - opening the drawer reveals the textarea + "Connect wallet" CTA
 *     (since no wallet is injected in the headless browser, this is
 *     the expected disconnected-state UI)
 *   - no JS console errors during the flow
 *   - the /api/x402/info probe response is reachable from the page
 *
 * This does NOT exercise the wallet popup or actual sign step —
 * those need a real wallet extension. But it proves every part of
 * our UI from page load → drawer open → connect button visible
 * works end-to-end in a real Chromium DOM.
 */

import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const URL =
  process.env.SIGNA_AGENT_URL ||
  "https://www.signaagent.xyz/agent/0x000000000000000000000000000000000000a9e1";

const SHOT_DIR = "scripts/.ui-shots";

async function main() {
  console.log(`→  launching headless chromium`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    // Block WalletConnect's relay so wagmi auto-init doesn't hang
    // trying to phone home. We're testing OUR code, not WC's.
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const networkFails = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (/relay\.walletconnect|verify\.walletconnect/i.test(text)) return;
      consoleErrors.push(text);
    }
  });
  page.on("requestfailed", (req) => {
    if (/walletconnect/i.test(req.url())) return;
    // Next.js auto-prefetches HEAD requests for fast nav; they abort
    // when the test closes the page. Benign.
    if (
      req.method() === "HEAD" &&
      req.failure()?.errorText === "net::ERR_ABORTED"
    )
      return;
    // RSC prefetches also abort on page teardown.
    if (/\?_rsc=/.test(req.url()) && req.failure()?.errorText === "net::ERR_ABORTED")
      return;
    networkFails.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  // Log non-OK responses so we can see what's behind the 400/403 noise.
  page.on("response", (resp) => {
    const status = resp.status();
    if (status >= 400 && status < 600) {
      const url = resp.url();
      if (/walletconnect/i.test(url)) return;
      networkFails.push(`HTTP ${status} ${resp.request().method()} ${url}`);
    }
  });

  console.log(`→  navigating to ${URL}`);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {
    console.log("   networkidle didn't settle in 30s (expected if wallet auto-connect keeps trying — moving on)");
  });

  console.log(`→  shot 1: initial page load`);
  await writeFile(
    `${SHOT_DIR}/01-initial.png`,
    await page.screenshot({ fullPage: false }),
  );

  // Locate the "$ miroshark sim" toggle. The text contains a unicode
  // dollar sign + "miroshark sim" — case-sensitive.
  console.log(`→  locating $ miroshark sim toggle`);
  const toggle = page.locator('button:has-text("miroshark sim")').first();
  await toggle.waitFor({ state: "visible", timeout: 15_000 });
  const toggleText = (await toggle.innerText()).trim();
  console.log(`   found: ${toggleText.replace(/\n/g, " | ")}`);

  console.log(`→  clicking to open drawer`);
  await toggle.click();
  // The drawer reveals a textarea + buttons. Wait for either the
  // textarea OR the "checking network…" / "Connect wallet" state.
  await page.waitForSelector(
    'textarea[placeholder*="holders"], button:has-text("Connect wallet"), button:has-text("checking network")',
    { timeout: 15_000 },
  );

  console.log(`→  shot 2: drawer open, disconnected state`);
  await writeFile(
    `${SHOT_DIR}/02-drawer-open.png`,
    await page.screenshot({ fullPage: false }),
  );

  // Probe the chain-agnostic /api/x402/info from the page to confirm
  // it's reachable from the SAME ORIGIN (the page's JS uses it).
  console.log(`→  fetching /api/x402/info from the page context`);
  const probe = await page.evaluate(async () => {
    const r = await fetch("/api/x402/info");
    return r.ok ? r.json() : { ok: false, status: r.status };
  });
  console.log("   probe:", JSON.stringify(probe, null, 2));

  // Verify the expected state buttons are present.
  console.log(`→  checking UI states`);
  const connectBtn = page.locator('button:has-text("Connect wallet")');
  const checkingBtn = page.locator('button:has-text("checking network")');
  const hasConnect = (await connectBtn.count()) > 0;
  const hasChecking = (await checkingBtn.count()) > 0;
  console.log(`   "Connect wallet" button present:    ${hasConnect}`);
  console.log(`   "checking network…" button present: ${hasChecking}`);

  // Try typing a scenario to make sure the textarea works
  const textarea = page.locator('textarea[placeholder*="holders"]');
  if ((await textarea.count()) > 0) {
    await textarea.fill("playwright verification fire");
    const val = await textarea.inputValue();
    console.log(`   textarea accepts input: "${val}"`);
  }

  console.log(`→  shot 3: with scenario typed`);
  await writeFile(
    `${SHOT_DIR}/03-scenario-typed.png`,
    await page.screenshot({ fullPage: false }),
  );

  console.log(`\n=== summary ===`);
  console.log(`page url:           ${page.url()}`);
  console.log(`page title:         ${await page.title()}`);
  console.log(`drawer opens:       ${hasConnect || hasChecking ? "YES" : "NO"}`);
  console.log(`probe reachable:    ${probe.ok ? "YES (" + probe.network + ")" : "NO"}`);
  console.log(`console errors:     ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.log(`   first 5:`);
    consoleErrors.slice(0, 5).forEach((e) => console.log(`     - ${e.slice(0, 200)}`));
  }
  console.log(`network fails:      ${networkFails.length}`);
  if (networkFails.length > 0) {
    networkFails.slice(0, 5).forEach((e) => console.log(`     - ${e}`));
  }

  const success =
    (hasConnect || hasChecking) &&
    probe.ok &&
    consoleErrors.length === 0 &&
    networkFails.length === 0;

  await browser.close();
  if (success) {
    console.log("\n✅  UI verification PASSED — Aaron's click-through will render correctly.");
    process.exit(0);
  } else {
    console.log("\n❌  UI verification has issues — see above.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n❌  unexpected error:", e);
  process.exit(1);
});
