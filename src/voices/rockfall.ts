import type { Rng } from '../rng';
import { type Pen, depth } from './pen';
import { type Arc, type Hit, type ParamSpec, type StepEnv, Voice, arcAt, makeArc } from './types';

export const ROCKFALL_PARAMS: ParamSpec[] = [
  { key: 'terraces', label: 'terraces', min: 2, max: 6, step: 1, def: 4, fmt: (v) => `${v}` },
  { key: 'restitution', label: 'bounce', min: 0.3, max: 0.85, step: 0.05, def: 0.55, fmt: (v) => v.toFixed(2) },
];

const Y0 = 0.3;
const Y1 = 1.7;

export interface Rock {
  arcs: Arc[];
  /** terrace index per bounce (arcs[i] lands on terraces[i]; the last arc rolls off) */
  terraces: number[];
  y: number;
  spin: number;
  size: number;
}

/**
 * Gestural bursts: rocks tumble down MV-style stairs. Each rock's whole path is planned at release:
 * bounce intervals shrink (accelerando) and every bounce lands on a stair top exactly on a grid step.
 */
export class RockfallVoice extends Voice {
  readonly mode = 'rockfall' as const;
  rocks: Rock[] = [];
  private acc = 0;
  private nextFree = -Infinity;

  constructor(rng: Rng, params?: Record<string, number>) {
    super(rng, ROCKFALL_PARAMS, params);
  }

  slots(): number {
    return Math.round(this.params.terraces);
  }

  /** Width of one stair along x. */
  stairW(): number {
    return 2 / this.slots();
  }

  /** Top height of stair i — highest at the back, descending toward +x. */
  stairZ(i: number): number {
    const n = this.slots();
    return 0.2 + ((n - 1 - i) * 1.2) / n;
  }

  reset(): void {
    this.rocks = [];
    this.acc = 0;
    this.nextFree = -Infinity;
    this.clearFlashes();
  }

  /** Bounce intervals (steps) for one rock: shrinking, never below one step. */
  intervals(slope: number, restitution: number, count: number): number[] {
    let iv = slope < 0.33 ? 4 : slope < 0.66 ? 3 : 2;
    const out: number[] = [];
    let carry = iv;
    for (let j = 0; j < count; j++) {
      out.push(Math.max(1, Math.round(carry)));
      carry *= 0.55 + restitution * 0.5;
      iv = carry;
    }
    void iv;
    return out;
  }

  step(env: StepEnv): Hit[] {
    const out: Hit[] = [];
    const { macros, grid, t } = env;
    this.time = t;
    this.u = grid.stepAt(t);
    this.updateFlashes();
    const boost = this.decayBoost(env.dt);
    this.acc += env.dt * (0.05 + macros.intensity * 0.35 + boost * 0.8);
    if (this.acc >= 1) {
      this.acc -= 1;
      const burst = 1 + (this.rng.chance(macros.randomness * 0.6) ? this.rng.int(1, 3) : 0);
      for (let b = 0; b < burst; b++) this.release(out, env, b * this.rng.int(1, 3));
    }
    this.rocks = this.rocks.filter((r) => r.arcs[r.arcs.length - 1].t1 > t);
    return out;
  }

  private release(out: Hit[], env: StepEnv, stagger: number): void {
    const { macros, grid, t } = env;
    const n = this.slots();
    const w = this.stairW();
    const bounces = n + 1 + (this.rng.chance(macros.randomness) ? this.rng.int(0, 3) : 0);
    const ivs = this.intervals(macros.rotation, this.params.restitution, bounces);
    const maxTau = Math.max(...ivs) * grid.stepSec;
    // gravity chosen so the longest hop peaks ~0.7 world units: same look at any tempo
    const g = (8 * 0.7) / (maxTau * maxTau);
    const dropH = 0.9;
    const tDrop = Math.sqrt((2 * dropH) / g);
    let k = Math.ceil(grid.stepAt(t + Math.max(tDrop, env.horizon) + 0.02)) + stagger;
    k = Math.max(k, this.nextFree);
    const y = 1 + (this.rng.next() - 0.5) * 0.6;
    const jx = () => (this.rng.next() - 0.5) * 0.35 * w;
    const terraces: number[] = [];
    const arcs: Arc[] = [];
    const t0 = grid.timeOfStep(k);
    let prev: [number, number, number] = [0.15 * w + 0.1, y, this.stairZ(0)];
    const startPt: [number, number, number] = [-0.15, y, this.stairZ(0) + dropH];
    arcs.push(makeArc(t0 - tDrop, t0, startPt, prev, g));
    terraces.push(0);
    let strength = 0.95;
    this.hit(out, grid, k, 0, strength);
    let prevT = t0;
    for (let j = 1; j < bounces; j++) {
      k += ivs[j - 1];
      const ti = Math.min(n - 1, Math.round((j * (n - 1)) / Math.max(1, bounces - 2)));
      const pt: [number, number, number] = [(ti + 0.5) * w + jx(), y, this.stairZ(ti)];
      const tk = grid.timeOfStep(k);
      arcs.push(makeArc(prevT, tk, prev, pt, g));
      terraces.push(ti);
      strength *= 0.86;
      this.hit(out, grid, k, ti, strength);
      prev = pt;
      prevT = tk;
    }
    // roll off the front edge (no note)
    const tau = ivs[ivs.length - 1] * grid.stepSec;
    arcs.push(makeArc(prevT, prevT + tau, prev, [2.25, y, -0.5], g));
    terraces.push(-1);
    this.nextFree = k - 2;
    this.rocks.push({ arcs, terraces, y, spin: (this.rng.next() - 0.5) * 8, size: 0.11 + this.rng.next() * 0.05 });
  }

  /** Rock position at time t, or undefined when not in flight. */
  rockAt(r: Rock, t: number): [number, number, number] | undefined {
    if (t < r.arcs[0].t0) return undefined;
    for (const a of r.arcs) if (t <= a.t1) return arcAt(a, t);
    return undefined;
  }

  draw(pen: Pen): void {
    const { pal } = pen;
    const n = this.slots();
    const w = this.stairW();
    // stairs back to front
    for (let i = 0; i < n; i++) {
      const f = this.flashAmount(i);
      pen.box(i * w, Y0, 0, w, Y1 - Y0, this.stairZ(i), pal.blue, pal.blueMid, pal.blueDark);
      if (f > 0) pen.alpha(f, () => pen.poly([[i * w, Y0, this.stairZ(i) + 0.002], [(i + 1) * w, Y0, this.stairZ(i) + 0.002], [(i + 1) * w, Y1, this.stairZ(i) + 0.002], [i * w, Y1, this.stairZ(i) + 0.002]], pal.navy));
    }
    const rocks = this.rocks
      .map((r) => ({ r, p: this.rockAt(r, this.time) }))
      .filter((x): x is { r: Rock; p: [number, number, number] } => !!x.p)
      .sort((a, b) => depth(a.p[0], a.p[1]) - depth(b.p[0], b.p[1]));
    for (const { r, p } of rocks) {
      // remaining part of the current hop, dashed
      const a = r.arcs.find((x) => this.time <= x.t1);
      if (a && a.t1 - this.time > 0.05) {
        const pts: [number, number, number][] = [];
        for (let s = 0; s <= 8; s++) pts.push(arcAt(a, this.time + ((a.t1 - this.time) * s) / 8));
        pen.polyline(pts, pal.light, 1, [3, 4]);
      }
      const s = r.size;
      pen.box(p[0] - s / 2, p[1] - s / 2, p[2], s, s, s, pal.light, pal.pink, pal.mauve);
    }
  }
}
