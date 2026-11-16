import type { Division, Gate } from '../mapping/grid';
import { DEFAULT_NOTES } from '../mapping/notes';
import { Rng } from '../rng';
import { MODE_PARAMS } from '../voices';
import type { ModeId } from '../voices/types';
import { type TrackState, makeTrack } from './types';

/** Modes that read well as percussion vs. as melody (some sit in both). */
const DRUM_MODES: ModeId[] = ['drops', 'rockfall', 'pendulum', 'orbits'];
const MELODIC_MODES: ModeId[] = ['waves', 'wind', 'orbits', 'drops', 'pendulum'];

type Role = 'drum' | 'bass' | 'lead' | 'pad';

export interface RandomSetup {
  tracks: TrackState[];
  drums: number;
  melodic: number;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Pick from `pool`, preferring modes not used yet. */
function pickMode(rng: Rng, pool: ModeId[], used: Set<ModeId>): ModeId {
  const fresh = pool.filter((m) => !used.has(m));
  const m = rng.pick(fresh.length ? fresh : pool);
  used.add(m);
  return m;
}

function randomModeParams(rng: Rng, mode: ModeId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of MODE_PARAMS[mode]) {
    // stay near the default half the time so setups are playable, wander the rest
    const v = rng.chance(0.5) ? p.def : rng.range(p.min, p.max);
    const q = Math.round((v - p.min) / p.step) * p.step + p.min;
    out[p.key] = round2(Math.max(p.min, Math.min(p.max, q)));
  }
  return out;
}

function roleTrack(rng: Rng, index: number, role: Role, mode: ModeId, usedDrumNotes: Set<number>): TrackState {
  const life = { breathe: rng.pick([16, 23, 29, 32, 37, 48, 64]), rest: round2(rng.range(0.1, 0.35)), wander: round2(rng.range(0.2, 0.5)), swell: role === 'pad' || role === 'bass' ? round2(rng.range(0.3, 0.8)) : rng.chance(0.3) ? round2(rng.range(0.2, 0.5)) : 0 };
  const base = { mode, modeParams: randomModeParams(rng, mode), life };
  const ch = (index % 16) + 1;
  switch (role) {
    case 'drum': {
      let note = rng.pick([36, 38, 40, 43, 45, 48, 52, 55, 60, 64]);
      for (let k = 0; k < 10 && usedDrumNotes.has(note); k++) note = rng.pick([36, 38, 40, 43, 45, 48, 52, 55, 60, 64]);
      usedDrumNotes.add(note);
      return makeTrack(index, {
        ...base,
        macros: { intensity: round2(rng.range(0.4, 0.7)), color: round2(rng.range(0.1, 0.6)), rotation: round2(rng.next()), randomness: round2(rng.range(0.1, 0.5)) },
        notes: { ...DEFAULT_NOTES, kind: 'drum', drumNote: note, drumSpread: rng.int(0, 6), accent: round2(rng.range(0.6, 0.85)) },
        midi: {
          channel: ch,
          division: rng.pick<Division>(['1/16', '1/16', '1/8', '1/16T', '1/8.']),
          swing: rng.chance(0.75),
          gate: rng.pick<Gate>(['1/32', '1/16']),
          velLow: rng.int(50, 75),
          velHigh: rng.int(105, 128),
          chance: rng.chance(0.3) ? round2(rng.range(0.75, 0.95)) : 1,
        },
      });
    }
    case 'bass': {
      const low = rng.int(33, 41);
      return makeTrack(index, {
        ...base,
        macros: { intensity: round2(rng.range(0.25, 0.45)), color: round2(rng.range(0, 0.3)), rotation: round2(rng.next()), randomness: round2(rng.range(0.05, 0.25)) },
        notes: { ...DEFAULT_NOTES, voice: 'root', low, high: low + 12, steps: [1, 5] },
        midi: { channel: ch, division: rng.pick<Division>(['1/4', '1/8', '1/4.']), swing: false, gate: rng.pick<Gate>(['1/8', '1/4']), velLow: 60, velHigh: 100, chance: 1 },
      });
    }
    case 'pad': {
      const low = rng.int(46, 53);
      return makeTrack(index, {
        ...base,
        macros: { intensity: round2(rng.range(0.15, 0.35)), color: round2(rng.range(0.3, 0.7)), rotation: round2(rng.next()), randomness: round2(rng.range(0.05, 0.25)) },
        notes: { ...DEFAULT_NOTES, voice: 'chord', low, high: low + 22, steps: rng.pick([[1, 3, 5], [1, 5, 9], [1, 3, 7], [1, 4, 5]]) },
        midi: { channel: ch, division: rng.pick<Division>(['1/4', '1/4.']), swing: false, gate: rng.pick<Gate>(['1/2', '1/1', '2/1']), velLow: 45, velHigh: 85, chance: 1 },
      });
    }
    case 'lead': {
      const low = rng.int(55, 62);
      return makeTrack(index, {
        ...base,
        macros: { intensity: round2(rng.range(0.3, 0.6)), color: round2(rng.range(0.4, 0.9)), rotation: round2(rng.next()), randomness: round2(rng.range(0.15, 0.55)) },
        notes: {
          ...DEFAULT_NOTES,
          voice: 'mono',
          low,
          high: low + rng.int(14, 22),
          steps: rng.pick([[1], [1, 3], [1, 3, 5], [1, 4, 5], [1, 2, 3, 5]]),
          transpose: rng.chance(0.3) ? rng.pick([-2, 2, 4]) : 0,
        },
        midi: {
          channel: ch,
          division: rng.pick<Division>(['1/8', '1/16', '1/8T', '1/16T', '1/8.']),
          swing: rng.chance(0.6),
          gate: rng.pick<Gate>(['1/16', '1/8', '1/4']),
          velLow: rng.int(45, 65),
          velHigh: rng.int(90, 115),
          chance: rng.chance(0.4) ? round2(rng.range(0.7, 0.95)) : 1,
        },
      });
    }
  }
}

