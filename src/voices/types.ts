import type { Rng } from '../rng';
import type { Pen } from './pen';

export const MODE_IDS = ['drops', 'waves', 'rockfall', 'wind', 'pendulum', 'orbits'] as const;
export type ModeId = (typeof MODE_IDS)[number];

export interface Macros {
  intensity: number;
  color: number;
  rotation: number;
  randomness: number;
}

/**
 * A track's rhythmic grid, as seen by a voice. Steps are the track's division with swing applied:
 * integer step k sounds at timeOfStep(k); stepAt(t) is the (fractional) step position at time t,
 * piecewise-linear so that integers land exactly on the swung steps.
 */
export interface Grid {
  /** Average seconds per step (unswung). */
  stepSec: number;
  stepAt(t: number): number;
  timeOfStep(k: number): number;
}

export interface Hit {
  /** Simulation time (seconds) at which the collision happens — always exactly timeOfStep(step). */
  t: number;
  /** Integer grid step of the collision. */
  step: number;
  slot: number;
  strength: number;
  /** Optional note length in seconds (waves hold while a crest is up). */
  length?: number;
}

export interface StepEnv {
  dt: number;
  /** Simulation time at the end of this step (= audio time while playing). */
  t: number;
  beatSec: number;
  macros: Macros;
  grid: Grid;
  /** Hits must be reported at least this many seconds before they happen (MIDI is sent ahead). */
  horizon: number;
}

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  fmt?: (v: number) => string;
}

export interface Palette {
  light: string;
  pink: string;
  blue: string;
  navy: string;
  line: string;
  deep: string;
  mauve: string;
  pinkDark: string;
  blueMid: string;
  blueDark: string;
}

export const PALETTE: Palette = {
  light: '#E5C9D7',
  pink: '#C48CB3',
  blue: '#83A6CE',
  navy: '#0D1E4C',
  line: '#26415E',
  deep: '#0B1B32',
  mauve: '#9A6E93',
  pinkDark: '#7A557A',
  blueMid: '#5E7FA8',
  blueDark: '#3E5F86',
};

export const MUTED_PALETTE: Palette = {
  light: '#8E98B2',
  pink: '#6F7C99',
  blue: '#6F7C99',
  navy: '#26415E',
  line: '#434E69',
  deep: '#26415E',
  mauve: '#56627F',
  pinkDark: '#434E69',
  blueMid: '#56627F',
  blueDark: '#434E69',
};

export const FLASH_SEC = 0.12;

export abstract class Voice {
  abstract readonly mode: ModeId;
  readonly params: Record<string, number>;
  /** slot → time of last hit, for drawing flashes */
  readonly flashes = new Map<number, number>();
  /** Current simulation time (set by step). */
  time = 0;
  /** Current grid position (fractional step) — for drawing periodic motion. */
  u = 0;
  protected rng: Rng;
  protected boost = 0;

  constructor(rng: Rng, specs: ParamSpec[], params: Record<string, number> = {}) {
    this.rng = rng;
    this.params = {};
    for (const s of specs) this.params[s.key] = params[s.key] ?? s.def;
  }

  setParam(key: string, value: number): void {
    this.params[key] = value;
  }

  abstract slots(): number;

  /** Advance to env.t. Returns hits planned for the future (each at least env.horizon ahead). */
  abstract step(env: StepEnv): Hit[];

  /** Draw in plinth-local iso space: origin = plinth top back vertex, footprint 2 × 2, z up. */
  abstract draw(pen: Pen): void;

  /** Drop everything in flight and re-anchor periodic motion (transport start/stop). */
  abstract reset(): void;

  /** External nudge from a listened-to track: raises activity for a moment. */
  nudge(amount: number): void {
    this.boost = Math.min(1, this.boost + 0.5 * amount);
  }

  /** Decay the nudge boost; call once per step. */
  protected decayBoost(dt: number): number {
    this.boost *= Math.exp(-dt / 2);
    return this.boost;
  }

  /** Planned hit at grid step k. Flashes appear when the sim reaches that time — exactly when it sounds. */
  protected hit(out: Hit[], grid: Grid, k: number, slot: number, strength: number, length?: number): void {
    const t = grid.timeOfStep(k);
    out.push({ t, step: k, slot, strength: Math.max(0, Math.min(1, strength)), length });
    this.pendingFlashes.push([slot, t]);
  }

  private pendingFlashes: [number, number][] = [];

  /** Promote planned flashes whose time has come (call at the start of step). */
  protected updateFlashes(): void {
    const keep: [number, number][] = [];
    for (const [slot, t] of this.pendingFlashes) {
      if (t <= this.time) this.flashes.set(slot, t);
      else keep.push([slot, t]);
    }
    this.pendingFlashes = keep;
  }

  /**
   * Set the time used for drawing. Motion is analytic (arcs, phases, crest trains), so a frame can be
   * drawn at its exact time between scheduler ticks; planned flashes due by then are promoted.
   */
  view(t: number, u: number): void {
    this.time = t;
    this.u = u;
    this.updateFlashes();
  }

  protected clearFlashes(): void {
    this.pendingFlashes = [];
    this.flashes.clear();
  }

  flashing(slot: number): boolean {
    const t = this.flashes.get(slot);
    return t !== undefined && this.time - t < FLASH_SEC && this.time >= t;
  }

  /** 0..1 decay since the last flash of a slot (1 = just hit). */
  flashAmount(slot: number, decay = 0.35): number {
    const t = this.flashes.get(slot);
    if (t === undefined || this.time < t) return 0;
    return Math.max(0, 1 - (this.time - t) / decay);
  }
}

/** Ballistic segment between two points, landing exactly at t1. Gravity g along −z. */
export interface Arc {
  t0: number;
  t1: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  g: number;
  vz0: number;
}

export function makeArc(t0: number, t1: number, a: [number, number, number], b: [number, number, number], g: number): Arc {
  const tau = Math.max(1e-4, t1 - t0);
  const vz0 = (b[2] - a[2] + 0.5 * g * tau * tau) / tau;
  return { t0, t1, x0: a[0], y0: a[1], z0: a[2], x1: b[0], y1: b[1], z1: b[2], g, vz0 };
}

export function arcAt(a: Arc, t: number): [number, number, number] {
  const tau = a.t1 - a.t0;
  const s = Math.max(0, Math.min(tau, t - a.t0));
  const f = tau > 0 ? s / tau : 1;
  return [a.x0 + (a.x1 - a.x0) * f, a.y0 + (a.y1 - a.y0) * f, a.z0 + a.vz0 * s - 0.5 * a.g * s * s];
}
