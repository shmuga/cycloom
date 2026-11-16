import { Rng } from '../rng';
import type { AppState } from '../state/types';
import type { Macros } from '../voices/types';

export interface TrackLifeState {
  phase: number;
  restBars: number; // >0 = resting
  wanderColor: number; // −1..1
  wanderRotation: number;
}

export interface Offsets {
  /** Added to the focused track's rotation (8mu tilt). */
  rotation: number;
  /** Added to the global weather value. */
  weather: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Long-form layer: weather, breathing, rests, wander, voice budget. Advanced once per bar. */
export class Journey {
  weatherValue = 0; // −1 (calm) … 1 (storm)
  weatherTrend = 0;
  tracks: TrackLifeState[] = [];
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x5eed);
  }

  ensureTracks(n: number): void {
    while (this.tracks.length < n) {
      this.tracks.push({ phase: this.rng.range(0, Math.PI * 2), restBars: 0, wanderColor: 0, wanderRotation: 0 });
    }
    this.tracks.length = n;
  }

  /** Called at each bar boundary. */
  onBar(bar: number, s: AppState): void {
    const j = s.journey;
    this.ensureTracks(s.tracks.length);
    // weather: mean-reverting random walk
    const step = (this.rng.next() - 0.5) * 0.18 - this.weatherValue * 0.02;
    this.weatherTrend = step;
    this.weatherValue = Math.max(-1, Math.min(1, this.weatherValue + step));

    s.tracks.forEach((tr, i) => {
      const ls = this.tracks[i];
      if (ls.restBars > 0) ls.restBars--;
      const w = 0.12;
      ls.wanderColor = Math.max(-1, Math.min(1, ls.wanderColor + (this.rng.next() - 0.5) * w * 2));
      ls.wanderRotation = Math.max(-1, Math.min(1, ls.wanderRotation + (this.rng.next() - 0.5) * w * 2));
      // phrase boundaries: chance to rest
      if (bar % 4 === 0 && ls.restBars === 0) {
        const p = Math.min(0.9, tr.life.rest * j.rest * 2);
        if (this.rng.chance(p)) ls.restBars = this.rng.int(2, 17);
      }
    });

    // voice budget: too many playing → send one to rest
    const playing = () => s.tracks.map((_t, i) => i).filter((i) => !s.tracks[i].mute && this.tracks[i].restBars === 0);
    let active = playing();
    let guard = 0;
    while (active.length > Math.max(0, Math.round(j.voices)) && guard++ < 16) {
      const i = this.rng.pick(active);
      this.tracks[i].restBars = this.rng.int(4, 13);
      active = playing();
    }
    // floor: never let the piece fall silent — keep at least half the budget (≥ 1) awake
    const floor = Math.min(Math.max(1, Math.round(j.voices / 2)), s.tracks.filter((t) => !t.mute).length);
    while (active.length < floor && guard++ < 32) {
      let best = -1;
      this.tracks.forEach((ls, i) => {
        if (ls.restBars > 0 && !s.tracks[i].mute && (best < 0 || ls.restBars < this.tracks[best].restBars)) best = i;
      });
      if (best < 0) break;
      this.tracks[best].restBars = 0;
      active = playing();
    }
  }

  /** Fresh start: everybody awake. */
  wake(): void {
    for (const t of this.tracks) t.restBars = 0;
  }

  isResting(i: number): boolean {
    return (this.tracks[i]?.restBars ?? 0) > 0;
  }

  /** Track i's slow cycle (0 … 1, peak = 1) over its own breathe length. */
  cycle(i: number, s: AppState, barPos: number): number {
    const tr = s.tracks[i];
    const ls = this.tracks[i];
    if (!tr || !ls) return 0;
    return 0.5 + 0.5 * Math.sin((2 * Math.PI * barPos) / Math.max(1, tr.life.breathe) + ls.phase);
  }

  /**
   * Velocity multiplier from the track's swell: loudest where its breathing is fullest
   * (cycle at 0), quietest at the dip — a slow rise and fall, like a tape loop fading in and out.
   */
  swell(i: number, s: AppState, barPos: number): number {
    const sw = s.tracks[i]?.life.swell ?? 0;
    return sw > 0 ? 1 - sw * this.cycle(i, s, barPos) : 1;
  }

  /** Effective macros for track i at a (fractional) bar position. */
  macros(i: number, s: AppState, barPos: number, offsets: Offsets = { rotation: 0, weather: 0 }, focus = -1): Macros {
    const tr = s.tracks[i];
    const ls = this.tracks[i];
    const j = s.journey;
    const base = tr.macros;
    if (!ls) return { ...base };
    const breath = this.cycle(i, s, barPos);
    const breathe = 1 - j.breathe * 0.8 * breath;
    const weather = Math.max(-1, Math.min(1, this.weatherValue + offsets.weather));
    const wAmt = j.weather;
    const wanderAmt = 0.25 * tr.life.wander * (0.5 + j.wander);
    return {
      intensity: clamp01(base.intensity * breathe * (1 + wAmt * 0.6 * weather)),
      color: clamp01(base.color + ls.wanderColor * wanderAmt),
      rotation: clamp01(base.rotation + ls.wanderRotation * wanderAmt + (i === focus ? offsets.rotation : 0)),
      randomness: clamp01(base.randomness + wAmt * 0.3 * Math.max(0, weather)),
    };
  }

  weatherLabel(): string {
    const v = this.weatherValue;
    const word = v < -0.33 ? 'calm' : v < 0.33 ? 'mild' : 'stormy';
    const trend = this.weatherTrend > 0.02 ? 'rising' : this.weatherTrend < -0.02 ? 'easing' : 'steady';
    return `${word}, ${trend}`;
  }

  serialize(): { weatherValue: number; tracks: TrackLifeState[]; rng: number } {
    return { weatherValue: this.weatherValue, tracks: this.tracks.map((t) => ({ ...t })), rng: this.rng.state };
  }

  restore(d: { weatherValue: number; tracks: TrackLifeState[]; rng: number }): void {
    this.weatherValue = d.weatherValue;
    this.tracks = d.tracks.map((t) => ({ ...t }));
    this.rng = new Rng(d.rng);
  }
}
