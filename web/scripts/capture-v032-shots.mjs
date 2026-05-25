import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = "C:/Users/Acer/OneDrive/Desktop/signa-private/screenshots/v032";
mkdirSync(OUT, { recursive: true });
const BASE = "https://www.signaagent.xyz";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const page = await ctx.newPage();
async function shot(url, name, opts = {}) {
  console.log(`→ ${url}`);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  if (opts.scrollTo !== undefined) {
    await page.evaluate((y) => window.scrollTo(0, y), opts.scrollTo);
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!opts.full });
  console.log(`  saved ${name}.png`);
}
await shot(`${BASE}/partners`, "01-partners-hero");
await shot(`${BASE}/partners`, "02-partners-grid", { scrollTo: 720 });
await shot(`${BASE}/partners`, "03-partners-activity", { scrollTo: 1500 });
await shot(`${BASE}/partners`, "04-partners-full", { full: true });
await shot(`${BASE}/partners/aeon`, "05-aeon-hero");
await shot(`${BASE}/partners/bankr`, "06-bankr-launches", { scrollTo: 500 });
await shot(`${BASE}/partners/gitlawb`, "07-gitlawb");
await shot(`${BASE}/partners/miroshark`, "08-miroshark");
await browser.close();
console.log("done:", OUT);