/**
 * A fresh, playable setup: a couple of drum voices and a couple of melodic ones (bass, pad, leads),
 * modes spread so they don't double up, one channel per track. `count` is clamped to 4…8.
 */
export function randomSetup(seed: number, count = 6): RandomSetup {
  const rng = new Rng(seed);
  const n = Math.max(4, Math.min(8, Math.round(count)));
  const drums = Math.max(2, Math.min(n - 2, Math.round(n / 2) + rng.int(-1, 1)));
  const melodic = n - drums;
  const roles: Role[] = [];
  for (let i = 0; i < drums; i++) roles.push('drum');
  const mel: Role[] = ['bass', 'lead'];
  if (melodic >= 3) mel.push(rng.chance(0.6) ? 'pad' : 'lead');
  while (mel.length < melodic) mel.push(rng.pick<Role>(['lead', 'pad']));
  roles.push(...mel);

  const used = new Set<ModeId>();
  const notes = new Set<number>();
  // modes: give melodic roles their natural fits first
  const fit: Partial<Record<Role, ModeId[]>> = { pad: ['waves', 'orbits'], bass: ['pendulum', 'orbits', 'waves'] };
  const tracks = roles.map((role, i) => {
    const pool = role === 'drum' ? DRUM_MODES : (fit[role] ?? MELODIC_MODES);
    return roleTrack(rng, i, role, pickMode(rng, pool, used), notes);
  });

  // sometimes a melodic voice listens to a drum voice — gentle call and response
  if (rng.chance(0.5)) {
    const listener = drums + rng.int(0, melodic);
    tracks[listener].listen = { source: rng.int(0, drums), amount: round2(rng.range(0.3, 0.6)) };
  }
  return { tracks, drums, melodic };
}
