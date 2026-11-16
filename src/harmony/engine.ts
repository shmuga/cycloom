import { Rng, hash32 } from '../rng';
import {
  type Chord,
  type ChordSpec,
  type Extension,
  type ModeName,
  type PitchClass,
  type Scale,
  MODES,
  buildChord,
  modeFromTonic,
  mod12,
  scaleEquals,
  scalePcs,
  signature,
  triadQuality,
  voiceLead,
} from '../music/theory';

export type Relation = 'fifths' | 'brightness' | 'relative' | 'walk';

export interface HarmonySettings {
  root: PitchClass;
  mode: ModeName;
  seed: number;
  barsPerChord: number;
  morphBars: number;
  depth: number; // 0..1
  driftBars: number;
  relation: Relation;
  homePull: number; // 0..1
  pace: number; // period multiplier (×0.25 … ×8)
  holdChord: boolean;
  holdScale: boolean;
}

export const DEFAULT_HARMONY: HarmonySettings = {
  root: 2,
  mode: 'aeolian',
  seed: 4417,
  barsPerChord: 2,
  morphBars: 2,
  depth: 0.45,
  driftBars: 16,
  relation: 'fifths',
  homePull: 0.4,
  pace: 1,
  holdChord: false,
  holdScale: false,
};

export interface HarmonyContext {
  bar: number;
  scale: Scale;
  scalePcs: PitchClass[];
  chord: Chord;
  chordTones: PitchClass[];
  /** 9/11/13 above the chord root that are in the scale but not in the chord. */
  tensions: PitchClass[];
  voicing: number[];
}

/** Everything needed to resume generation exactly from a point. */
export interface HarmonyCore {
  bar: number;
  scale: Scale;
  current: ChordSpec;
  base: ChordSpec;
  queue: ChordSpec[];
  recent: number[];
  phrasePos: number;
  phraseLen: number;
  barsSinceChord: number;
  barsSinceMorph: number;
  barsToDrift: number;
  pendingScale: Scale | null;
  pendingWait: number;
  voicing: number[];
  rng: number;
  branch: number;
}

export interface HistoryEntry {
  bar: number;
  chordName: string;
  roman: string;
  scale: Scale;
  core: HarmonyCore;
}

/** Functional transition weights between scale degrees (rows: from, cols: to). */
const TRANSITIONS: number[][] = [
  [0, 0.12, 0.15, 0.2, 0.15, 0.22, 0.16], // from 0
  [0.1, 0, 0.1, 0.15, 0.35, 0.1, 0.2], // from 1 (predominant → dominant)
  [0.15, 0.1, 0, 0.2, 0.1, 0.3, 0.15],
  [0.25, 0.15, 0.1, 0, 0.3, 0.1, 0.2], // from 3 (iv/IV)
  [0.4, 0.05, 0.1, 0.1, 0, 0.25, 0.1], // from 4 (v/V → tonic)
  [0.2, 0.15, 0.15, 0.25, 0.15, 0, 0.1],
  [0.35, 0.05, 0.25, 0.1, 0.1, 0.15, 0], // from 6 (VII → i / III)
];

const EXT_WEIGHTS: [Extension, number][] = [
  ['triad', 0.12],
  ['7', 0.28],
  ['9', 0.18],
  ['6', 0.1],
  ['add9', 0.16],
  ['sus2', 0.08],
  ['sus4', 0.04],
  ['11', 0.04],
];

const QUEUE_LEN = 4;

export class HarmonyEngine {
  settings: HarmonySettings;
  core: HarmonyCore;
  history: HistoryEntry[] = [];
  private rng: Rng;
  private pendingRewind: number | null = null;

  constructor(settings: Partial<HarmonySettings> = {}) {
    this.settings = { ...DEFAULT_HARMONY, ...settings };
    this.rng = new Rng(this.settings.seed);
    this.core = this.initialCore();
    this.pushHistory();
  }

  /** Re-start generation from the base key with the current settings/seed. */
  reset(settings: Partial<HarmonySettings> = {}): void {
    this.settings = { ...this.settings, ...settings };
    this.rng = new Rng(this.settings.seed);
    this.history = [];
    this.pendingRewind = null;
    this.core = this.initialCore();
    this.pushHistory();
  }

