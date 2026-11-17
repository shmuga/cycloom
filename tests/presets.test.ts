import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';
import { Recorder } from '../src/midi/capture';
import { type NoteEvent, OutputRouter } from '../src/midi/router';
import { DIVISIONS, GATES, divisionBeats } from '../src/mapping/grid';
import { PRESETS } from '../src/state/presets';
import { migrate } from '../src/state/persist';
import { Store } from '../src/state/store';
import { MODE_PARAMS } from '../src/voices';

function play(state: ReturnType<(typeof PRESETS)[number]['build']>, seconds: number) {
  const store = new Store(state);
  const router = new OutputRouter();
  const notes: NoteEvent[] = [];
  router.sinks.push({ noteOn: (e) => notes.push(e) });
  router.out = { send: () => {} };
  const engine = new Engine(store, router, new Recorder());
  engine.start(0);
  for (let t = 0; t <= seconds; t += 0.025) engine.tick(t);
  return { notes, store };
}

describe('presets', () => {
  it('are valid states with every control in range', () => {
    for (const p of PRESETS) {
      const s = p.build();
      expect(migrate(JSON.parse(JSON.stringify(s)))).toEqual(s);
      s.tracks.forEach((t, i) => {
        expect(t.midi.channel).toBe(i + 1);
        expect(DIVISIONS).toContain(t.midi.division);
        expect(GATES).toContain(t.midi.gate);
        for (const sp of MODE_PARAMS[t.mode]) {
          expect(t.modeParams[sp.key], `${p.id} ${t.mode}.${sp.key}`).toBeGreaterThanOrEqual(sp.min);
          expect(t.modeParams[sp.key], `${p.id} ${t.mode}.${sp.key}`).toBeLessThanOrEqual(sp.max);
        }
        expect(t.life.swell >= 0 && t.life.swell <= 1).toBe(true);
      });
    }
  });

  it('each preset makes sound within the first minute', () => {
    for (const p of PRESETS) {
      const { notes } = play(p.build(), 60);
      expect(notes.length, p.id).toBeGreaterThan(4);
    }
  });

  it('drone holds long notes; airports loops are co-prime and sparse', () => {
    const drone = play(PRESETS.find((p) => p.id === 'drone')!.build(), 90);
    const beatSec = 60 / 66;
    expect(drone.notes.some((n) => n.dur >= 4 * 4 * beatSec - 1e-6)).toBe(true);
    const air = PRESETS.find((p) => p.id === 'airports')!.build();
    const cycles = air.tracks.map((t) => t.life.breathe);
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    for (let i = 0; i < cycles.length; i++) for (let j = i + 1; j < cycles.length; j++) expect(gcd(cycles[i], cycles[j])).toBe(1);
    expect(air.tracks.every((t) => t.notes.kind === 'tonal' && t.life.swell >= 0.8)).toBe(true);
  });

  it('long gates parse to bars', () => {
    expect(divisionBeats('2/1')).toBe(8);
    expect(divisionBeats('4/1')).toBe(16);
    expect(divisionBeats('1/16T')).toBeCloseTo(1 / 6);
  });
});

describe('swell', () => {
  it('rises and falls velocity over the breathe cycle, and is off at 0', async () => {
    const { Journey } = await import('../src/journey/journey');
    const { defaultState } = await import('../src/state/types');
    const s = defaultState();
    const j = new Journey(1);
    j.ensureTracks(s.tracks.length);
    s.tracks[0].life.breathe = 16;
    s.tracks[0].life.swell = 0;
    expect(j.swell(0, s, 3.3)).toBe(1);
    s.tracks[0].life.swell = 0.8;
    const vals = Array.from({ length: 64 }, (_, k) => j.swell(0, s, k / 4));
    expect(Math.min(...vals)).toBeLessThan(0.25);
    expect(Math.max(...vals)).toBeGreaterThan(0.95);
    // periodic over its own cycle
    expect(j.swell(0, s, 2)).toBeCloseTo(j.swell(0, s, 18), 9);
  });
});

describe('initial state', () => {
  it('a fresh visit starts on the airports preset', async () => {
    const { initialState } = await import('../src/state/presets');
    const s = initialState();
    expect(s.bpm).toBe(60);
    expect(s.tracks.every((t) => t.life.swell > 0)).toBe(true);
  });
});
