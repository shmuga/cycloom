import type { Engine } from '../engine/engine';
import { Pen } from '../voices/pen';
import { MUTED_PALETTE, PALETTE } from '../voices/types';
import type { WindVoice } from '../voices/wind';
import { A, ISLAND_THICKNESS, type IslandLayout, type PlinthLayout, type Pt, hitPlinth, iso, layoutIsland } from './iso';

interface Faces {
  top: string;
  left: string;
  right: string;
  label: string;
}

const NORMAL: Faces = { top: '#E5C9D7', left: '#C48CB3', right: '#9A6E93', label: '#0D1E4C' };
const MUTED: Faces = { top: '#6F7C99', left: '#56627F', right: '#434E69', label: '#E5C9D7' };
const SELECTED: Faces = { top: '#C48CB3', left: '#9A6E93', right: '#7A557A', label: '#0D1E4C' };

const STARS: Pt[] = [
  [-180, -100],
  [380, -80],
  [520, 40],
  [-300, 130],
  [260, -130],
  [500, 430],
  [-420, 300],
  [120, -150],
];

export interface Camera {
  cx: number;
  cy: number;
  scale: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export type SceneMode = 'overview' | 'zoom';

/**
 * Draws the island scene into a canvas. One instance per canvas (overview / zoom stage).
 * The camera tweens between the full island and a single plinth.
 */
export class SceneRenderer {
  private g: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  layout: IslandLayout = layoutIsland(6);
  mode: SceneMode;
  focus = 0;
  private tweenFrom: Camera | null = null;
  private tweenStart = 0;
  private tweenMs = 600;
  private cam: Camera = { cx: 0, cy: 0, scale: 1 };
  private zoomAmt = 0; // 0 overview look, 1 zoom look

  constructor(
    readonly canvas: HTMLCanvasElement,
    private engine: Engine,
    mode: SceneMode,
  ) {
    const g = canvas.getContext('2d');
    if (!g) throw new Error('2d canvas unavailable');
    this.g = g;
    this.mode = mode;
    this.zoomAmt = mode === 'zoom' ? 1 : 0;
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  /** Animate from the overview framing into the focused plinth. */
  zoomIn(track: number, now: number): void {
    this.focus = track;
    this.tweenFrom = this.overviewCamera();
    this.tweenStart = now;
    this.zoomAmt = 0;
  }

  setFocus(track: number, now: number): void {
    if (track === this.focus) return;
    this.tweenFrom = { ...this.cam };
    this.focus = track;
    this.tweenStart = now;
  }

  overviewCamera(): Camera {
    const b = this.layout.bounds;
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const scale = Math.min(this.w / bw, this.h / bh);
    return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale };
  }

  /** Frame the focused plinth's top face plus the scene standing on it (up to ~2.6 world units tall). */
  zoomCamera(): Camera {
    const pl = this.layout.plinths[this.focus] ?? this.layout.plinths[0];
    const above = 2.7 * A; // tallest set pieces
    const below = 96 + 40; // front corner of the top face + a little plinth
    const scale = Math.min(this.h / (above + below), this.w / 300);
    return { cx: pl.top[0], cy: pl.top[1] + (below - above) / 2, scale };
  }

  /** Screen point (CSS px) → mock coords. */
  toWorld(x: number, y: number): Pt {
    return [(x - this.w / 2) / this.cam.scale + this.cam.cx, (y - this.h / 2) / this.cam.scale + this.cam.cy];
  }

  pick(x: number, y: number): number {
    const w = this.toWorld(x, y);
    if (this.mode === 'zoom') {
      const n = this.layout.plinths.length;
      const spots = this.ghostSpots();
      for (let k = 0; k < spots.length; k++) {
        const [gx, gy] = spots[k];
        if (Math.abs(w[0] - gx) < 34 && Math.abs(w[1] - gy - 20) < 34) return (this.focus + (k === 0 ? -1 : 1) + n) % n;
      }
      return -1;
    }
    return hitPlinth(this.layout, w);
  }

