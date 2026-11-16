/** Isometric (2:1) layout of the island and its plinths, in mock pixel units (A = 48 px per world unit). */

export const A = 48;
export const COLS = 3;
export const HEIGHTS = [1.0, 1.6, 0.6, 1.3, 0.8, 2.0];
export const ISLAND_THICKNESS = 1.2;

export type Pt = [number, number];

export function iso(x: number, y: number, z = 0): Pt {
  return [(x - y) * A, ((x + y) * A) / 2 - z * A];
}

export interface PlinthLayout {
  track: number;
  x0: number;
  y0: number;
  h: number; // world units
  /** screen position (mock px, origin = island back corner) of the plinth's top back vertex */
  top: Pt;
}

export interface IslandLayout {
  w: number;
  d: number;
  plinths: PlinthLayout[];
  /** draw order (back to front) */
  order: number[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

export function layoutIsland(n: number): IslandLayout {
  const rows = Math.max(1, Math.ceil(n / COLS));
  const w = 3 * COLS + 1;
  const d = 3 * rows + 1;
  const plinths: PlinthLayout[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = 1 + 3 * (i % COLS);
    const y0 = 1 + 3 * Math.floor(i / COLS);
    const h = HEIGHTS[i % HEIGHTS.length];
    plinths.push({ track: i, x0, y0, h, top: iso(x0, y0, h) });
  }
  const order = plinths
    .map((p) => p.track)
    .sort((a, b) => plinths[a].x0 + plinths[a].y0 - (plinths[b].x0 + plinths[b].y0) || plinths[a].y0 - plinths[b].y0);
  const left = iso(0, d)[0];
  const right = iso(w, 0)[0];
  const front = iso(w, d)[1] + ISLAND_THICKNESS * A + 44;
  return { w, d, plinths, order, bounds: { x0: left - 20, y0: -120, x1: right + 20, y1: front } };
}

/**
 * Which plinth (track index) is under a point in mock coordinates, or -1.
 * Pass 1 tests the solid bodies (top face + sides) front to back; pass 2 the set-piece space above each top.
 */
export function hitPlinth(layout: IslandLayout, p: Pt): number {
  for (const above of [false, true]) {
    for (let k = layout.order.length - 1; k >= 0; k--) {
      const pl = layout.plinths[layout.order[k]];
      const [tx, ty] = pl.top;
      const H = pl.h * A;
      const x = p[0] - tx;
      const y = p[1] - ty;
      if (Math.abs(x) > 96) continue;
      const faceTop = Math.abs(x) / 2;
      const bottom = 96 - Math.abs(x) / 2 + H;
      if (!above && y >= faceTop && y <= bottom) return pl.track;
      if (above && Math.abs(x) < 60 && y >= faceTop - 110 && y < faceTop) return pl.track;
    }
  }
  return -1;
}
