import { migrate } from './persist';
import { type AppState, type TrackState, defaultModeParams, defaultState, makeTrack, newId } from './types';
import { MODE_PARAMS } from '../voices';
import type { ModeId } from '../voices/types';

/**
 * Share links carry the whole setup in the URL fragment (never sent to a server).
 *
 *   #s=b<base64url(record)>          v2: compact binary record (≈ 250–350 characters)
 *   #s=c<base64url(deflate(record))>  v2, deflated — whichever of b/c is shorter is used
 *   #s=z… / #s=j…                    v1: deflated / plain JSON (still read, no longer written)
 *
 * The record is a fixed sequence of fields, each a LEB128 varint: every control lives on a coarse
 * grid (0.01 or coarser, BPM 0.01), so values are stored as integer steps. The enum tables below are
 * part of the format — append to them, never reorder. Device settings (MIDI ports, clock, timing,
 * latency), mute/solo and track ids are left out.
 */

const VERSION = 2;
const F_MODE_IDS: readonly ModeId[] = ['drops', 'waves', 'rockfall', 'wind', 'pendulum', 'orbits'];
const F_SCALE_MODES = ['lydian', 'ionian', 'mixolydian', 'dorian', 'aeolian', 'phrygian'] as const;
const F_RELATIONS = ['fifths', 'brightness', 'relative', 'walk'] as const;
const F_VOICES = ['mono', 'chord', 'root'] as const;
const F_DIVISIONS = ['1/4', '1/8', '1/16', '1/32', '1/4T', '1/8T', '1/16T', '1/4.', '1/8.', '1/16.'] as const;
const F_GATES = ['1/32', '1/16', '1/8', '1/4', '1/2', '1/1', '2/1', '4/1'] as const;

const LOCAL_KEYS = ['outputId', 'inputId', 'clock', 'timestamped', 'latencyMs'] as const;

