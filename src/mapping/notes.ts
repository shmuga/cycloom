import type { HarmonyContext } from '../harmony/engine';
import { type PitchClass, mod12 } from '../music/theory';
import type { Rng } from '../rng';

export type TrackKind = 'tonal' | 'drum';
export type VoiceMode = 'mono' | 'chord' | 'root';

export interface NoteSettings {
  kind: TrackKind;
  voice: VoiceMode;
  low: number; // MIDI note, inclusive
  high: number;
  steps: number[]; // 1-based scale steps above the slot note, e.g. [1, 3, 5]
  transpose: number; // scale steps
  octave: number;
  drumNote: number;
  drumSpread: number; // semitones 0..12
  accent: number; // 0..1 strength threshold for accents
}

export const DEFAULT_NOTES: NoteSettings = {
  kind: 'tonal',
  voice: 'mono',
  low: 50,
  high: 74,
  steps: [1, 3, 5],
  transpose: 0,
  octave: 0,
  drumNote: 60,
  drumSpread: 3,
  accent: 0.7,
};

/** Pitch material by color: chord tones → + tensions → full scale (ordered from chord root). */
export function poolFor(color: number, ctx: HarmonyContext): PitchClass[] {
  if (color < 1 / 3) return [...ctx.chordTones];
  if (color < 2 / 3) return [...ctx.chordTones, ...ctx.tensions];
  const start = ctx.scalePcs.indexOf(ctx.chord.rootPc);
  return ctx.scalePcs.map((_, i) => ctx.scalePcs[(start + i) % 7]);
}

export function poolLabel(color: number): string {
  if (color < 1 / 3) return 'chord tones';
  if (color < 2 / 3) return 'chord + 9';
  return 'full scale';
}

/** Lowest note ≥ low with pitch class pc. */
function firstAtOrAbove(pc: PitchClass, low: number): number {
  return low + mod12(pc - low);
}

/** Fold a note into [low, high] by octaves. */
export function foldRange(n: number, low: number, high: number): number {
  if (high - low < 12) return Math.min(high, Math.max(low, n));
  while (n > high) n -= 12;
  while (n < low) n += 12;
  return n;
}

/** Move a note by `steps` scale steps (diatonic transposition). Non-scale notes snap down first. */
export function stepScale(note: number, steps: number, scalePcs: PitchClass[]): number {
  if (steps === 0) return note;
  const sorted = [...scalePcs].sort((a, b) => a - b);
  let n = note;
  while (!sorted.includes(mod12(n))) n--;
  const dir = Math.sign(steps);
  for (let i = 0; i < Math.abs(steps); i++) {
    do n += dir;
    while (!sorted.includes(mod12(n)));
  }
  return n;
}

export function slotToNote(slot: number, color: number, s: NoteSettings, ctx: HarmonyContext): number {
  const pool = poolFor(color, ctx);
  const len = pool.length;
  const pc = pool[((slot % len) + len) % len];
  const oct = Math.floor(slot / len);
  let n = firstAtOrAbove(pc, s.low) + 12 * oct;
  n = foldRange(n, s.low, s.high);
  n = stepScale(n, s.transpose, ctx.scalePcs);
  n += 12 * s.octave;
  return clampMidi(n);
}

export const clampMidi = (n: number): number => Math.max(0, Math.min(127, Math.round(n)));

export interface NoteOut {
  note: number;
  velocity: number;
}

/**
 * Turn one hit into concrete notes.
 * Tonal: mono picks one interval from `steps`; chord stacks all of them; root sends just the slot note.
 * Drum: fixed base note ± spread offsets, accents above the threshold.
 */
export function hitToNotes(
  slot: number,
  strength: number,
  color: number,
  s: NoteSettings,
  vel: { low: number; high: number },
  ctx: HarmonyContext,
  rng: Rng,
): NoteOut[] {
  const st = Math.max(0, Math.min(1, strength));
  if (s.kind === 'drum') {
    const spread = Math.round(s.drumSpread * (0.25 + 0.75 * color));
    const offsets = [0, spread, -spread, Math.round(spread / 2), -Math.round(spread / 2)];
    const note = clampMidi(s.drumNote + offsets[((slot % 5) + 5) % 5]);
    const accented = st >= s.accent;
    const mid = (vel.low + vel.high) / 2;
    const v = accented ? vel.high : vel.low + (mid - vel.low) * (st / Math.max(0.01, s.accent));
    return [{ note, velocity: clampVel(v) }];
  }
  const base = slotToNote(slot, color, s, ctx);
  const v = clampVel(vel.low + (vel.high - vel.low) * st);
  const steps = s.steps.length ? s.steps : [1];
  if (s.voice === 'root') return [{ note: base, velocity: v }];
  if (s.voice === 'chord') {
    const notes = [...new Set(steps.map((k) => clampMidi(stepScale(base, k - 1, ctx.scalePcs))))];
    return notes.map((note) => ({ note, velocity: v }));
  }
  const k = rng.pick(steps);
  return [{ note: clampMidi(stepScale(base, k - 1, ctx.scalePcs)), velocity: v }];
}

const clampVel = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));