  render(now: number): void {
    const n = this.engine.state.tracks.length;
    if (this.layout.plinths.length !== n) this.layout = layoutIsland(n);
    if (this.focus >= n) this.focus = Math.max(0, n - 1);
    // camera
    let target = this.mode === 'zoom' ? this.zoomCamera() : this.overviewCamera();
    let zoomTarget = this.mode === 'zoom' ? 1 : 0;
    if (this.tweenFrom) {
      const t = Math.min(1, (now - this.tweenStart) / this.tweenMs);
      const e = ease(t);
      target = { cx: lerp(this.tweenFrom.cx, target.cx, e), cy: lerp(this.tweenFrom.cy, target.cy, e), scale: lerp(this.tweenFrom.scale, target.scale, e) };
      zoomTarget = this.mode === 'zoom' ? e : 1 - e;
      if (t >= 1) this.tweenFrom = null;
    }
    this.cam = target;
    this.zoomAmt = zoomTarget;

    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.mode === 'zoom') {
      g.fillStyle = '#0D1E4C';
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    const s = this.cam.scale * this.dpr;
    g.setTransform(s, 0, 0, s, this.dpr * (this.w / 2) - this.cam.cx * s, this.dpr * (this.h / 2) - this.cam.cy * s);

    // stars
    g.fillStyle = '#83A6CE';
    for (const [x, y] of STARS) {
      g.beginPath();
      g.arc(x, y, 1.6, 0, Math.PI * 2);
      g.fill();
    }
    // real island fades out as we zoom; the E2 fragment + ghost neighbours fade in
    g.globalAlpha = 1 - this.zoomAmt;
    if (g.globalAlpha > 0.01) this.drawIsland();
    g.globalAlpha = 1;
    if (this.zoomAmt > 0.01) this.drawZoomBackdrop();

    const st = this.engine.state;
    const voices = this.engine.voices;
    for (const i of this.layout.order) {
      const pl = this.layout.plinths[i];
      const tr = st.tracks[i];
      const voice = voices[i];
      if (!tr || !voice) continue;
      const isFocus = i === this.focus && this.zoomAmt > 0;
      if (this.zoomAmt > 0 && i !== this.focus) {
        if (this.zoomAmt > 0.99) continue;
        g.globalAlpha = 1 - this.zoomAmt;
      }
      const audible = this.engine.audible(i) || this.engine.journey.isResting(i);
      const faces = !audible ? MUTED : isFocus && this.zoomAmt > 0.5 ? SELECTED : NORMAL;
      this.drawPlinth(pl, faces, String(i + 1).padStart(2, '0'));
      g.save();
      g.translate(pl.top[0], pl.top[1]);
      voice.draw(new Pen(g, audible ? PALETTE : MUTED_PALETTE, 1 / this.cam.scale));
      g.restore();
      g.globalAlpha = 1;
    }
    if (this.mode === 'zoom' && voices[this.focus]?.mode === 'wind') this.drawGustLines(voices[this.focus] as WindVoice);
  }

  /** Island fragment under the focused plinth plus small ghost plinths for the previous/next track (E2). */
  private drawZoomBackdrop(): void {
    const g = this.g;
    const pl = this.layout.plinths[this.focus];
    if (!pl) return;
    const [x, y] = pl.top;
    g.globalAlpha = this.zoomAmt;
    poly(g, [[x, y + 12], [x + 232, y + 128], [x, y + 244], [x - 232, y + 128]], '#83A6CE');
    g.globalAlpha = 0.35 * this.zoomAmt;
    for (const [gx, gy, hgt] of this.ghostSpots()) {
      poly(g, [[gx, gy], [gx + 28, gy + 14], [gx, gy + 28], [gx - 28, gy + 14]], NORMAL.top);
      poly(g, [[gx - 28, gy + 14], [gx, gy + 28], [gx, gy + 28 + hgt], [gx - 28, gy + 14 + hgt]], NORMAL.left);
      poly(g, [[gx + 28, gy + 14], [gx, gy + 28], [gx, gy + 28 + hgt], [gx + 28, gy + 14 + hgt]], NORMAL.right);
    }
    g.globalAlpha = 1;
  }

