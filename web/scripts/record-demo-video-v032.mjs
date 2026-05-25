import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { renameSync, readdirSync, mkdirSync, existsSync, unlinkSync } from "node:fs";

const OUT = "C:/Users/Acer/OneDrive/Desktop/signa-private/screenshots";
mkdirSync(OUT, { recursive: true });
const html = resolve("./scripts/demo-video-v032.html");

const target = `${OUT}/signa-mcp-v032-partners.webm`;
if (existsSync(target)) unlinkSync(target);

const before = new Set(readdirSync(OUT).filter((f) => f.endsWith(".webm")));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  colorScheme: "dark",
});
const page = await ctx.newPage();
await page.goto(pathToFileURL(html).href);
await page.waitForFunction(() => document.body.getAttribute("data-done") === "true", { timeout: 60_000 });
await page.waitForTimeout(500);
await page.close();
await ctx.close();
await browser.close();

const fresh = readdirSync(OUT).filter((f) => f.endsWith(".webm") && !before.has(f));
if (fresh.length === 1) {
  renameSync(`${OUT}/${fresh[0]}`, target);
  console.log("saved", target);
} else {
  console.log("multiple new files:", fresh);
}
