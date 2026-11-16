import type { Rng } from '../rng';
import type { Pen } from './pen';
import { type Hit, type ParamSpec, type StepEnv, Voice } from './types';

export const PENDULUM_PARAMS: ParamSpec[] = [
  { key: 'count', label: 'count', min: 3, max: 10, step: 1, def: 6, fmt: (v) => `${v}` },
  { key: 'spread', label: 'spread', min: 1, max: 4, step: 1, def: 1, fmt: (v) => `+${v} step${v > 1 ? 's' : ''}` },
];

const LINTEL = 1.75;
const AMP = 0.55;

/** One stretch of motion with a fixed half-period. Re-anchored only at a crossing (angle 0). */
interface Anchor {
  /** grid position from which this anchor applies (a crossing) */
  from: number;
  /** half-period in steps */
  h: number;
  /** direction sign at `from` */
  s: 1 | -1;
}

/**
 * Minimalist phasing: pendulum i swings through the centre gate every (base + i·spread) steps,
 * so every crossing is on the grid and the pattern drifts in and out of phase (Reich-like).
 */
export class PendulumVoice extends Voice {
  readonly mode = 'pendulum' as const;
  anchors: Anchor[][] = [];
  private planned = -Infinity;
  private reversed = false;
  private kick = 0;

  constructor(rng: Rng, params?: Record<string, number>) {
    super(rng, PENDULUM_PARAMS, params);
  }

  slots(): number {
    return Math.round(this.params.count);
  }

  /** Desired half-period of pendulum i in steps. */
  halfPeriod(i: number, intensity: number): number {
    const base = Math.max(1, Math.round(8 - 6 * intensity));
    return base + i * Math.round(this.params.spread);
  }

  reset(): void {
    this.anchors = [];
    this.planned = -Infinity;
    this.clearFlashes();
  }

  private anchorAt(i: number, u: number): Anchor | undefined {
    const list = this.anchors[i];
    if (!list?.length) return undefined;
    for (let k = list.length - 1; k >= 0; k--) if (list[k].from <= u) return list[k];
    return list[0];
  }

  /** Swing angle (radians) of pendulum i at grid position u; exactly 0 on every planned crossing. */
  angle(i: number, u: number): number {
    const a = this.anchorAt(i, u);
    if (!a || u < a.from) return 0;
    return a.s * (AMP + 0.2 * this.kick) * Math.sin((Math.PI * (u - a.from)) / a.h);
  }

  step(env: StepEnv): Hit[] {
    const out: Hit[] = [];
    const { macros, grid, t } = env;
    this.time = t;
    this.u = grid.stepAt(t);
    this.updateFlashes();
    this.kick = this.decayBoost(env.dt);
    this.reversed = macros.rotation >= 0.5;
    const n = this.slots();
    if (this.anchors.length !== n || this.planned === -Infinity) {
      // everyone starts together at the next reachable step → in phase, then drifts apart
      const start = Math.ceil(grid.stepAt(t + env.horizon));
      this.anchors = Array.from({ length: n }, (_, i) => [{ from: start, h: this.halfPeriod(i, macros.intensity), s: 1 as const }]);
      this.planned = start;
    }
    const to = Math.floor(grid.stepAt(t + env.horizon + 0.05));
    const from = Math.max(this.planned + 1, Math.ceil(grid.stepAt(t + env.horizon)));
    for (let k = from; k <= to; k++) {
      for (let i = 0; i < n; i++) {
        const list = this.anchors[i];
        const a = list[list.length - 1];
        const m = k - a.from;
        if (m <= 0 || m % a.h !== 0) continue;
        const slot = this.reversed ? n - 1 - i : i;
        if (!this.rng.chance(macros.randomness * 0.15)) this.hit(out, grid, k, slot, 0.55 + 0.3 * Math.abs(Math.sin(i * 1.7)) + 0.15 * this.kick);
        // retune at this crossing if the speed changed; keep the swing direction continuous
        const h = this.halfPeriod(i, macros.intensity);
        if (h !== a.h) {
          const s = (a.s * ((m / a.h) % 2 === 0 ? 1 : -1)) as 1 | -1;
          list.push({ from: k, h, s });
          if (list.length > 4) list.splice(0, list.length - 4);
        }
      }
      this.planned = k;
    }
    return out;
  }

  pivotX(i: number): number {
    const n = this.slots();
    return 0.3 + (1.4 * i) / Math.max(1, n - 1);
  }

  length(i: number): number {
    const n = this.slots();
    return 0.95 + 0.6 * (i / Math.max(1, n - 1));
  }

  /** Bob position of pendulum i at grid position u: it swings in the y–z plane through the gate y = 1. */
  bob(i: number, u: number): [number, number, number] {
    const th = this.angle(i, u);
    const L = this.length(i);
    return [this.pivotX(i), 1 + L * Math.sin(th), LINTEL - L * Math.cos(th)];
  }

  draw(pen: Pen): void {
    const { pal } = pen;
    const n = this.slots();
    const u = this.u;
    // the gate the bobs swing through, marked on the plinth top
    pen.line([0.12, 1, 0.005], [1.88, 1, 0.005], pal.navy, 1, [4, 4]);
    pen.cbox(0.1, 1, 0, 0.14, 0.14, LINTEL, pal.blue, pal.blueMid, pal.blueDark);
    const bobs = Array.from({ length: n }, (_, i) => ({ i, p: this.bob(i, u) })).sort((a, b) => a.p[1] - b.p[1]);
    const drawBob = ({ i, p }: { i: number; p: [number, number, number] }) => {
      const slot = this.reversed ? n - 1 - i : i;
      pen.line([this.pivotX(i), 1, LINTEL], p, pal.light, 1);
      pen.dot(p[0], p[1], p[2], 0.075, this.flashing(slot) ? pal.blue : pal.light);
    };
    bobs.filter((b) => b.p[1] < 1).forEach(drawBob);
    pen.box(0.03, 0.93, LINTEL, 1.94, 0.14, 0.14, pal.blue, pal.blueMid, pal.blueDark);
    bobs.filter((b) => b.p[1] >= 1).forEach(drawBob);
    pen.cbox(1.9, 1, 0, 0.14, 0.14, LINTEL, pal.blue, pal.blueMid, pal.blueDark);
  }
}
