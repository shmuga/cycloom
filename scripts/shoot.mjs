// Screenshot helper: node scripts/shoot.mjs <outDir> [url]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const url = process.argv[3] ?? 'http://localhost:5317/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors = [];
async function page(w, h, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${w}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`${w} console: ${m.text()}`));
  await p.goto(url);
  await p.waitForTimeout(1200);
  return p;
}

const d = await page(1440, 1040);
await d.keyboard.press('Space');
await d.waitForTimeout(6000);
await d.screenshot({ path: `${out}/e1-overview.png`, fullPage: true });
await d.evaluate(() => window.nc.app.zoom(3));
await d.waitForTimeout(1500);
await d.screenshot({ path: `${out}/e2-zoom.png`, fullPage: true });

await d.evaluate(() => window.nc.app.back());
await d.keyboard.press('l');
await d.waitForTimeout(300);
await d.screenshot({ path: `${out}/learn.png`, clip: { x: 1060, y: 230, width: 380, height: 560 } });
await d.keyboard.press('Escape');
await d.evaluate(() => window.nc.app.openMenu());
await d.waitForTimeout(300);
await d.screenshot({ path: `${out}/menu.png` });

const t = await page(900, 1100);
await t.screenshot({ path: `${out}/tablet.png`, fullPage: true });

const m = await page(390, 844, true);
await m.screenshot({ path: `${out}/e3-phone.png`, fullPage: true });
await m.evaluate(() => window.nc.app.zoom(3));
await m.waitForTimeout(1200);
await m.screenshot({ path: `${out}/e4-phone-zoom.png` });

console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
