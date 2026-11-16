import { type HarmonyContext, HarmonyEngine, type HarmonySettings } from '../harmony/engine';
import { Journey, type Offsets } from '../journey/journey';
import { divisionBeats } from '../mapping/grid';
import { hitToNotes } from '../mapping/notes';
import type { Recorder } from '../midi/capture';
import type { OutputRouter } from '../midi/router';
import { noteName } from '../music/theory';
import { Rng, hash32 } from '../rng';
import type { Store } from '../state/store';
import { type AppState, paceFactor } from '../state/types';
import { createVoice } from '../voices';
import type { Grid, Hit, Macros, Voice } from '../voices/types';

export const SIM_DT = 1 / 240;

interface PendingHit {
  step: number;
  beat: number;
  /** sim time the note sounds */
  t: number;
  hit: Hit;
  macros: Macros;
}

interface VoiceSlot {
  id: string;
  mode: string;
  voice: Voice;
  rng: Rng;
}

export interface EngineSnapshot {
  harmony: ReturnType<HarmonyEngine['serialize']>;
  journey: ReturnType<Journey['serialize']>;
}

/** Beat position of integer step k on a swung grid. */
export function stepBeat(k: number, stepBeats: number, swing: number): number {
  const sw = Math.max(0.5, Math.min(0.75, swing));
  const pair = Math.floor(k / 2);
  return (2 * pair + (k - 2 * pair ? 2 * sw : 0)) * stepBeats;
}

/**
 * Swing-aware step grid for one track. Integer steps are the swung note positions; stepAt is the
 * piecewise-linear inverse, so periodic motion animated in step-space crosses exactly on the notes.
 */
export function makeGrid(beatAt: (t: number) => number, timeOfBeat: (b: number) => number, beatSec: number, stepBeats: number, swing: number): Grid {
  const first = 2 * Math.max(0.5, Math.min(0.75, swing)); // plain-step length of the on-beat half of a pair
  return {
    stepSec: stepBeats * beatSec,
    stepAt(t: number): number {
      const s = beatAt(t) / stepBeats;
      const pair = Math.floor(s / 2);
      const local = s - 2 * pair;
      return 2 * pair + (local < first ? local / first : 1 + (local - first) / (2 - first));
    },
    timeOfStep(k: number): number {
      return timeOfBeat(stepBeat(k, stepBeats, swing));
    },
  };
}

export class Engine {
  harmony: HarmonyEngine;
  journey: Journey;
  playing = false;
  /** performance-clock seconds at transport beat 0 */
  startTime = 0;
  /** simulation seconds since transport start — equal to audio time while playing */
  simTime = 0;
  beatSec = 60 / 112;
  private anchor = { t: 0, beat: 0 };
  private lastBar = -1;
  private slots: VoiceSlot[] = [];
  private pending: Map<number, PendingHit>[] = [];
  private lastNudge: number[] = [];
  private notesInBar = new Map<number, number>();
  private ctxByBar = new Map<number, HarmonyContext>();
  private nextClockBeat = 0;
  private idleTime = 0;
  private lastTick = 0;
  private queuedRestore: EngineSnapshot | null = null;
  private harmonyKey = '';
  /** perf time of each track's last scheduled note (UI activity ticks) */
  lastNote: number[] = [];
  /** last note per track, for captions: slot, note names, velocity */
  lastNoteInfo: ({ time: number; slot: number; notes: string; vel: number } | null)[] = [];
  offsets: Offsets = { rotation: 0, weather: 0 };
  focus = -1;
  sendClock = true;
  onBar: ((bar: number) => void) | null = null;
  onHarmony: (() => void) | null = null;

  constructor(
    private store: Store,
    private out: OutputRouter,
    private recorder: Recorder | null = null,
  ) {
    const s = store.state;
    this.harmony = new HarmonyEngine(this.harmonySettings(s));
    this.harmonyKey = this.keyOf(s);
    this.journey = new Journey(s.harmony.seed);
    this.beatSec = 60 / s.bpm;
    this.syncTracks();
  }

  get state(): AppState {
    return this.store.state;
  }

  get voices(): Voice[] {
    return this.slots.map((s) => s.voice);
  }

