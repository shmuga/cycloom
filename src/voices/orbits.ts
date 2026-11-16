import type { Rng } from '../rng';
import { type Pen, depth } from './pen';
import { type Hit, type ParamSpec, type StepEnv, Voice } from './types';

export const RATIO_SETS = [
  [1, 2, 3],
  [2, 3, 4],
  [3, 4, 5],
  [1, 3, 5, 7],
  [2, 3, 5],
] as const;

export const ORBITS_PARAMS: ParamSpec[] = [
  { key: 'ratios', label: 'ratios', min: 0, max: RATIO_SETS.length - 1, step: 1, def: 1, fmt: (v) => RATIO_SETS[Math.round(v)].join(':') },
  { key: 'rays', label: 'rays', min: 1, max: 6, step: 1, def: 3, fmt: (v) => `${v}` },
];

const CX = 1;
const CY = 1;
const PLANE = 1.0;
const SPHERE = 0.3;

interface Anchor {
  from: number;
  /** steps between ray crossings */
  c: number;
  /** ray index the body sits on at `from` */
  ray: number;
  rays: number;
}

/**
 * Strict polymeter: body j crosses a gate ray every q_j × unit steps (q from the ratio set),
 * so every crossing is on the grid and the bodies interlock as a polyrhythm.
 */
export class OrbitsVoice extends Voice {
  readonly mode = 'orbits' as const;
  anchors: Anchor[][] = [];
  private planned = -Infinity;
  private rot = 0;

  constructor(rng: Rng, params?: Record<string, number>) {
    super(rng, ORBITS_PARAMS, params);
  }

  get ratios(): readonly number[] {
    return RATIO_SETS[Math.round(this.params.ratios)] ?? RATIO_SETS[0];
  }

  rays(): number {
    return Math.round(this.params.rays);
  }

  slots(): number {
    return this.ratios.length * this.rays();
  }

  unit(intensity: number): number {
    return Math.max(1, Math.round(4 - 3 * intensity));
  }

  ringR(j: number): number {
    return 0.48 + j * (0.45 / Math.max(1, this.ratios.length - 1));
  }

  reset(): void {
    this.anchors = [];
    this.planned = -Infinity;
    this.clearFlashes();
  }

  /** Visual rotation of the whole system (rays + bodies together, so timing is unchanged). */
  rayAngle(k: number, rays = this.rays()): number {
    return (2 * Math.PI * k) / rays + this.rot * 2 * Math.PI;
  }

  /** Angle of body j at grid position u; equals a ray angle exactly on every planned crossing. */
  bodyAngle(j: number, u: number): number {
    const list = this.anchors[j];
    if (!list?.length) return this.rayAngle(0);
    let a = list[0];
    for (const x of list) if (x.from <= u) a = x;
    const pos = a.ray + (u - a.from) / a.c;
    return (2 * Math.PI * pos) / a.rays + this.rot * 2 * Math.PI;
  }

  step(env: StepEnv): Hit[] {
    const out: Hit[] = [];
    const { macros, grid, t } = env;
    this.time = t;
    this.u = grid.stepAt(t);
    this.updateFlashes();
    const boost = this.decayBoost(env.dt);
    this.rot = macros.rotation;
    const rs = this.ratios;
    const R = this.rays();
    const unit = Math.max(1, this.unit(Math.min(1, macros.intensity + boost * 0.5)));
    if (this.anchors.length !== rs.length || this.planned === -Infinity) {
      const start = Math.ceil(grid.stepAt(t + env.horizon));
      this.anchors = rs.map((q, j) => [{ from: start, c: q * unit, ray: j % R, rays: R }]);
      this.planned = start - 1;
    }
    const to = Math.floor(grid.stepAt(t + env.horizon + 0.05));
    const from = Math.max(this.planned + 1, Math.ceil(grid.stepAt(t + env.horizon)));
    for (let k = from; k <= to; k++) {
      rs.forEach((q, j) => {
        const list = this.anchors[j];
        const a = list[list.length - 1];
        const m = k - a.from;
        if (m <= 0 || m % a.c !== 0) return;
        const ray = (a.ray + m / a.c) % a.rays;
        if (!this.rng.chance(macros.randomness * 0.25)) this.hit(out, grid, k, j * R + (ray % R), 0.5 + (0.5 * (rs.length - j)) / rs.length);
        const c = q * unit;
        if (c !== a.c || R !== a.rays) list.push({ from: k, c, ray: ray % R, rays: R });
        if (list.length > 4) list.splice(0, list.length - 4);
      });
      this.planned = k;
    }
    return out;
  }

  bodyPos(j: number, u: number): [number, number, number] {
    const a = this.bodyAngle(j, u);
    const r = this.ringR(j);
    return [CX + Math.cos(a) * r, CY + Math.sin(a) * r, PLANE];
  }

  draw(pen: Pen): void {
    const { pal } = pen;
    const rs = this.ratios;
    const R = this.rays();
    const u = this.u;
    // shadow on the plinth top
    pen.ring(CX, CY, 0.005, SPHERE * 0.9, undefined, 1, pal.mauve);
    for (let j = 0; j < rs.length; j++) pen.ring(CX, CY, PLANE, this.ringR(j), pal.blue, 1.4);
    const outer = this.ringR(rs.length - 1) + 0.06;
    for (let k = 0; k < R; k++) {
      const a = this.rayAngle(k);
      let hot = false;
      for (let j = 0; j < rs.length; j++) hot = hot || this.flashing(j * R + k);
      pen.line([CX + Math.cos(a) * SPHERE, CY + Math.sin(a) * SPHERE, PLANE], [CX + Math.cos(a) * outer, CY + Math.sin(a) * outer, PLANE], hot ? pal.light : pal.blueMid, 1.4);
    }
    const bodies = rs.map((_q, j) => ({ j, p: this.bodyPos(j, u) }));
    const cd = depth(CX, CY);
    const drawBody = ({ j, p }: { j: number; p: [number, number, number] }) => {
      let hot = false;
      for (let k = 0; k < R; k++) hot = hot || this.flashing(j * R + k);
      pen.dot(p[0], p[1], p[2], j === 0 ? 0.075 : 0.06, hot ? pal.light : pal.pink);
    };
    bodies.filter((b) => depth(b.p[0], b.p[1]) < cd).forEach(drawBody);
    // sphere with a flat shaded half (light from the left, as in the mock)
    const [sx, sy] = pen.p(CX, CY, PLANE);
    const g = pen.g;
    const r = SPHERE * 48;
    g.beginPath();
    g.arc(sx, sy, r, 0, Math.PI * 2);
    g.fillStyle = pal.blue;
    g.fill();
    g.beginPath();
    g.arc(sx, sy, r, -Math.PI / 2, Math.PI / 2);
    g.closePath();
    g.fillStyle = pal.blueDark;
    g.fill();
    bodies.filter((b) => depth(b.p[0], b.p[1]) >= cd).forEach(drawBody);
  }
}
