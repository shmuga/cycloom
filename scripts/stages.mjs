// Screenshot every zoomed stage while playing: node scripts/stages.mjs <outDir>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(process.argv[3] ?? 'http://localhost:5317/');
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForTimeout(800);
await p.evaluate(() => window.nc.store.update((s) => { s.journey.voices = 6; s.journey.rest = 0; s.tracks.forEach((t) => (t.mute = false)); }));
await p.keyboard.press('Space');
await p.waitForTimeout(4000);
await p.screenshot({ path: `${out}/overview.png`, clip: { x: 0, y: 230, width: 1080, height: 640 } });
for (let i = 0; i < 6; i++) {
  await p.evaluate((k) => window.nc.app.zoom(k), i);
  await p.waitForTimeout(2200);
  const box = await p.locator('.stage').boundingBox();
  await p.screenshot({ path: `${out}/stage-${i + 1}.png`, clip: box });
}
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