  /** How far ahead voices must report hits: output lookahead + device latency + slack for one tick. */
  get horizon(): number {
    return this.out.lookahead + Math.max(0, this.out.latencyMs) / 1000 + 0.04;
  }

  // ------------------------------------------------------------- sync with state

  private harmonySettings(s: AppState): HarmonySettings {
    return { ...s.harmony, pace: paceFactor(s.journey.pace), homePull: s.journey.home };
  }

  private keyOf(s: AppState): string {
    return `${s.harmony.root}|${s.harmony.mode}|${s.harmony.seed}`;
  }

  /** Reconcile voices/harmony/tempo with the store. Call after every store change. */
  sync(): void {
    const s = this.state;
    this.syncTracks();
    const key = this.keyOf(s);
    if (key !== this.harmonyKey) {
      this.harmonyKey = key;
      this.harmony.reset(this.harmonySettings(s));
      this.ctxByBar.clear();
      this.onHarmony?.();
    } else {
      this.harmony.settings = { ...this.harmony.settings, ...this.harmonySettings(s) };
    }
    if (Math.abs(60 / s.bpm - this.beatSec) > 1e-9) this.setTempo(s.bpm);
  }

  syncTracks(): void {
    const tracks = this.state.tracks;
    const next: VoiceSlot[] = tracks.map((tr, i) => {
      const existing = this.slots.find((v) => v.id === tr.id);
      if (existing && existing.mode === tr.mode) {
        for (const [k, v] of Object.entries(tr.modeParams)) if (existing.voice.params[k] !== undefined && existing.voice.params[k] !== v) existing.voice.setParam(k, v);
        return existing;
      }
      const rng = new Rng(hash32(`${this.state.harmony.seed}:${tr.id}:${i}`));
      return { id: tr.id, mode: tr.mode, voice: createVoice(tr.mode, rng.fork('voice'), tr.modeParams), rng };
    });
    // hits planned by a voice that is gone (or moved) must not play on whatever now sits at its index
    const prevIds = this.slots.map((sl) => sl.id);
    this.slots = next;
    this.pending.length = tracks.length;
    for (let i = 0; i < tracks.length; i++) if (!this.pending[i] || prevIds[i] !== next[i].id) this.pending[i] = new Map();
    this.lastNote.length = tracks.length;
    for (let i = 0; i < tracks.length; i++) this.lastNote[i] ??= -1;
    this.lastNoteInfo.length = tracks.length;
    for (let i = 0; i < tracks.length; i++) this.lastNoteInfo[i] ??= null;
    this.lastNudge.length = tracks.length;
    this.journey.ensureTracks(tracks.length);
  }

  // ------------------------------------------------------------- time

  beatAt(t: number): number {
    return this.anchor.beat + (t - this.anchor.t) / this.beatSec;
  }

  timeOfBeat(b: number): number {
    return this.anchor.t + (b - this.anchor.beat) * this.beatSec;
  }

  setTempo(bpm: number): void {
    const t = this.playing ? this.simTime : this.idleTime;
    this.anchor = { t, beat: this.beatAt(t) };
    this.beatSec = 60 / Math.max(20, Math.min(300, bpm));
  }

  /** The swung grid a track's voice plans on. */
  grid(i: number): Grid {
    const s = this.state;
    const tr = s.tracks[i];
    return makeGrid(
      (t) => this.beatAt(t),
      (b) => this.timeOfBeat(b),
      this.beatSec,
      divisionBeats(tr.midi.division),
      tr.midi.swing ? s.swing : 0.5,
    );
  }

  /** Current transport position (beats) as heard now. */
  positionAt(now: number): number {
    if (!this.playing) return 0;
    return Math.max(0, this.beatAt(now - this.startTime));
  }

  /** Simulation time corresponding to a performance-clock time (for drawing frames exactly). */
  viewTime(now: number): number {
    return this.playing ? now - this.startTime : this.idleTime;
  }

  /** Bring every voice's drawing time to `now` (never behind its last simulated step). */
  prepareView(now: number): void {
    const t = this.viewTime(now);
    this.slots.forEach((slot, i) => {
      const vt = Math.max(slot.voice.time, t);
      slot.voice.view(vt, this.grid(i).stepAt(vt));
    });
  }

  // ------------------------------------------------------------- transport