  /** [x, y, height] of the previous / next ghost plinths, in mock coords. */
  private ghostSpots(): [number, number, number][] {
    const pl = this.layout.plinths[this.focus];
    if (!pl || this.layout.plinths.length < 2) return [];
    const [x, y] = pl.top;
    return [
      [x - 168, y + 8, 16],
      [x + 176, y + 16, 8],
    ];
  }

  private drawIsland(): void {
    const g = this.g;
    const { w, d } = this.layout;
    const T = ISLAND_THICKNESS * A;
    const p00 = iso(0, 0);
    const pw0 = iso(w, 0);
    const pwd = iso(w, d);
    const p0d = iso(0, d);
    poly(g, [p00, pw0, pwd, p0d], '#83A6CE');
    poly(g, [p0d, pwd, [pwd[0], pwd[1] + T], [p0d[0], p0d[1] + T]], '#5E7FA8');
    poly(g, [pwd, pw0, [pw0[0], pw0[1] + T], [pwd[0], pwd[1] + T]], '#3E5F86');
    // stylised underside (as in the mock)
    const F: Pt = [pwd[0], pwd[1] + T];
    const L: Pt = [p0d[0] - pwd[0], p0d[1] - pwd[1]];
    const R: Pt = [pw0[0] - pwd[0], pw0[1] - pwd[1]];
    const add = (a: Pt, k: number, v: Pt, dy = 0): Pt => [a[0] + k * v[0], a[1] + k * v[1] + dy];
    poly(g, [add(F, 0.675, L), F, [F[0], F[1] + 44], add(F, 0.3, L, 64)], '#26415E');
    poly(g, [F, add(F, 0.643, R), add(F, 0.464, R, 62), [F[0], F[1] + 44]], '#1C3354');
  }

  private drawPlinth(pl: PlinthLayout, f: Faces, label: string): void {
    const g = this.g;
    const [x, y] = pl.top;
    const H = pl.h * A;
    poly(g, [[x, y], [x + 96, y + 48], [x, y + 96], [x - 96, y + 48]], f.top);
    poly(g, [[x - 96, y + 48], [x, y + 96], [x, y + 96 + H], [x - 96, y + 48 + H]], f.left);
    poly(g, [[x + 96, y + 48], [x, y + 96], [x, y + 96 + H], [x + 96, y + 48 + H]], f.right);
    g.fillStyle = f.label;
    g.font = `${H < 35 ? 13 : 14}px Outfit, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.fillText(label, x - 48, y + 72 + H / 2 + 4);
  }

  private drawGustLines(v: WindVoice): void {
    const g = this.g;
    const pl = this.layout.plinths[this.focus];
    const k = 1 / 2.5;
    g.save();
    g.translate(pl.top[0] - 600 * k, pl.top[1] - 150 * k);
    g.scale(k, k);
    g.strokeStyle = '#26415E';
    g.lineCap = 'round';
    g.lineWidth = 3;
    g.globalAlpha = 0.4 + 0.6 * v.gustLevel;
    const off = (v.time * 60 * (0.3 + v.gustLevel)) % 80;
    const lines: [number, number, number][] = [
      [40, 120, 480],
      [90, 170, 230],
      [20, 220, 210],
    ];
    for (const [x, y, len] of lines) {
      const sx = x + off - 40;
      g.beginPath();
      g.moveTo(sx, y);
      g.quadraticCurveTo(sx + len / 4, y - 14, sx + len / 2, y + 4);
      g.quadraticCurveTo(sx + (3 * len) / 4, y + 18, sx + len, y - 2);
      g.stroke();
    }
    g.restore();
  }
}

function poly(g: CanvasRenderingContext2D, pts: Pt[], fill: string): void {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}
