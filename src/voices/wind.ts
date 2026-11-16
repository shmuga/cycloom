import type { Rng } from '../rng';
import { type Pen, depth } from './pen';
import { type Hit, type ParamSpec, type StepEnv, Voice } from './types';

export const WIND_PARAMS: ParamSpec[] = [
  { key: 'chimes', label: 'chimes', min: 3, max: 8, step: 1, def: 5, fmt: (v) => `${v}` },
  { key: 'gust', label: 'gust', min: 1, max: 8, step: 1, def: 4, fmt: (v) => `${v} bars` },
];

const BEAM_Z = 2.1;
const CX0 = 0.38;
const CX1 = 1.62;
const EDGE = 0.05;
const BODY = 0.42;

export interface Leaf {
  /** grid position at which the leaf passes its first chime */
  uFirst: number;
  /** steps per chime spacing (1 = fast run) */
  k: number;
  dir: 1 | -1;
  y: number;
  z: number;
  wob: number;
  phase: number;
}

/**
 * Melodic runs: gusts carry leaves along an ordered row of chimes. A leaf moves on the grid — one
 * chime spacing every k steps — so every strike is on a step and runs come out stepwise.
 */
export class WindVoice extends Voice {
  readonly mode = 'wind' as const;
  leaves: Leaf[] = [];
  gustLevel = 0;
  private gustPhase: number;
  private acc = 0;

  constructor(rng: Rng, params?: Record<string, number>) {
    super(rng, WIND_PARAMS, params);
    this.gustPhase = rng.range(0, Math.PI * 2);
  }

  slots(): number {
    return Math.round(this.params.chimes);
  }

  spacing(): number {
    return (CX1 - CX0) / Math.max(1, this.slots() - 1);
  }

  chimeX(c: number): number {
    return CX0 + this.spacing() * c;
  }

  /** Bottom of chime body c (bodies hang at different heights). */
  chimeBottom(c: number): number {
    return 0.55 + 0.45 * ((c * 0.618 + 0.3) % 1);
  }

  reset(): void {
    this.leaves = [];
    this.acc = 0;
    this.clearFlashes();
  }

  /** Grid position at which a leaf is at x. */
  leafX(l: Leaf, u: number): number {
    const first = l.dir > 0 ? this.chimeX(0) : this.chimeX(this.slots() - 1);
    return first + (l.dir * (u - l.uFirst) * this.spacing()) / l.k;
  }

  leafZ(l: Leaf, u: number): number {
    return l.z + l.wob * Math.sin(l.phase + 0.9 * (u - l.uFirst));
  }

