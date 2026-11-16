import type { Rng } from '../rng';
import type { Pen } from './pen';
import { type Hit, type ParamSpec, type StepEnv, Voice } from './types';

export const WAVES_PARAMS: ParamSpec[] = [
  { key: 'buoys', label: 'buoys', min: 2, max: 7, step: 1, def: 4, fmt: (v) => `${v}` },
  { key: 'swell', label: 'period', min: 4, max: 16, step: 2, def: 8, fmt: (v) => `${v} steps` },
  { key: 'chop', label: 'chop', min: 0, max: 1, step: 0.05, def: 0.25, fmt: (v) => v.toFixed(2) },
];

const X0 = 0.15;
const X1 = 1.85;
const LEVEL = 0.1;

/**
 * Sustained: a swell travels across a basin. Its period is a whole number of steps and the buoys are
 * spaced so a crest reaches each buoy exactly on a step; the note holds while the crest is up.
 */
export class WavesVoice extends Voice {
  readonly mode = 'waves' as const;
  private planned = -Infinity;
  private amp = 0.12;
  private dir = 1;
  private envPhase: number;
  private chopPhase = 0;

  constructor(rng: Rng, params?: Record<string, number>) {
    super(rng, WAVES_PARAMS, params);
    this.envPhase = rng.range(0, Math.PI * 2);
  }

  slots(): number {
    return Math.round(this.params.buoys);
  }

  period(): number {
    return Math.max(2, Math.round(this.params.swell));
  }

  /** Steps for a crest to travel from one buoy to the next. */
  travel(): number {
    return Math.max(1, Math.round(this.period() / this.slots()));
  }

  spacing(): number {
    return (X1 - X0) / this.slots();
  }

  buoyX(i: number): number {
    return X0 + this.spacing() * (i + 0.5);
  }

  /** Step offset (mod period) at which a crest passes buoy i. */
  offset(i: number): number {
    const n = this.slots();
    return (this.dir > 0 ? i : n - 1 - i) * this.travel();
  }

  envelope(u: number): number {
    return 0.65 + 0.35 * Math.sin((2 * Math.PI * u) / (this.period() * 5.3) + this.envPhase);
  }

  /** Swell height (no chop) at x and grid position u. Crests (cos = 1) hit buoys on integer u. */
  swell(x: number, u: number): number {
    return this.amp * this.envelope(u) * this.carrier(x, u);
  }

  /** Travelling crest train, −1..1; exactly 1 at a buoy on each of its integer crest steps. */
  carrier(x: number, u: number): number {
    const n = this.slots();
    const ref = this.dir > 0 ? this.buoyX(0) : this.buoyX(n - 1);
    const steps = (this.dir * (x - ref) * this.travel()) / this.spacing();
    return Math.cos((2 * Math.PI * (u - steps)) / this.period());
  }

  height(x: number, u: number): number {
    return this.swell(x, u) + this.params.chop * 0.025 * Math.sin(19 * x + 2.7 * u + this.chopPhase);
  }

  reset(): void {
    this.planned = -Infinity;
    this.clearFlashes();
  }

  step(env: StepEnv): Hit[] {
    const out: Hit[] = [];
    const { macros, grid, t } = env;
    this.time = t;
    this.u = grid.stepAt(t);
    this.updateFlashes();
    const boost = this.decayBoost(env.dt);
    this.amp = 0.05 + macros.intensity * 0.17 + boost * 0.06;
    this.dir = macros.rotation < 0.5 ? 1 : -1;
    this.chopPhase += env.dt * macros.randomness * 2;
    const P = this.period();
    const n = this.slots();
    const from = Math.max(this.planned + 1, Math.ceil(grid.stepAt(t + env.horizon)));
    const to = Math.floor(grid.stepAt(t + env.horizon + 0.05));
    for (let k = from; k <= to; k++) {
      for (let i = 0; i < n; i++) {
        if ((((k - this.offset(i)) % P) + P) % P !== 0) continue;
        const level = this.amp * this.envelope(k);
        if (level < 0.06 || this.rng.chance(macros.randomness * 0.25)) continue;
        this.hit(out, grid, k, i, 0.4 + 0.6 * Math.min(1, level / 0.2), Math.max(0.15, P * 0.4 * grid.stepSec));
      }
      this.planned = k;
    }
    return out;
  }

  draw(pen: Pen): void {
    const { pal } = pen;
    const u = this.u;
    const n = this.slots();
    // basin floor
    pen.poly([[X0, X0, 0.01], [X1, X0, 0.01], [X1, X1, 0.01], [X0, X1, 0.01]], pal.blueDark);
    const rows = 8;
    const buoyRow = 1;
    let buoysDrawn = false;
    for (let r = 0; r <= rows; r++) {
      const y = X0 + ((X1 - X0) * r) / rows;
      if (!buoysDrawn && y > buoyRow) {
        this.drawBuoys(pen, n, u);
        buoysDrawn = true;
      }
      const top: [number, number, number][] = [];
      for (let s = 0; s <= 24; s++) {
        const x = X0 + ((X1 - X0) * s) / 24;
        top.push([x, y, LEVEL + this.height(x, u)]);
      }
      const ribbon: [number, number, number][] = [...top, [X1, y, 0.01], [X0, y, 0.01]];
      pen.poly(ribbon, r % 2 ? pal.blue : pal.blueMid);
      pen.polyline(top, pal.light, r % 2 ? 1 : 0.6);
    }
    if (!buoysDrawn) this.drawBuoys(pen, n, u);
  }

  private drawBuoys(pen: Pen, n: number, u: number): void {
    const { pal } = pen;
    for (let i = 0; i < n; i++) {
      const x = this.buoyX(i);
      const z = LEVEL + this.height(x, u);
      const f = this.flashAmount(i, 0.5);
      pen.cbox(x, 1, z - 0.04, 0.07, 0.07, 0.32, pal.light, pal.pink, pal.mauve);
      pen.dot(x, 1, z + 0.36, 0.06, f > 0 ? pal.navy : pal.light);
      if (f > 0) pen.alpha(f, () => pen.ring(x, 1, z, 0.1 + (1 - f) * 0.25, pal.light, 1.2));
    }
  }
}
