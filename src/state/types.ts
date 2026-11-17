import { DEFAULT_HARMONY, type HarmonySettings } from '../harmony/engine';
import type { Division, Gate } from '../mapping/grid';
import { DEFAULT_NOTES, type NoteSettings } from '../mapping/notes';
import { MODE_PARAMS } from '../voices';
import type { Macros, ModeId } from '../voices/types';

export interface TrackMidi {
  channel: number; // 1..16
  division: Division;
  swing: boolean;
  gate: Gate;
  velLow: number;
  velHigh: number;
  chance: number; // 0..1
}

export interface TrackLife {
  breathe: number; // cycle length in bars (8..128) — density breathes on it, velocity swells on it
  swell: number; // 0..1 velocity rise-and-fall depth over the breathe cycle
  rest: number; // 0..1
  wander: number; // 0..1
}

export interface TrackState {
  id: string;
  mode: ModeId;
  modeParams: Record<string, number>;
  macros: Macros;
  notes: NoteSettings;
  midi: TrackMidi;
  life: TrackLife;
  listen: { source: number; amount: number };
  mute: boolean;
  solo: boolean;
}

export interface JourneyState {
  pace: number; // fader 0..1 → ×0.25..×8
  home: number;
  weather: number;
  breathe: number;
  rest: number;
  wander: number;
  voices: number; // max simultaneously active tracks
  notesPerBar: number;
}

export type ClockSource = 'internal' | 'external';

export interface AppState {
  bpm: number;
  swing: number; // 0.5..0.75
  clock: ClockSource;
  outputId: string; // '' = preview
  inputId: string;
  timestamped: 'auto' | 'on' | 'off';
  latencyMs: number;
  harmony: HarmonySettings;
  journey: JourneyState;
  tracks: TrackState[];
}

export const MAX_TRACKS = 16;

export function defaultModeParams(mode: ModeId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of MODE_PARAMS[mode]) out[p.key] = p.def;
  return out;
}

let idCounter = 0;
export const newId = (): string => `t${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function makeTrack(index: number, partial: Partial<TrackState> = {}): TrackState {
  const mode: ModeId = partial.mode ?? 'drops';
  return {
    id: newId(),
    mode,
    modeParams: defaultModeParams(mode),
    macros: { intensity: 0.5, color: 0.4, rotation: 0.3, randomness: 0.3 },
    notes: { ...DEFAULT_NOTES },
    midi: { channel: (index % 16) + 1, division: '1/16', swing: true, gate: '1/16', velLow: 60, velHigh: 110, chance: 1 },
    life: { breathe: 32, rest: 0.2, wander: 0.3, swell: 0 },
    listen: { source: -1, amount: 0.5 },
    mute: false,
    solo: false,
    ...partial,
  };
}

/** The default six tracks, two drum and four tonal voices on channels 1–6. */
export function defaultTracks(): TrackState[] {
  const drum = (note: number) => ({ ...DEFAULT_NOTES, kind: 'drum' as const, drumNote: note });
  return [
    makeTrack(0, {
      mode: 'drops',
      macros: { intensity: 0.62, color: 0.4, rotation: 0.15, randomness: 0.3 },
      notes: drum(60),
      midi: { channel: 1, division: '1/16', swing: true, gate: '1/32', velLow: 60, velHigh: 110, chance: 1 },
    }),
    makeTrack(1, {
      mode: 'waves',
      modeParams: defaultModeParams('waves'),
      macros: { intensity: 0.35, color: 0.7, rotation: 0.5, randomness: 0.2 },
      notes: { ...DEFAULT_NOTES, low: 50, high: 69 },
      midi: { channel: 2, division: '1/4', swing: false, gate: '1/2', velLow: 50, velHigh: 95, chance: 1 },
      life: { breathe: 64, rest: 0.25, wander: 0.3, swell: 0 },
    }),
    makeTrack(2, {
      mode: 'rockfall',
      modeParams: defaultModeParams('rockfall'),
      macros: { intensity: 0.55, color: 0.25, rotation: 0.6, randomness: 0.45 },
      notes: { ...drum(48), drumSpread: 5 },
      midi: { channel: 3, division: '1/8', swing: true, gate: '1/16', velLow: 80, velHigh: 127, chance: 1 },
    }),
    makeTrack(3, {
      mode: 'wind',
      modeParams: defaultModeParams('wind'),
      macros: { intensity: 0.48, color: 0.6, rotation: 0.8, randomness: 0.65 },
      notes: { ...DEFAULT_NOTES, low: 57, high: 76, steps: [1, 4, 5], transpose: 2 },
      midi: { channel: 4, division: '1/16T', swing: true, gate: '1/8', velLow: 50, velHigh: 100, chance: 0.9 },
      life: { breathe: 32, rest: 0.2, wander: 0.3, swell: 0 },
    }),
    makeTrack(4, {
      mode: 'pendulum',
      modeParams: defaultModeParams('pendulum'),
      macros: { intensity: 0.4, color: 0.3, rotation: 0.1, randomness: 0.05 },
      notes: drum(64),
      midi: { channel: 5, division: '1/8', swing: true, gate: '1/16', velLow: 60, velHigh: 110, chance: 1 },
    }),
    makeTrack(5, {
      mode: 'orbits',
      modeParams: defaultModeParams('orbits'),
      macros: { intensity: 0.25, color: 0.55, rotation: 0.35, randomness: 0.15 },
      notes: { ...DEFAULT_NOTES, voice: 'chord', low: 48, high: 72 },
      midi: { channel: 6, division: '1/4.', swing: false, gate: '1/4', velLow: 50, velHigh: 90, chance: 1 },
      life: { breathe: 48, rest: 0.15, wander: 0.3, swell: 0 },
    }),
  ];
}

export function defaultState(): AppState {
  return {
    bpm: 112,
    swing: 0.56,
    clock: 'internal',
    outputId: '',
    inputId: '',
    timestamped: 'auto',
    latencyMs: 0,
    harmony: { ...DEFAULT_HARMONY },
    journey: { pace: 0.6, home: 0.4, weather: 0.25, breathe: 0.55, rest: 0.3, wander: 0.35, voices: 4, notesPerBar: 24 },
    tracks: defaultTracks(),
  };
}

/** Fader value (0..1) → harmony period multiplier ×0.25 … ×8 (log scale). */
export const paceFactor = (v: number): number => 0.25 * Math.pow(32, Math.max(0, Math.min(1, v)));

export function cloneState<T>(s: T): T {
  return structuredClone(s);
}
