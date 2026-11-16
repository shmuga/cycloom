import { MODE_PARAMS } from '../voices';
import type { AppState } from './types';
import { paceFactor } from './types';

/**
 * Every continuous, fader-able parameter, addressed by a path.
 * Track params: "macros.intensity", "mode.paddles", "life.breathe"…  (need a track index)
 * Global params: "journey.pace", "bpm", "swing", "harmony.depth"…
 */
export interface ParamDef {
  min: number;
  max: number;
  step: number;
  def: number;
  fmt: (v: number) => string;
  get: (s: AppState, track: number) => number;
  set: (s: AppState, track: number, v: number) => void;
}

const dec2 = (v: number): string => (v >= 1 ? v.toFixed(2) : v.toFixed(2).replace(/^0/, ''));

const macro = (k: 'intensity' | 'color' | 'rotation' | 'randomness', def: number): ParamDef => ({
  min: 0,
  max: 1,
  step: 0.01,
  def,
  fmt: dec2,
  get: (s, t) => s.tracks[t].macros[k],
  set: (s, t, v) => {
    s.tracks[t].macros[k] = v;
  },
});

const life = (k: 'breathe' | 'swell' | 'rest' | 'wander', min: number, max: number, step: number, def: number, fmt: (v: number) => string): ParamDef => ({
  min,
  max,
  step,
  def,
  fmt,
  get: (s, t) => s.tracks[t].life[k],
  set: (s, t, v) => {
    s.tracks[t].life[k] = v;
  },
});

const journey = (
  k: keyof AppState['journey'],
  min: number,
  max: number,
  step: number,
  def: number,
  fmt: (v: number) => string,
): ParamDef => ({
  min,
  max,
  step,
  def,
  fmt,
  get: (s) => s.journey[k],
  set: (s, _t, v) => {
    s.journey[k] = v;
  },
});

export function paceLabel(v: number): string {
  const f = paceFactor(v);
  return f >= 1 ? `×${f < 10 ? +f.toFixed(1) : Math.round(f)}` : `×${+f.toFixed(2)}`;
}

export const PARAMS: Record<string, ParamDef> = {
  'macros.intensity': macro('intensity', 0.5),
  'macros.color': macro('color', 0.4),
  'macros.rotation': macro('rotation', 0.3),
  'macros.randomness': macro('randomness', 0.3),
  'life.breathe': life('breathe', 8, 128, 1, 32, (v) => `${Math.round(v)} bars`),
  'life.swell': life('swell', 0, 1, 0.01, 0, dec2),
  'life.rest': life('rest', 0, 1, 0.01, 0.2, dec2),
  'life.wander': life('wander', 0, 1, 0.01, 0.3, dec2),
  'journey.pace': journey('pace', 0, 1, 0.01, 0.6, paceLabel),
  'journey.home': journey('home', 0, 1, 0.01, 0.4, dec2),
  'journey.weather': journey('weather', 0, 1, 0.01, 0.25, dec2),
  'journey.breathe': journey('breathe', 0, 1, 0.01, 0.55, dec2),
  'journey.rest': journey('rest', 0, 1, 0.01, 0.3, dec2),
  'journey.wander': journey('wander', 0, 1, 0.01, 0.35, dec2),
  'journey.voices': journey('voices', 0, 6, 1, 4, (v) => `${Math.round(v)}`),
  'journey.notesPerBar': journey('notesPerBar', 0, 48, 1, 24, (v) => `${Math.round(v)}`),
  bpm: {
    min: 40,
    max: 200,
    step: 0.1,
    def: 112,
    fmt: (v) => v.toFixed(1),
    get: (s) => s.bpm,
    set: (s, _t, v) => {
      s.bpm = v;
    },
  },
  swing: {
    min: 0.5,
    max: 0.75,
    step: 0.01,
    def: 0.56,
    fmt: (v) => `${Math.round(v * 100)}%`,
    get: (s) => s.swing,
    set: (s, _t, v) => {
      s.swing = v;
    },
  },
  'harmony.depth': {
    min: 0,
    max: 1,
    step: 0.05,
    def: 0.45,
    fmt: (v) => v.toFixed(2),
    get: (s) => s.harmony.depth,
    set: (s, _t, v) => {
      s.harmony.depth = v;
    },
  },
};

/** Look up a param definition, including mode params ("mode.<key>") which depend on the track's mode. */
export function paramDef(path: string, s?: AppState, track = 0): ParamDef | null {
  if (path === 'journey.voices' && s) return { ...PARAMS[path], max: Math.max(6, s.tracks.length) };
  if (PARAMS[path]) return PARAMS[path];
  if (path.startsWith('mode.') && s) {
    const key = path.slice(5);
    const tr = s.tracks[track];
    if (!tr) return null;
    const spec = MODE_PARAMS[tr.mode].find((p) => p.key === key);
    if (!spec) return null;
    return {
      min: spec.min,
      max: spec.max,
      step: spec.step,
      def: spec.def,
      fmt: spec.fmt ?? ((v) => `${v}`),
      get: (st, t) => st.tracks[t].modeParams[key] ?? spec.def,
      set: (st, t, v) => {
        st.tracks[t].modeParams[key] = v;
      },
    };
  }
  return null;
}

export function quantize(def: ParamDef, v: number): number {
  const c = Math.max(def.min, Math.min(def.max, v));
  const q = Math.round((c - def.min) / def.step) * def.step + def.min;
  return +q.toFixed(6);
}

export const toNorm = (def: ParamDef, v: number): number => (v - def.min) / (def.max - def.min || 1);
export const fromNorm = (def: ParamDef, n: number): number => quantize(def, def.min + Math.max(0, Math.min(1, n)) * (def.max - def.min));