  private initialCore(): HarmonyCore {
    const scale: Scale = { root: this.settings.root, mode: this.settings.mode };
    const first: ChordSpec = { degree: 0, ext: '9' };
    const core: HarmonyCore = {
      bar: 0,
      scale,
      current: first,
      base: first,
      queue: [],
      recent: [0],
      phrasePos: 0,
      phraseLen: 4,
      barsSinceChord: 0,
      barsSinceMorph: 0,
      barsToDrift: this.period(this.settings.driftBars),
      pendingScale: null,
      pendingWait: 0,
      voicing: [],
      rng: this.rng.state,
      branch: 0,
    };
    core.voicing = voiceLead(buildChord(scale, first).pcs, null);
    this.core = core;
    this.fillQueue();
    core.rng = this.rng.state;
    return core;
  }

  private period(bars: number): number {
    return Math.max(1, Math.round(bars * this.settings.pace));
  }

  // ------------------------------------------------------------- queries

  get scale(): Scale {
    return this.core.scale;
  }

  get chord(): Chord {
    return buildChord(this.core.scale, this.core.current);
  }

  upcoming(n = 3): Chord[] {
    return this.core.queue.slice(0, n).map((s) => buildChord(this.core.scale, s));
  }

  /** Bars until the pending/next scale drift lands. */
  get driftTarget(): { scale: Scale; inBars: number } | null {
    if (this.settings.holdScale) return null;
    if (this.core.pendingScale) return { scale: this.core.pendingScale, inBars: 0 };
    return { scale: this.peekDriftScale(), inBars: this.core.barsToDrift };
  }

  context(): HarmonyContext {
    const scale = this.core.scale;
    const chord = this.chord;
    const pcs = scalePcs(scale);
    const tensions = [1, 3, 5]
      .map((o) => pcs[(chord.degree + o) % 7])
      .filter((p) => !chord.pcs.includes(p));
    return {
      bar: this.core.bar,
      scale,
      scalePcs: pcs,
      chord,
      chordTones: chord.pcs,
      tensions,
      voicing: this.core.voicing,
    };
  }

  // ------------------------------------------------------------- stepping

  /** Advance to the given bar (monotonic). Returns true when harmony changed. */
  ensureBar(bar: number): boolean {
    let changed = false;
    while (this.core.bar < bar) changed = this.advanceBar() || changed;
    return changed;
  }

  /** Called once per bar boundary. */
  advanceBar(): boolean {
    if (this.pendingRewind !== null) {
      const idx = this.pendingRewind;
      this.pendingRewind = null;
      this.applyRewind(idx);
      return true;
    }
    const c = this.core;
    const s = this.settings;
    c.bar++;
    c.barsSinceChord++;
    c.barsSinceMorph++;
    let changed = false;

    if (!s.holdScale && !c.pendingScale) {
      c.barsToDrift--;
      if (c.barsToDrift <= 0) {
        c.pendingScale = this.chooseDrift();
        c.pendingWait = 0;
        c.barsToDrift = this.period(s.driftBars);
      }
    }

    if (!s.holdChord && c.barsSinceChord >= this.period(s.barsPerChord)) {
      this.nextChord();
      changed = true;
    } else if (!s.holdChord && c.barsSinceMorph >= this.period(s.morphBars)) {
      c.barsSinceMorph = 0;
      if (this.rng.chance(s.depth)) {
        this.morph();
        changed = true;
      }
    }

    // A pending drift may also land on a held chord if that chord pivots.
    if (c.pendingScale && !changed && s.holdChord) changed = this.tryApplyDrift();

    if (changed) {
      const ch = buildChord(c.scale, c.current);
      c.voicing = voiceLead(ch.pcs, c.voicing);
      c.rng = this.rng.state;
      this.pushHistory();
    }
    c.rng = this.rng.state;
    return changed;
  }

  private nextChord(): void {
    const c = this.core;
    c.barsSinceChord = 0;
    c.barsSinceMorph = 0;
    const next = c.queue.shift() ?? this.generateNext(c.current.degree);
    c.current = next;
    c.base = next;
    c.recent = [...c.recent, next.degree].slice(-4);
    c.phrasePos = (c.phrasePos + 1) % c.phraseLen;
    if (c.phrasePos === 0) c.phraseLen = this.rng.chance(0.6) ? 4 : 8;
    this.tryApplyDrift();
    this.fillQueue();
  }

