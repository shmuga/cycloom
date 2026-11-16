import type { HarmonySettings } from '../harmony/engine';
import type { Division, Gate } from '../mapping/grid';
import { DEFAULT_NOTES, type NoteSettings } from '../mapping/notes';
import type { Macros, ModeId } from '../voices/types';
import { type AppState, type JourneyState, type TrackLife, type TrackState, defaultModeParams, defaultState, makeTrack } from './types';

export interface Preset {
  id: string;
  name: string;
  /** one line shown in the picker */
  blurb: string;
  build(): AppState;
}

interface Spec {
  mode: ModeId;
  macros: Macros;
  notes: Partial<NoteSettings>;
  division: Division;
  gate: Gate;
  vel: [number, number];
  life: TrackLife;
  swing?: boolean;
  chance?: number;
  params?: Record<string, number>;
}

const m = (intensity: number, color: number, rotation: number, randomness: number): Macros => ({ intensity, color, rotation, randomness });
const life = (breathe: number, swell: number, rest: number, wander: number): TrackLife => ({ breathe, swell, rest, wander });

function tracks(specs: Spec[]): TrackState[] {
  return specs.map((sp, i) =>
    makeTrack(i, {
      mode: sp.mode,
      modeParams: { ...defaultModeParams(sp.mode), ...(sp.params ?? {}) },
      macros: sp.macros,
      notes: { ...DEFAULT_NOTES, ...sp.notes },
      midi: { channel: i + 1, division: sp.division, swing: sp.swing ?? false, gate: sp.gate, velLow: sp.vel[0], velHigh: sp.vel[1], chance: sp.chance ?? 1 },
      life: sp.life,
    }),
  );
}

function state(o: { bpm: number; swing?: number; harmony: Partial<HarmonySettings>; journey: Partial<JourneyState>; tracks: Spec[] }): AppState {
  const d = defaultState();
  return {
    ...d,
    bpm: o.bpm,
    swing: o.swing ?? 0.5,
    harmony: { ...d.harmony, ...o.harmony },
    journey: { ...d.journey, ...o.journey },
    tracks: tracks(o.tracks),
  };
}

/**
 * Starting points. "airports" follows Eno's tape-loop idea: a few voices, each a single sparse
 * figure on its own co-prime loop length (breathe 17, 19, 23, 29, 31, 37 bars), slowly swelling
 * in and out so the combinations never repeat. "drone" holds long notes under slow swells.
 */
