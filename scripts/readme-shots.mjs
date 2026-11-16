// README screenshots → docs/screens/. Needs the dev server: npm run dev -- --port 5317, then npm run readme-shots
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'docs/screens';
const url = process.argv[2] ?? 'http://localhost:5317/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });

async function page(w, h, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, ...opts });
  const p = await ctx.newPage();
  await p.goto(url);
  await p.waitForTimeout(900);
  // quiet the "MIDI unavailable" toast so it doesn't land in the pictures
  await p.addStyleTag({ content: '.toast { display: none !important; }' });
  return p;
}

/** Lay PNG buffers out on a grid (in a blank page's canvas) and return one PNG. */
async function grid(buffers, cols, gap, bg) {
  const p = await browser.newPage();
  const b64 = await p.evaluate(
    async ({ srcs, cols, gap, bg }) => {
      const imgs = await Promise.all(
        srcs.map(async (s) => {
          const i = new Image();
          i.src = 'data:image/png;base64,' + s;
          await i.decode();
          return i;
        }),
      );
      const w = Math.max(...imgs.map((i) => i.width));
      const h = Math.max(...imgs.map((i) => i.height));
      const rows = Math.ceil(imgs.length / cols);
      const c = new OffscreenCanvas(cols * w + (cols + 1) * gap, rows * h + (rows + 1) * gap);
      const g = c.getContext('2d');
      g.fillStyle = bg;
      g.fillRect(0, 0, c.width, c.height);
      imgs.forEach((i, k) => g.drawImage(i, gap + (k % cols) * (w + gap), gap + Math.floor(k / cols) * (h + gap)));
      const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    { srcs: buffers.map((b) => b.toString('base64')), cols, gap, bg },
  );
  await p.close();
  return Buffer.from(b64, 'base64');
}

// 1. overview, playing
const d = await page(1440, 900);
await d.keyboard.press('Space');
await d.waitForTimeout(7000);
await d.screenshot({ path: `${out}/overview.png` });

// 2. one track zoomed (wind), with its four settings columns
await d.evaluate(() => window.nc.app.zoom(3));
await d.waitForTimeout(2500);
await d.screenshot({ path: `${out}/zoom.png` });

// 3. the six physics modes, one stage each
const stages = [];
for (let i = 0; i < 6; i++) {
  await d.evaluate((i) => window.nc.app.setFocus(i), i);
  await d.waitForTimeout(2200);
  // centre crop around the plinth (the stage canvas spans the full width)
  const box = await d.locator('.stage').boundingBox();
  const w = Math.min(box.width, 620);
  stages.push(await d.screenshot({ clip: { x: box.x + box.width / 2 - w / 2, y: box.y + 20, width: w, height: box.height - 40 } }));
}
writeFileSync(`${out}/modes.png`, await grid(stages, 3, 24, '#0D1E4C'));

// 4. phone: overview + zoomed track side by side
const m = await page(390, 844, { isMobile: true, hasTouch: true });
await m.evaluate(() => window.nc.app.togglePlay());
await m.waitForTimeout(5000);
const phone1 = await m.screenshot();
await m.evaluate(() => window.nc.app.zoom(1));
await m.waitForTimeout(2500);
const phone2 = await m.screenshot();
writeFileSync(`${out}/phone.png`, await grid([phone1, phone2], 2, 40, '#0D1E4C'));

// 5. presets sheet
const s = await page(1440, 900);
await s.click('[aria-label="Presets"]');
await s.waitForTimeout(400);
await s.locator('.sheet-in').screenshot({ path: `${out}/presets.png` });

await browser.close();
console.log('wrote overview, zoom, modes, phone, presets →', out);