  start(now: number, at?: number): void {
    this.startTime = at ?? now + 0.05;
    this.simTime = now - this.startTime;
    this.anchor = { t: 0, beat: 0 };
    this.beatSec = 60 / this.state.bpm;
    this.lastBar = -1;
    this.nextClockBeat = 0;
    this.notesInBar.clear();
    this.ctxByBar.clear();
    this.pending = this.pending.map(() => new Map());
    this.journey.wake();
    for (const v of this.voices) v.reset();
    this.playing = true;
    this.lastTick = now;
    if (this.sendClock && this.state.clock === 'internal') this.out.raw(this.startTime, [0xfa]);
  }

  stop(now: number): void {
    if (!this.playing) return;
    this.playing = false;
    this.out.panic();
    if (this.sendClock && this.state.clock === 'internal') this.out.raw(now, [0xfc]);
    this.recorder?.stop();
    // idle animation continues on its own virtual transport from here
    this.idleTime = 0;
    this.anchor = { t: 0, beat: 0 };
    for (const v of this.voices) v.reset();
  }

  /** Main scheduler tick (worker clock, ~25 ms). `now` in performance-clock seconds. */
  tick(now: number): void {
    const dtReal = Math.min(0.25, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    if (!this.playing) {
      // idle animation: voices move on a virtual transport; nothing is sent and harmony stays put
      const steps = Math.round(dtReal / SIM_DT);
      for (let k = 0; k < steps; k++) {
        this.idleTime += SIM_DT;
        this.stepVoices(this.idleTime, false);
      }
      return;
    }
    const target = now - this.startTime;
    if (target - this.simTime > 2) {
      // fell far behind (tab suspended): skip ahead rather than burst
      this.simTime = target - SIM_DT;
      for (const v of this.voices) v.reset();
      this.pending = this.pending.map(() => new Map());
    }
    while (this.simTime + SIM_DT <= target) {
      this.simTime += SIM_DT;
      this.stepPlaying();
    }
    this.flushPending();
    this.out.flush(now);
  }

  private stepVoices(t: number, live: boolean): void {
    const s = this.state;
    const barPos = this.beatAt(t) / 4;
    const horizon = this.horizon;
    this.slots.forEach((slot, i) => {
      const macros = this.journey.macros(i, s, barPos, this.offsets, this.focus);
      const hits = slot.voice.step({ dt: SIM_DT, t, beatSec: this.beatSec, macros, grid: this.grid(i), horizon });
      if (live) for (const h of hits) this.onHit(i, h, macros);
    });
  }

  private stepPlaying(): void {
    const beat = this.beatAt(this.simTime);
    const bar = Math.floor(beat / 4);
    if (bar > this.lastBar) this.advanceTo(bar);
    this.stepVoices(this.simTime, true);
    // internal clock out (24 PPQN), sent one lookahead ahead
    if (this.sendClock && this.state.clock === 'internal') {
      const until = this.beatAt(this.simTime + this.out.lookahead);
      while (this.nextClockBeat <= until) {
        this.out.raw(this.startTime + this.timeOfBeat(this.nextClockBeat), [0xf8]);
        this.nextClockBeat += 1 / 24;
      }
    }
  }

  private advanceTo(bar: number): void {
    while (this.lastBar < bar) {
      this.lastBar++;
      if (this.queuedRestore) {
        this.harmony.restore(this.queuedRestore.harmony);
        this.journey.restore(this.queuedRestore.journey);
        this.queuedRestore = null;
      }
      const before = this.harmony.history.length;
      if (this.lastBar > 0) this.harmony.ensureBar(this.harmony.core.bar + 1);
      this.journey.onBar(this.lastBar, this.state);
      this.ctxByBar.set(this.lastBar, this.harmony.context());
      this.ctxByBar.delete(this.lastBar - 8);
      if (this.harmony.history.length !== before || this.lastBar === 0) {
        this.recorder?.marker(this.lastBar * 4, `${this.harmony.chord.name} · ${this.harmony.scale.mode}`);
        this.onHarmony?.();
      }
      this.notesInBar.delete(this.lastBar - 4);
      this.onBar?.(this.lastBar);
    }
  }

  /** A planned hit arrives ahead of time; keep the strongest per step until it is time to send it. */
  private onHit(i: number, hit: Hit, macros: Macros): void {
    const s = this.state;
    const tr = s.tracks[i];
    const beat = stepBeat(hit.step, divisionBeats(tr.midi.division), tr.midi.swing ? s.swing : 0.5);
    // listeners get one nudge per step of this track
    s.tracks.forEach((other, j) => {
      if (j !== i && other.listen.source === i && other.listen.amount > 0 && this.lastNudge[j] !== hit.step) {
        this.lastNudge[j] = hit.step;
        this.slots[j]?.voice.nudge(other.listen.amount);
      }
    });
    const map = this.pending[i];
    const cur = map.get(hit.step);
    if (cur && cur.hit.strength >= hit.strength) return;
    map.set(hit.step, { step: hit.step, beat, t: this.timeOfBeat(beat), hit, macros });
  }

  /** Send every pending hit whose note is now within the output lookahead. */
  private flushPending(): void {
    const deadline = this.simTime + this.out.lookahead + Math.max(0, this.out.latencyMs) / 1000 + 0.03;
    this.pending.forEach((map, i) => {
      for (const [k, p] of map) {
        if (p.t > deadline) continue;
        map.delete(k);
        if (p.t >= this.simTime - 0.005) this.emit(i, p);
      }
    });
  }

  /** True if the track would be heard (mute/solo/rest). */
  audible(i: number): boolean {
    const tracks = this.state.tracks;
    const tr = tracks[i];
    if (!tr || tr.mute) return false;
    if (tracks.some((t) => t.solo) && !tr.solo) return false;
    return !this.journey.isResting(i);
  }

  private emit(i: number, p: PendingHit): void {
    const s = this.state;
    const tr = s.tracks[i];
    const slot = this.slots[i];
    if (!tr || !slot) return;
    const bar = Math.floor(p.beat / 4 + 1e-9);
    if (bar > this.lastBar) this.advanceTo(bar);
    if (!this.audible(i)) return;
    if (tr.midi.chance < 1 && !slot.rng.chance(tr.midi.chance)) return;
    const count = this.notesInBar.get(bar) ?? 0;
    if (count >= s.journey.notesPerBar) return;
    const ctx = this.ctxByBar.get(bar) ?? this.harmony.context();
    const notes = hitToNotes(p.hit.slot, p.hit.strength, p.macros.color, tr.notes, { low: tr.midi.velLow, high: tr.midi.velHigh }, ctx, slot.rng);
    // a physics length (waves) stands unless the track's gate is longer — long gates make drones
    const gateSec = divisionBeats(tr.midi.gate) * this.beatSec;
    const dur = Math.max(p.hit.length ?? 0, gateSec);
    const swell = this.journey.swell(i, s, p.beat / 4);
    if (swell < 1) for (const n of notes) n.velocity = Math.max(1, Math.round(n.velocity * swell));
    const time = this.startTime + p.t;
    for (const n of notes) this.out.note({ time, beat: p.beat, ch: tr.midi.channel, note: n.note, vel: n.velocity, dur, track: i });
    this.notesInBar.set(bar, count + 1);
    this.lastNote[i] = time;
    if (notes.length) this.lastNoteInfo[i] = { time, slot: p.hit.slot, notes: notes.map((n) => noteName(n.note)).join(' '), vel: notes[0].velocity };
  }

  // ------------------------------------------------------------- external clock

  followTempo(bpm: number): void {
    if (Math.abs(bpm - 60 / this.beatSec) > 0.05) this.setTempo(bpm);
  }

  // ------------------------------------------------------------- snapshots

  snapshot(): EngineSnapshot {
    return { harmony: this.harmony.serialize(), journey: this.journey.serialize() };
  }

  /** Apply at the next bar line (or immediately when stopped). */
  restore(snap: EngineSnapshot): void {
    if (this.playing) this.queuedRestore = snap;
    else {
      this.harmony.restore(snap.harmony);
      this.journey.restore(snap.journey);
      this.onHarmony?.();
    }
  }

  get elapsed(): number {
    return this.playing ? Math.max(0, this.simTime) : 0;
  }

  get currentBar(): number {
    return Math.max(0, this.lastBar);
  }
}