  /** Apply the pending scale if the current chord is a pivot (or we've waited long enough). */
  private tryApplyDrift(): boolean {
    const c = this.core;
    if (!c.pendingScale) return false;
    const target = c.pendingScale;
    const chordPcs = buildChord(c.scale, c.current).pcs;
    const targetPcs = scalePcs(target);
    const isPivot = chordPcs.every((p) => targetPcs.includes(p));
    c.pendingWait++;
    if (!isPivot && c.pendingWait < 4) return false;
    // Re-read the current chord in the new scale by keeping its root pitch if possible.
    const oldRoot = buildChord(c.scale, c.current).rootPc;
    const newDegree = targetPcs.indexOf(oldRoot);
    c.scale = target;
    c.pendingScale = null;
    c.pendingWait = 0;
    if (newDegree >= 0) {
      c.current = { ...c.current, degree: newDegree };
      c.base = c.current;
    }
    return true;
  }

  private fillQueue(): void {
    const c = this.core;
    while (c.queue.length < QUEUE_LEN) {
      const prev = c.queue.length ? c.queue[c.queue.length - 1].degree : c.current.degree;
      const posInPhrase = (c.phrasePos + c.queue.length + 1) % c.phraseLen;
      c.queue.push(this.generateNext(prev, posInPhrase === c.phraseLen - 1 || posInPhrase === 0));
    }
  }

  private generateNext(from: number, cadence = false): ChordSpec {
    const c = this.core;
    const recent = [...c.recent, ...c.queue.map((q) => q.degree)].slice(-4);
    const weights = TRANSITIONS[from].map((w, to) => {
      let x = w;
      if (recent.includes(to)) x *= 0.35;
      if (cadence && to === 0) x *= 3;
      if (triadQuality(c.scale, to) === 'dim') x *= 0.2;
      return x;
    });
    let degree = this.rng.weighted(weights);
    if (degree < 0) degree = 0;
    return { degree, ext: this.pickExt(degree) };
  }

  private pickExt(degree: number): Extension {
    if (triadQuality(this.core.scale, degree) === 'dim') return '7';
    const i = this.rng.weighted(EXT_WEIGHTS.map(([, w]) => w));
    return EXT_WEIGHTS[Math.max(0, i)][0];
  }

  private morph(): void {
    const c = this.core;
    const op = this.rng.weighted([0.4, 0.25, 0.15, 0.2]);
    const cur = c.current;
    if (op === 0) {
      // extension swap
      const swaps: Record<Extension, Extension[]> = {
        triad: ['add9', '7', 'sus2'],
        '7': ['6', '9'],
        '9': ['sus2', 'add9', '7'],
        '6': ['7', 'add9'],
        add9: ['9', 'triad', 'sus2'],
        sus2: ['add9', 'triad'],
        sus4: ['triad', '7'],
        '11': ['9', '7'],
      };
      const opts = triadQuality(c.scale, cur.degree) === 'dim' ? (['7', '9'] as Extension[]) : swaps[cur.ext];
      c.current = { degree: cur.degree, ext: this.rng.pick(opts) };
    } else if (op === 1) {
      // voice step: one chord voice moves by a scale step (sus variants)
      c.current = { degree: cur.degree, ext: this.rng.chance(0.7) ? 'sus2' : 'sus4' };
      if (triadQuality(c.scale, cur.degree) === 'dim') c.current = { degree: cur.degree, ext: '7' };
    } else if (op === 2) {
      // third-related substitution (shares two tones)
      const d = (cur.degree + (this.rng.chance(0.5) ? 2 : 5)) % 7;
      c.current = { degree: d, ext: this.pickExt(d) };
    } else {
      // return toward the base chord
      c.current = { ...c.base };
    }
  }

  // ------------------------------------------------------------- drift

