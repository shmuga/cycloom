import type { Palette } from './types';

/** World units → mock pixels (matches the island layout). */
export const ISO_A = 48;

export type V3 = [number, number, number];

/** 2:1 isometric projection: x runs right-down, y left-down, z up. */
export function project(x: number, y: number, z: number): [number, number] {
  return [(x - y) * ISO_A, ((x + y) * ISO_A) / 2 - z * ISO_A];
}

/** Painter's depth: larger is nearer the viewer. */
export const depth = (x: number, y: number, z = 0): number => x + y + z * 0.001;

/**
 * Drawing helpers in plinth-local world coordinates. The canvas transform is already set so that
 * the plinth's top back vertex is the origin and one mock pixel = one unit of `project`.
 */
export class Pen {
  constructor(
    readonly g: CanvasRenderingContext2D,
    readonly pal: Palette,
    /** One screen pixel in mock-pixel units (for hairlines). */
    readonly px: number,
  ) {}

  p(x: number, y: number, z: number): [number, number] {
    return project(x, y, z);
  }

  poly(pts: V3[], fill?: string, stroke?: string, lwPx = 1): void {
    const g = this.g;
    g.beginPath();
    pts.forEach(([x, y, z], i) => {
      const [sx, sy] = project(x, y, z);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    });
    g.closePath();
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = lwPx * this.px;
      g.stroke();
    }
  }

  /** Axis-aligned box from (x,y,z) extending +w in x, +d in y, +h in z. Draws the three visible faces. */
  box(x: number, y: number, z: number, w: number, d: number, h: number, top: string, left: string, right: string): void {
    const x1 = x + w;
    const y1 = y + d;
    const z1 = z + h;
    // +y face (screen left), +x face (screen right), top
    this.poly([[x, y1, z], [x1, y1, z], [x1, y1, z1], [x, y1, z1]], left);
    this.poly([[x1, y, z], [x1, y1, z], [x1, y1, z1], [x1, y, z1]], right);
    this.poly([[x, y, z1], [x1, y, z1], [x1, y1, z1], [x, y1, z1]], top);
  }

  /** Box centred on (cx, cy) in plan. */
  cbox(cx: number, cy: number, z: number, w: number, d: number, h: number, top: string, left: string, right: string): void {
    this.box(cx - w / 2, cy - d / 2, z, w, d, h, top, left, right);
  }

  line(a: V3, b: V3, stroke: string, lwPx = 1, dash?: number[]): void {
    const g = this.g;
    const [ax, ay] = project(...a);
    const [bx, by] = project(...b);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.strokeStyle = stroke;
    g.lineWidth = Math.max(lwPx * this.px, 0.5);
    if (dash) g.setLineDash(dash.map((d) => d * this.px));
    g.stroke();
    if (dash) g.setLineDash([]);
  }

  polyline(pts: V3[], stroke: string, lwPx = 1, dash?: number[]): void {
    const g = this.g;
    g.beginPath();
    pts.forEach(([x, y, z], i) => {
      const [sx, sy] = project(x, y, z);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    });
    g.strokeStyle = stroke;
    g.lineWidth = Math.max(lwPx * this.px, 0.5);
    if (dash) g.setLineDash(dash.map((d) => d * this.px));
    g.stroke();
    if (dash) g.setLineDash([]);
  }

  /** Screen-facing disc (a sphere or droplet) of world radius r. */
  dot(x: number, y: number, z: number, r: number, fill: string): void {
    const [sx, sy] = project(x, y, z);
    const g = this.g;
    g.beginPath();
    g.arc(sx, sy, Math.max(r * ISO_A, 1.2 * this.px), 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
  }

  /** Circle lying on a horizontal plane at height z — projects to a 2:1 ellipse. */
  ring(cx: number, cy: number, z: number, r: number, stroke?: string, lwPx = 1, fill?: string): void {
    const [sx, sy] = project(cx, cy, z);
    const g = this.g;
    g.beginPath();
    g.ellipse(sx, sy, r * ISO_A * Math.SQRT2, (r * ISO_A * Math.SQRT2) / 2, 0, 0, Math.PI * 2);
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = Math.max(lwPx * this.px, 0.5);
      g.stroke();
    }
  }

  /** Point on a horizontal circle (angle a measured in the x–y plane). */
  onRing(cx: number, cy: number, z: number, r: number, a: number): V3 {
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];
  }

  alpha(a: number, fn: () => void): void {
    const prev = this.g.globalAlpha;
    this.g.globalAlpha = prev * Math.max(0, Math.min(1, a));
    fn();
    this.g.globalAlpha = prev;
  }
}
