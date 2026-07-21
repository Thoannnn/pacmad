import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "tmp-char-shots");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__pacmadDebug);
await page.evaluate(() => window.__pacmadDebug.openCharSelect());
await page.waitForTimeout(500);
const ids = await page.evaluate(() => window.__pacmadDebug.characters());
for (let i = 0; i < ids.length; i++) {
  await page.evaluate((idx) => window.__pacmadDebug.setCharPick(idx), i);
  await page.waitForTimeout(600);
  await page.locator("#char-preview").screenshot({ path: path.join(OUT, `${ids[i]}.png`) });
  await page.screenshot({ path: path.join(OUT, `${ids[i]}-full.png`) });
  console.log("shot", ids[i]);
}
await browser.close();
console.log("done", OUT);