class Writer {
  bytes: number[] = [];
  u(n: number): void {
    let v = Math.max(0, Math.round(n));
    while (v >= 0x80) {
      this.bytes.push((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.bytes.push(v);
  }
  /** signed integer (zigzag) */
  i(n: number): void {
    const v = Math.round(n);
    this.u(v >= 0 ? v * 2 : -v * 2 - 1);
  }
  /** non-negative number on a 0.01 grid */
  f(n: number): void {
    this.u(n * 100);
  }
  e<T>(list: readonly T[], v: T): void {
    this.u(Math.max(0, list.indexOf(v)));
  }
}

class Reader {
  private p = 0;
  constructor(private b: Uint8Array) {}
  u(): number {
    let v = 0;
    let mul = 1;
    for (;;) {
      if (this.p >= this.b.length) throw new Error('short');
      const x = this.b[this.p++];
      v += (x & 0x7f) * mul;
      if (x < 0x80) return v;
      mul *= 0x80;
      if (mul > 2 ** 49) throw new Error('varint');
    }
  }
  i(): number {
    const v = this.u();
    return v % 2 ? -(v + 1) / 2 : v / 2;
  }
  f(): number {
    return this.u() / 100;
  }
  e<T>(list: readonly T[]): T {
    const k = this.u();
    if (k >= list.length) throw new Error('enum');
    return list[k];
  }
  get done(): boolean {
    return this.p === this.b.length;
  }
}

export function packState(s: AppState): Uint8Array {
  const w = new Writer();
  const h = s.harmony;
  const j = s.journey;
  w.u(VERSION);
  w.u(s.bpm * 100);
  w.f(s.swing);
  w.u(h.root);
  w.e(F_SCALE_MODES, h.mode);
  w.u(h.seed >>> 0);
  w.u(h.barsPerChord);
  w.u(h.morphBars);
  w.f(h.depth);
  w.u(h.driftBars);
  w.e(F_RELATIONS, h.relation);
  w.f(h.homePull);
  w.f(h.pace);
  w.u((h.holdChord ? 1 : 0) | (h.holdScale ? 2 : 0));
  for (const v of [j.pace, j.home, j.weather, j.breathe, j.rest, j.wander]) w.f(v);
  w.u(j.voices);
  w.u(j.notesPerBar);
  w.u(s.tracks.length);
  for (const t of s.tracks) {
    w.e(F_MODE_IDS, t.mode);
    for (const p of MODE_PARAMS[t.mode]) w.f(t.modeParams[p.key] ?? p.def);
    for (const v of [t.macros.intensity, t.macros.color, t.macros.rotation, t.macros.randomness]) w.f(v);
    const n = t.notes;
    w.u((n.kind === 'drum' ? 1 : 0) | (Math.max(0, F_VOICES.indexOf(n.voice)) << 1));
    w.u(n.low);
    w.u(n.high);
    w.u(n.steps.length);
    for (const k of n.steps) w.i(k);
    w.i(n.transpose);
    w.i(n.octave);
    w.u(n.drumNote);
    w.f(n.drumSpread);
    w.f(n.accent);
    const m = t.midi;
    w.u(m.channel);
    w.e(F_DIVISIONS, m.division);
    w.u(m.swing ? 1 : 0);
    w.e(F_GATES, m.gate);
    w.u(m.velLow);
    w.u(m.velHigh);
    w.f(m.chance);
    w.u(t.life.breathe);
    for (const v of [t.life.swell, t.life.rest, t.life.wander]) w.f(v);
    w.i(t.listen.source);
    w.f(t.listen.amount);
  }
  return Uint8Array.from(w.bytes);
}

export function unpackState(bytes: Uint8Array): AppState | null {
  try {
    const r = new Reader(bytes);
    if (r.u() !== VERSION) return null;
    const s = defaultState();
    s.bpm = r.u() / 100;
    s.swing = r.f();
    const h = s.harmony;
    h.root = r.u() % 12;
    h.mode = r.e(F_SCALE_MODES);
    h.seed = r.u();
    h.barsPerChord = r.u();
    h.morphBars = r.u();
    h.depth = r.f();
    h.driftBars = r.u();
    h.relation = r.e(F_RELATIONS);
    h.homePull = r.f();
    h.pace = r.f();
    const holds = r.u();
    h.holdChord = !!(holds & 1);
    h.holdScale = !!(holds & 2);
    const j = s.journey;
    [j.pace, j.home, j.weather, j.breathe, j.rest, j.wander] = Array.from({ length: 6 }, () => r.f());
    j.voices = r.u();
    j.notesPerBar = r.u();
    const n = r.u();
    if (n < 1 || n > 64) return null;
    const tracks: TrackState[] = [];
    for (let i = 0; i < n; i++) {
      const mode = r.e(F_MODE_IDS);
      const modeParams = defaultModeParams(mode);
      for (const p of MODE_PARAMS[mode]) modeParams[p.key] = r.f();
      const t = makeTrack(i, { mode, modeParams });
      [t.macros.intensity, t.macros.color, t.macros.rotation, t.macros.randomness] = [r.f(), r.f(), r.f(), r.f()];
      const kv = r.u();
      t.notes.kind = kv & 1 ? 'drum' : 'tonal';
      t.notes.voice = F_VOICES[(kv >> 1) % F_VOICES.length];
      t.notes.low = r.u();
      t.notes.high = r.u();
      const ns = r.u();
      if (ns > 16) return null;
      t.notes.steps = Array.from({ length: ns }, () => r.i());
      t.notes.transpose = r.i();
      t.notes.octave = r.i();
      t.notes.drumNote = r.u();
      t.notes.drumSpread = r.f();
      t.notes.accent = r.f();
      t.midi.channel = r.u();
      t.midi.division = r.e(F_DIVISIONS);
      t.midi.swing = r.u() === 1;
      t.midi.gate = r.e(F_GATES);
      t.midi.velLow = r.u();
      t.midi.velHigh = r.u();
      t.midi.chance = r.f();
      t.life.breathe = r.u();
      [t.life.swell, t.life.rest, t.life.wander] = [r.f(), r.f(), r.f()];
      t.listen = { source: r.i(), amount: r.f() };
      tracks.push(t);
    }
    if (!r.done) return null;
    s.tracks = tracks;
    // run through migrate for the same sanity pass a saved session gets
    return migrate(JSON.parse(JSON.stringify(s)));
  } catch {
    return null;
  }
}

function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const canCompress = (): boolean => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export async function encodeShare(s: AppState): Promise<string> {
  const raw = packState(s);
  let code = 'b' + toB64url(raw);
  if (canCompress()) {
    const z = 'c' + toB64url(await pipe(raw, new CompressionStream('deflate-raw')));
    if (z.length < code.length) code = z;
  }
  return code;
}

/** Decode a share code into a full state (device fields from `local`). Returns null for anything unreadable. */
export async function decodeShare(code: string, local?: Partial<AppState>): Promise<AppState | null> {
  try {
    const kind = code[0];
    let bytes = fromB64url(code.slice(1));
    let st: AppState | null;
    if (kind === 'c' || kind === 'z') {
      if (!canCompress()) return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    if (kind === 'b' || kind === 'c') st = unpackState(bytes);
    else if (kind === 'z' || kind === 'j') st = migrate(JSON.parse(new TextDecoder().decode(bytes)));
    else return null;
    if (!st) return null;
    st.tracks = st.tracks.map((t) => ({ ...t, id: newId(), mute: false, solo: false }));
    for (const k of LOCAL_KEYS) (st as unknown as Record<string, unknown>)[k] = local?.[k] ?? defaultState()[k];
    return st;
  } catch {
    return null;
  }
}

/** The fields a share link carries (everything but device settings, ids and mute/solo). */
export function shareable(s: AppState): unknown {
  const out: Record<string, unknown> = { ...s, tracks: s.tracks.map(({ id: _id, mute: _m, solo: _s, ...t }) => t) };
  for (const k of LOCAL_KEYS) delete out[k];
  return out;
}

/** Track field names the binary format covers — a test compares this with makeTrack() so new fields can't be forgotten. */
export const SHARED_TRACK_FIELDS = {
  top: ['id', 'mode', 'modeParams', 'macros', 'notes', 'midi', 'life', 'listen', 'mute', 'solo'],
  macros: ['intensity', 'color', 'rotation', 'randomness'],
  notes: ['kind', 'voice', 'low', 'high', 'steps', 'transpose', 'octave', 'drumNote', 'drumSpread', 'accent'],
  midi: ['channel', 'division', 'swing', 'gate', 'velLow', 'velHigh', 'chance'],
  life: ['breathe', 'swell', 'rest', 'wander'],
  listen: ['source', 'amount'],
  state: ['bpm', 'swing', 'clock', 'outputId', 'inputId', 'timestamped', 'latencyMs', 'harmony', 'journey', 'tracks'],
  harmony: ['root', 'mode', 'seed', 'barsPerChord', 'morphBars', 'depth', 'driftBars', 'relation', 'homePull', 'pace', 'holdChord', 'holdScale'],
  journey: ['pace', 'home', 'weather', 'breathe', 'rest', 'wander', 'voices', 'notesPerBar'],
};

export function shareURL(base: string, code: string): string {
  return `${base.replace(/#.*$/, '')}#s=${code}`;
}

/** The share code in a location hash, if any. */
export function codeFromHash(hash: string): string | null {
  const m = /(?:^#|&)s=([A-Za-z0-9_-]+)/.exec(hash);
  return m ? m[1] : null;
}