export const PRESETS: Preset[] = [
  {
    id: 'airports',
    name: 'airports',
    blurb: 'Eno-style loops: six slow voices on co-prime cycles, swelling in and out',
    build: () =>
      state({
        bpm: 60,
        harmony: { root: 1, mode: 'ionian', barsPerChord: 8, morphBars: 4, depth: 0.25, driftBars: 64, relation: 'relative', holdScale: true, holdChord: false },
        journey: { pace: 0.7, home: 0.8, weather: 0.08, breathe: 0.15, rest: 0.12, wander: 0.15, voices: 6, notesPerBar: 6 },
        tracks: [
          { mode: 'waves', macros: m(0.12, 0.1, 0.3, 0.05), notes: { low: 44, high: 56, steps: [1] }, division: '1/4', gate: '2/1', vel: [30, 90], life: life(17, 0.85, 0.1, 0.1), params: { swell: 16 } },
          { mode: 'waves', macros: m(0.14, 0.2, 0.7, 0.05), notes: { low: 53, high: 65, steps: [1, 5] }, division: '1/4', gate: '1/1', vel: [30, 85], life: life(23, 0.8, 0.15, 0.15), params: { swell: 12 } },
          { mode: 'orbits', macros: m(0.1, 0.25, 0.2, 0.05), notes: { low: 60, high: 72, steps: [1] }, division: '1/4', gate: '1/1', vel: [25, 80], life: life(29, 0.9, 0.1, 0.1), params: { ratios: 3, rays: 1 } },
          { mode: 'pendulum', macros: m(0.12, 0.3, 0.5, 0.05), notes: { low: 63, high: 75, steps: [1, 3] }, division: '1/4', gate: '1/2', vel: [25, 75], life: life(19, 0.85, 0.15, 0.15), params: { count: 3, spread: 3 } },
          { mode: 'orbits', macros: m(0.08, 0.45, 0.6, 0.1), notes: { low: 67, high: 79, steps: [1, 5] }, division: '1/4.', gate: '1/1', vel: [20, 70], life: life(31, 0.9, 0.2, 0.2), params: { ratios: 4, rays: 1 } },
          { mode: 'waves', macros: m(0.08, 0.5, 0.4, 0.1), notes: { low: 72, high: 84, steps: [1] }, division: '1/4', gate: '1/1', vel: [20, 65], life: life(37, 0.9, 0.2, 0.2), params: { swell: 16 } },
        ],
      }),
  },
  {
    id: 'drone',
    name: 'drone',
    blurb: 'held roots and fifths, a slow chord pad, faint glints and a soft pulse',
    build: () =>
      state({
        bpm: 66,
        harmony: { root: 9, mode: 'dorian', barsPerChord: 8, morphBars: 4, depth: 0.5, driftBars: 64, relation: 'brightness', holdScale: false, holdChord: false },
        journey: { pace: 0.85, home: 0.7, weather: 0.15, breathe: 0.2, rest: 0.1, wander: 0.2, voices: 5, notesPerBar: 10 },
        tracks: [
          { mode: 'waves', macros: m(0.3, 0, 0.5, 0), notes: { voice: 'root', low: 33, high: 45, steps: [1] }, division: '1/4', gate: '4/1', vel: [50, 95], life: life(24, 0.5, 0, 0.05), params: { buoys: 2, swell: 8 } },
          { mode: 'waves', macros: m(0.3, 0.1, 0.2, 0), notes: { voice: 'chord', low: 40, high: 55, steps: [1, 5] }, division: '1/4', gate: '4/1', vel: [35, 85], life: life(31, 0.8, 0.05, 0.1), params: { buoys: 3, swell: 12 } },
          { mode: 'orbits', macros: m(0.15, 0.55, 0.3, 0.05), notes: { voice: 'chord', low: 52, high: 74, steps: [1, 3, 7] }, division: '1/4', gate: '2/1', vel: [25, 70], life: life(41, 0.9, 0.1, 0.25), params: { ratios: 1, rays: 2 } },
          { mode: 'wind', macros: m(0.15, 0.8, 0.2, 0.3), notes: { low: 72, high: 88, steps: [1, 5] }, division: '1/8', gate: '1/4', vel: [20, 55], life: life(29, 0.7, 0.3, 0.3), chance: 0.5 },
          { mode: 'pendulum', macros: m(0.15, 0.1, 0.1, 0), notes: { kind: 'drum', drumNote: 36, drumSpread: 0, accent: 0.9 }, division: '1/4', gate: '1/16', vel: [25, 55], life: life(48, 0.6, 0.2, 0.05), params: { count: 3, spread: 2 } },
        ],
      }),
  },
  {
    id: 'shoreline',
    name: 'shoreline',
    blurb: 'a swelling pad over soft drops, a wandering lead and occasional rockfalls',
    build: () =>
      state({
        bpm: 82,
        swing: 0.55,
        harmony: { root: 4, mode: 'aeolian', barsPerChord: 4, morphBars: 2, depth: 0.45, driftBars: 32, relation: 'fifths', holdScale: false, holdChord: false },
        journey: { pace: 0.7, home: 0.5, weather: 0.3, breathe: 0.4, rest: 0.25, wander: 0.35, voices: 4, notesPerBar: 16 },
        tracks: [
          { mode: 'drops', macros: m(0.35, 0.3, 0.2, 0.25), notes: { kind: 'drum', drumNote: 60, drumSpread: 3 }, division: '1/16', gate: '1/32', vel: [40, 90], life: life(23, 0.4, 0.2, 0.3), swing: true },
          { mode: 'rockfall', macros: m(0.2, 0.2, 0.5, 0.35), notes: { kind: 'drum', drumNote: 45, drumSpread: 4 }, division: '1/8', gate: '1/16', vel: [50, 110], life: life(37, 0.3, 0.35, 0.3), swing: true },
          { mode: 'waves', macros: m(0.25, 0.6, 0.5, 0.15), notes: { voice: 'chord', low: 48, high: 69, steps: [1, 3, 5] }, division: '1/4', gate: '2/1', vel: [35, 85], life: life(32, 0.8, 0.1, 0.3) },
          { mode: 'wind', macros: m(0.35, 0.65, 0.8, 0.5), notes: { low: 60, high: 79, steps: [1, 3, 5] }, division: '1/16T', gate: '1/8', vel: [40, 95], life: life(29, 0.5, 0.25, 0.4), swing: true, chance: 0.85 },
          { mode: 'pendulum', macros: m(0.25, 0.1, 0.3, 0.05), notes: { voice: 'root', low: 36, high: 48 }, division: '1/4', gate: '1/1', vel: [55, 95], life: life(48, 0.4, 0.1, 0.1), params: { count: 3, spread: 2 } },
        ],
      }),
  },
  {
    id: 'rain-garden',
    name: 'rain garden',
    blurb: 'busier and percussive: three drum voices, bells on orbits, a bass and a run',
    build: () =>
      state({
        bpm: 100,
        swing: 0.58,
        harmony: { root: 7, mode: 'mixolydian', barsPerChord: 2, morphBars: 1, depth: 0.5, driftBars: 16, relation: 'fifths', holdScale: false, holdChord: false },
        journey: { pace: 0.55, home: 0.4, weather: 0.35, breathe: 0.45, rest: 0.3, wander: 0.4, voices: 5, notesPerBar: 28 },
        tracks: [
          { mode: 'drops', macros: m(0.6, 0.4, 0.15, 0.3), notes: { kind: 'drum', drumNote: 60, drumSpread: 3 }, division: '1/16', gate: '1/32', vel: [60, 110], life: life(32, 0, 0.2, 0.3), swing: true },
          { mode: 'rockfall', macros: m(0.5, 0.25, 0.6, 0.45), notes: { kind: 'drum', drumNote: 48, drumSpread: 5 }, division: '1/8', gate: '1/16', vel: [80, 127], life: life(24, 0, 0.2, 0.3), swing: true },
          { mode: 'pendulum', macros: m(0.45, 0.3, 0.1, 0.05), notes: { kind: 'drum', drumNote: 64, drumSpread: 2 }, division: '1/8', gate: '1/16', vel: [60, 110], life: life(29, 0.3, 0.2, 0.2), swing: true },
          { mode: 'orbits', macros: m(0.4, 0.55, 0.35, 0.15), notes: { low: 67, high: 84, steps: [1, 5] }, division: '1/8', gate: '1/8', vel: [50, 100], life: life(37, 0.4, 0.15, 0.3) },
          { mode: 'waves', macros: m(0.3, 0.1, 0.5, 0.1), notes: { voice: 'root', low: 36, high: 48 }, division: '1/4', gate: '1/2', vel: [60, 100], life: life(48, 0.3, 0.1, 0.2) },
          { mode: 'wind', macros: m(0.5, 0.7, 0.8, 0.6), notes: { low: 60, high: 79, steps: [1, 4, 5] }, division: '1/16T', gate: '1/8', vel: [50, 100], life: life(23, 0.3, 0.2, 0.3), swing: true, chance: 0.9 },
        ],
      }),
  },
  {
    id: 'default',
    name: 'cycloom',
    blurb: 'the starting island: three drums and three tonal voices',
    build: () => defaultState(),
  },
];