  step(env: StepEnv): Hit[] {
    const out: Hit[] = [];
    const { macros, grid, t } = env;
    this.time = t;
    this.u = grid.stepAt(t);
    this.updateFlashes();
    const boost = this.decayBoost(env.dt);
    const gustSec = this.params.gust * 4 * env.beatSec;
    const e = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / gustSec + this.gustPhase) * Math.cos((2 * Math.PI * t) / (gustSec * 2.7));
    this.gustLevel = Math.min(1, e * e + boost);
    const rate = (0.2 + 2.2 * macros.intensity) * (0.15 + 0.85 * this.gustLevel);
    this.acc += env.dt * rate;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.launch(out, env);
    }
    const n = this.slots();
    this.leaves = this.leaves.filter((l) => this.u < l.uFirst + (n + 1) * l.k);
    return out;
  }

  private launch(out: Hit[], env: StepEnv): void {
    const { macros, grid, t } = env;
    const n = this.slots();
    const dir: 1 | -1 = macros.rotation < 0.5 ? 1 : -1;
    const k = this.gustLevel > 0.6 ? 1 : this.gustLevel > 0.3 ? 2 : 3;
    const sp = this.spacing();
    // steps needed to fly in from the edge to the first chime
    const inSteps = ((dir > 0 ? this.chimeX(0) - EDGE : 2 - EDGE - this.chimeX(n - 1)) / sp) * k;
    const uFirst = Math.ceil(grid.stepAt(t) + inSteps + env.horizon / grid.stepSec + 0.05);
    const leaf: Leaf = {
      uFirst,
      k,
      dir,
      y: 1 + (this.rng.next() - 0.5) * 0.3,
      z: 0.55 + this.rng.next() * 0.75,
      wob: 0.08 + macros.randomness * 0.3,
      phase: this.rng.range(0, Math.PI * 2),
    };
    this.leaves.push(leaf);
    for (let j = 0; j < n; j++) {
      const c = dir > 0 ? j : n - 1 - j;
      const u = uFirst + j * k;
      const z = this.leafZ(leaf, u);
      const b = this.chimeBottom(c);
      if (z >= b - 0.04 && z <= b + BODY + 0.04) this.hit(out, grid, u, c, 0.35 + 0.65 * (1 / k));
    }
  }

  draw(pen: Pen): void {
    const { pal } = pen;
    const n = this.slots();
    const u = this.u;
    // flag at the back corner (as in the mock), waving with the gust
    pen.cbox(0.18, 0.18, 0, 0.05, 0.05, 2.6, pal.light, pal.pink, pal.mauve);
    const wave = Math.sin(this.time * 7) * (0.04 + 0.12 * this.gustLevel);
    const len = 0.6 + 0.35 * this.gustLevel;
    pen.poly([[0.18, 0.18, 2.6], [0.18 + len * 0.7, 0.18 - len * 0.7, 2.47 + wave], [0.18, 0.18, 2.32]], pal.pink);

    const items: { d: number; draw: () => void }[] = [];
    // frame: posts + beam along x at y = 1
    items.push({ d: depth(0.12, 1), draw: () => pen.cbox(0.12, 1, 0, 0.08, 0.08, BEAM_Z + 0.08, pal.light, pal.pink, pal.mauve) });
    items.push({ d: depth(1.88, 1), draw: () => pen.cbox(1.88, 1, 0, 0.08, 0.08, BEAM_Z + 0.08, pal.light, pal.pink, pal.mauve) });
    items.push({ d: depth(0.5, 1) - 0.5, draw: () => pen.box(0.08, 0.96, BEAM_Z, 1.84, 0.08, 0.08, pal.light, pal.pink, pal.mauve) });
    for (let c = 0; c < n; c++) {
      const x = this.chimeX(c);
      const b = this.chimeBottom(c);
      const f = this.flashAmount(c, 0.8);
      // struck chimes swing toward the viewer (+y) and settle
      const sw = f > 0 ? Math.sin((1 - f) * 18) * f * 0.18 : 0;
      items.push({
        d: depth(x, 1 + sw),
        draw: () => {
          pen.line([x, 1, BEAM_Z], [x, 1 + sw, b + BODY], pal.blue, 1.2);
          const hot = this.flashing(c);
          pen.cbox(x, 1 + sw, b, 0.1, 0.1, BODY, hot ? pal.navy : pal.light, hot ? pal.navy : pal.pink, hot ? pal.navy : pal.mauve);
        },
      });
    }
    for (const l of this.leaves) {
      const x = this.leafX(l, u);
      if (x < -0.1 || x > 2.1) continue;
      const z = this.leafZ(l, u);
      const a = l.phase + u * 1.7;
      items.push({
        d: depth(x, l.y),
        draw: () => {
          const r = 0.06;
          pen.poly(
            [
              [x + Math.cos(a) * r, l.y, z + Math.sin(a) * r * 0.5],
              [x, l.y + r * 0.6, z],
              [x - Math.cos(a) * r, l.y, z - Math.sin(a) * r * 0.5],
              [x, l.y - r * 0.6, z],
            ],
            pal.light,
          );
        },
      });
    }
    items.sort((a, b) => a.d - b.d).forEach((it) => it.draw());
  }
}
