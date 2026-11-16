import type { Rng } from '../rng';
import { type Pen, depth } from './pen';
import { type Arc, type Hit, type ParamSpec, type StepEnv, Voice, arcAt, makeArc } from './types';

export const DROPS_PARAMS: ParamSpec[] = [
  { key: 'paddles', label: 'stones', min: 2, max: 6, step: 1, def: 4, fmt: (v) => `${v}` },
  { key: 'gravity', label: 'gravity', min: 0.3, max: 2, step: 0.1, def: 0.8, fmt: (v) => `${v.toFixed(1)} g` },
  { key: 'splash', label: 'splash', min: 0, max: 1, step: 0.05, def: 0.5, fmt: (v) => v.toFixed(2) },
];

/** Height a drop falls from its spout to the stone below (world units). */
export const FALL = 1.6;

export interface Stone {
  x: number;
  y: number;
  /** top surface height above the plinth */
  z: number;
}

export interface Drop {
  arc: Arc;
  slot: number;
  /** main drop (falls from a spout) or splash droplet */
  main: boolean;
}

/**
 * Pointillistic: spouts above a ring of stepping-stones release drops timed so that every drop
 * lands on a grid step. Splashes are thrown onto a neighbouring stone one or two steps later (ratchets).
 */
export class DropsVoice extends Voice {
  readonly mode = 'drops' as const;
  drops: Drop[] = [];
  stones: Stone[] = [];
  private nextPlan: number | null = null;
  private lastStone = 0;
  private rotation = -1;

  constructor(rng: Rng, params?: Record<string, number>) {
    super(rng, DROPS_PARAMS, params);
    this.layout(0.15);
  }

  slots(): number {
    return Math.round(this.params.paddles);
  }

  setParam(key: string, value: number): void {
    super.setParam(key, value);
    this.layout(Math.max(0, this.rotation));
  }

  /** Stones on a ring around the plinth centre; rotation turns the ring. Heights differ so fall times differ. */
  layout(rotation: number): void {
    this.rotation = rotation;
    const n = this.slots();
    this.stones = Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n + rotation * Math.PI;
      const r = n === 2 ? 0.45 : 0.55;
      return { x: 1 + Math.cos(a) * r, y: 1 + Math.sin(a) * r, z: 0.12 + 0.5 * ((i * 0.618 + 0.2) % 1) };
    });
  }

  gravity(): number {
    return this.params.gravity * 18;
  }

  /** Seconds a drop takes to fall from its spout. */
  fallTime(): number {
    return Math.sqrt((2 * FALL) / this.gravity());
  }

  reset(): void {
    this.drops = [];
    this.nextPlan = null;
    this.clearFlashes();
  }

  step(env: StepEnv): Hit[] {
    const out: Hit[] = [];
    const { macros, grid, t } = env;
    this.time = t;
    this.u = grid.stepAt(t);
    this.updateFlashes();
    if (Math.abs(macros.rotation - this.rotation) > 0.004) this.layout(macros.rotation);
    const boost = this.decayBoost(env.dt);
    const g = this.gravity();
    const fall = this.fallTime();
    const lead = Math.max(fall, env.horizon) + 0.02;
    if (this.nextPlan === null) this.nextPlan = Math.ceil(grid.stepAt(t + lead));
    // plan every step whose landing time is now within reach
    while (grid.timeOfStep(this.nextPlan) - lead <= t) {
      const k = this.nextPlan++;
      const tk = grid.timeOfStep(k);
      if (tk - t < env.horizon) continue; // too late to send in time: skip
      const perSec = 0.15 + 3.5 * macros.intensity + 4 * boost;
      const p = Math.min(1, perSec * grid.stepSec * (1 + (this.rng.next() - 0.5) * macros.randomness));
      if (!this.rng.chance(p)) continue;
      const n = this.stones.length;
      // low randomness walks to a neighbouring stone (melodic); high randomness jumps anywhere
      const i = this.rng.chance(macros.randomness) ? this.rng.int(0, n) : (this.lastStone + (this.rng.chance(0.5) ? 1 : n - 1)) % n;
      this.lastStone = i;
      const st = this.stones[i];
      const jitter = () => (this.rng.next() - 0.5) * 0.12;
      const land: [number, number, number] = [st.x + jitter(), st.y + jitter(), st.z];
      this.drops.push({ arc: makeArc(tk - fall, tk, [land[0], land[1], st.z + FALL], land, g), slot: i, main: true });
      const strength = 0.6 + 0.3 * this.rng.next();
      this.hit(out, grid, k, i, strength);
      // splash: a droplet hops to a neighbour stone, landing on a later step
      if (this.rng.chance(this.params.splash * 0.6)) {
        const j = (i + (this.rng.chance(0.5) ? 1 : n - 1)) % n;
        const k2 = k + (this.rng.chance(0.6) ? 1 : 2);
        const t2 = grid.timeOfStep(k2);
        const st2 = this.stones[j];
        this.drops.push({ arc: makeArc(tk, t2, land, [st2.x, st2.y, st2.z], g), slot: j, main: false });
        this.hit(out, grid, k2, j, strength * 0.5);
      }
    }
    this.drops = this.drops.filter((d) => d.arc.t1 > t - 0.02);
    return out;
  }

  /** Where a drop is at time t (undefined before release / after landing). */
  dropAt(d: Drop, t: number): [number, number, number] | undefined {
    if (t < d.arc.t0 || t > d.arc.t1) return undefined;
    return arcAt(d.arc, t);
  }

  draw(pen: Pen): void {
    const { pal } = pen;
    const items: { d: number; draw: () => void }[] = [];
    this.stones.forEach((st, i) => {
      const f = this.flashAmount(i);
      items.push({
        d: depth(st.x, st.y),
        draw: () => {
          pen.cbox(st.x, st.y, 0, 0.34, 0.34, st.z, f > 0.6 ? pal.navy : i % 2 ? pal.light : pal.blue, i % 2 ? pal.pink : pal.blueMid, i % 2 ? pal.mauve : pal.blueDark);
          if (f > 0) pen.alpha(f, () => pen.ring(st.x, st.y, st.z, 0.08 + (1 - f) * 0.3, pal.light, 1.5));
          // spout above the stone
          pen.cbox(st.x, st.y, st.z + FALL + 0.02, 0.13, 0.13, 0.13, pal.light, pal.pink, pal.mauve);
        },
      });
    });
    for (const d of this.drops) {
      const p = this.dropAt(d, this.time);
      if (!p) continue;
      items.push({ d: depth(p[0], p[1]) + 0.01, draw: () => pen.dot(p[0], p[1], p[2] + 0.04, d.main ? 0.045 : 0.03, pal.light) });
    }
    items.sort((a, b) => a.d - b.d).forEach((it) => it.draw());
  }
}