  private driftCandidates(from: Scale): { kind: Relation; scale: Scale }[] {
    const out: { kind: Relation; scale: Scale }[] = [];
    out.push({ kind: 'fifths', scale: { root: mod12(from.root + 7), mode: from.mode } });
    out.push({ kind: 'fifths', scale: { root: mod12(from.root - 7), mode: from.mode } });
    const mi = MODES.indexOf(from.mode);
    if (mi > 0) out.push({ kind: 'brightness', scale: { root: from.root, mode: MODES[mi - 1] } });
    if (mi < MODES.length - 1) out.push({ kind: 'brightness', scale: { root: from.root, mode: MODES[mi + 1] } });
    const pcs = scalePcs(from);
    for (const k of [2, 5, 3, 4]) {
      const mode = modeFromTonic(pcs, pcs[k]);
      if (mode) out.push({ kind: 'relative', scale: { root: pcs[k], mode } });
    }
    return out;
  }

  private homeDistance(s: Scale): number {
    const home: Scale = { root: this.settings.root, mode: this.settings.mode };
    let d = Math.abs(signature(s) - signature(home));
    d = Math.min(d, 12 - d);
    return d * 2 + (s.root === home.root ? 0 : 1) + (s.mode === home.mode ? 0 : 1);
  }

  private chooseDriftWith(rng: Rng): Scale {
    const c = this.core;
    const s = this.settings;
    const all = this.driftCandidates(c.scale);
    if (rng.chance(s.homePull) && !scaleEquals(c.scale, { root: s.root, mode: s.mode })) {
      let best = all[0];
      for (const cand of all) if (this.homeDistance(cand.scale) < this.homeDistance(best.scale)) best = cand;
      return best.scale;
    }
    const kind: Relation = s.relation === 'walk' ? rng.pick(['fifths', 'brightness', 'relative'] as const) : s.relation;
    const pool = all.filter((a) => a.kind === kind);
    return rng.pick(pool.length ? pool : all).scale;
  }

  private chooseDrift(): Scale {
    return this.chooseDriftWith(this.rng);
  }

  /** Preview of the next drift without consuming randomness. */
  private peekDriftScale(): Scale {
    const probe = new Rng(this.rng.state);
    // mimic: barsToDrift countdown doesn't consume rng; chance(depth) calls might, so this is an estimate.
    return this.chooseDriftWith(probe);
  }

  // ------------------------------------------------------------- history

  private pushHistory(): void {
    const ch = this.chord;
    this.history.push({
      bar: this.core.bar,
      chordName: ch.name,
      roman: ch.roman,
      scale: { ...this.core.scale },
      core: cloneCore(this.core),
    });
    if (this.history.length > 512) this.history.splice(0, this.history.length - 512);
  }

  /** Jump back to a history entry at the next bar line; the future after it is regenerated. */
  requestRewind(index: number): void {
    if (index >= 0 && index < this.history.length) this.pendingRewind = index;
  }

  get rewindPending(): boolean {
    return this.pendingRewind !== null;
  }

  private applyRewind(index: number): void {
    const entry = this.history[index];
    const bar = this.core.bar + 1;
    const branch = this.core.branch + 1;
    this.core = cloneCore(entry.core);
    this.core.bar = bar;
    this.core.branch = branch;
    // New branch: reseed so the regenerated future differs from the original one.
    this.rng = new Rng(hash32(`${entry.core.rng}:${branch}`));
    this.core.queue = [];
    this.fillQueue();
    this.core.rng = this.rng.state;
    this.history = this.history.slice(0, index + 1);
    this.pushHistory();
  }

  // ------------------------------------------------------------- persistence

  serialize(): { settings: HarmonySettings; core: HarmonyCore; history: HistoryEntry[] } {
    return {
      settings: { ...this.settings },
      core: cloneCore(this.core),
      history: this.history.slice(-64).map((h) => ({ ...h, scale: { ...h.scale }, core: cloneCore(h.core) })),
    };
  }

  restore(data: { settings: HarmonySettings; core: HarmonyCore; history: HistoryEntry[] }): void {
    this.settings = { ...data.settings };
    this.core = cloneCore(data.core);
    this.rng = new Rng(this.core.rng);
    this.history = data.history.map((h) => ({ ...h, core: cloneCore(h.core) }));
    this.pendingRewind = null;
  }
}

export function cloneCore(c: HarmonyCore): HarmonyCore {
  return {
    ...c,
    scale: { ...c.scale },
    current: { ...c.current },
    base: { ...c.base },
    queue: c.queue.map((q) => ({ ...q })),
    recent: [...c.recent],
    pendingScale: c.pendingScale ? { ...c.pendingScale } : null,
    voicing: [...c.voicing],
  };
}
