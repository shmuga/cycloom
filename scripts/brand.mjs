// Builds the favicons and header logo from assets/brand/source.png using Chrome's canvas.
// The source is an app tile (rounded square) on a dark backdrop:
//   favicons / touch icon → the tile cut out with transparent corners
//   logo.png              → just the ribbons, lifted off the tile background (keeps their gradient)
// Usage: npm run brand   (writes into public/)
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const src = 'data:image/png;base64,' + readFileSync('assets/brand/source.png').toString('base64');
mkdirSync('public', { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
const out = await page.evaluate(async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const W = img.width, H = img.height;
  const c0 = new OffscreenCanvas(W, H);
  const g0 = c0.getContext('2d');
  g0.drawImage(img, 0, 0);
  const d = g0.getImageData(0, 0, W, H).data;
  const lum = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const at = (x, y) => (y * W + x) * 4;

  // backdrop = corner colour; the tile is the region a little lighter than it, scanned along the middle row/column
  const back = lum(at(4, 4));
  const tileRow = Math.round(H / 2), tileCol = Math.round(W / 2);
  let tx0 = 0; while (tx0 < W && lum(at(tx0, tileRow)) < back + 5) tx0++;
  let tx1 = W - 1; while (tx1 > 0 && lum(at(tx1, tileRow)) < back + 5) tx1--;
  let ty0 = 0; while (ty0 < H && lum(at(tileCol, ty0)) < back + 5) ty0++;
  let ty1 = H - 1; while (ty1 > 0 && lum(at(tileCol, ty1)) < back + 5) ty1--;
  const side = Math.max(tx1 - tx0, ty1 - ty0) + 1;
  const tcx = (tx0 + tx1) / 2, tcy = (ty0 + ty1) / 2;
  const tsx = tcx - side / 2, tsy = tcy - side / 2;
  // tile colour: sample just inside its top edge, away from the ribbons
  const ti = at(Math.round(tcx), Math.round(ty0 + side * 0.04));
  const tile = [d[ti], d[ti + 1], d[ti + 2]];
  const tileL = lum(ti);
  // corner radius: walk the diagonal from the tile's top-left corner until we are inside the tile
  let k = 0; while (k < side / 2 && lum(at(Math.round(tsx + k), Math.round(tsy + k))) < back + 5) k++;
  const radius = Math.round(k / (1 - Math.SQRT1_2)); // a circle of radius r leaves r(1−1/√2) along the diagonal

  // ribbons: bounding box of pixels clearly brighter than the tile
  let rx0 = W, ry0 = H, rx1 = 0, ry1 = 0;
  for (let y = Math.round(ty0); y < ty1; y++)
    for (let x = Math.round(tx0); x < tx1; x++) {
      if (lum(at(x, y)) > tileL + 40) {
        if (x < rx0) rx0 = x;
        if (x > rx1) rx1 = x;
        if (y < ry0) ry0 = y;
        if (y > ry1) ry1 = y;
      }
    }
  const rs = Math.max(rx1 - rx0, ry1 - ry0) * 1.06;
  const rsx = (rx0 + rx1) / 2 - rs / 2, rsy = (ry0 + ry1) / 2 - rs / 2;

  const png = async (c) => {
    const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const tileIcon = async (size, rounded) => {
    const c = new OffscreenCanvas(size, size);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    if (rounded) {
      g.beginPath();
      g.roundRect(0, 0, size, size, (radius / side) * size);
      g.clip();
    }
    g.drawImage(img, tsx, tsy, side, side, 0, 0, size, size);
    return png(c);
  };
  const ribbons = async (size) => {
    const c = new OffscreenCanvas(size, size);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, rsx, rsy, rs, rs, 0, 0, size, size);
    const id = g.getImageData(0, 0, size, size);
    const p = id.data;
    // un-blend from the tile colour: alpha from brightness above the tile, colour recovered from the blend
    const top = 140; // darkest solid ribbon (blue end) — brighter than this is fully opaque
    for (let i = 0; i < p.length; i += 4) {
      const l = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
      const a = Math.min(1, Math.max(0, (l - tileL - 6) / (top - tileL)));
      for (let ch = 0; ch < 3; ch++) p[i + ch] = a > 0 ? Math.min(255, Math.max(0, (p[i + ch] - tile[ch] * (1 - a)) / a)) : 0;
      p[i + 3] = Math.round(a * 255);
    }
    g.putImageData(id, 0, 0);
    return png(c);
  };
  return {
    info: { back, tile, tileBox: [tx0, ty0, tx1, ty1], side, radius, ribbonBox: [rx0, ry0, rx1, ry1] },
    files: {
      'favicon-32.png': await tileIcon(32, true),
      'favicon-64.png': await tileIcon(64, true),
      'icon-512.png': await tileIcon(512, true),
      // iOS rounds the corners itself and wants an opaque square
      'apple-touch-icon.png': await tileIcon(180, false),
      'logo.png': await ribbons(128),
    },
  };
}, src);
await browser.close();
console.log(JSON.stringify(out.info));
for (const [name, b64] of Object.entries(out.files)) writeFileSync(`public/${name}`, Buffer.from(b64, 'base64'));
console.log('wrote', Object.keys(out.files).join(', '));
