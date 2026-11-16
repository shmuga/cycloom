import { describe, expect, it } from 'vitest';
import { GATES, DIVISIONS } from '../src/mapping/grid';
import { randomSetup } from '../src/state/randomise';
import { MODE_PARAMS } from '../src/voices';

describe('randomise setup', () => {
  it('makes a couple of drum and a couple of melodic voices, drums first, one channel each', () => {
    for (let seed = 1; seed < 200; seed++) {
      const r = randomSetup(seed, 6);
      expect(r.tracks).toHaveLength(6);
      expect(r.drums).toBeGreaterThanOrEqual(2);
      expect(r.melodic).toBeGreaterThanOrEqual(2);
      const kinds = r.tracks.map((t) => t.notes.kind);
      expect(kinds.filter((k) => k === 'drum')).toHaveLength(r.drums);
      expect(kinds.slice(0, r.drums).every((k) => k === 'drum')).toBe(true);
      expect(r.tracks.map((t) => t.midi.channel)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(new Set(r.tracks.map((t) => t.id)).size).toBe(6);
    }
  });

  it('stays within every control range', () => {
    for (let seed = 1; seed < 200; seed++) {
      for (const t of randomSetup(seed, 1 + (seed % 10)).tracks) {
        for (const p of MODE_PARAMS[t.mode]) {
          expect(t.modeParams[p.key]).toBeGreaterThanOrEqual(p.min);
          expect(t.modeParams[p.key]).toBeLessThanOrEqual(p.max);
        }
        for (const v of Object.values(t.macros)) expect(v >= 0 && v <= 1).toBe(true);
        expect(DIVISIONS).toContain(t.midi.division);
        expect(GATES).toContain(t.midi.gate);
        expect(t.midi.velLow).toBeLessThan(t.midi.velHigh);
        expect(t.midi.velHigh).toBeLessThanOrEqual(127);
        expect(t.notes.low).toBeLessThan(t.notes.high);
      }
    }
  });

  it('melodic voices have a bass and a lead; modes are spread; it is deterministic per seed', () => {
    const r = randomSetup(42, 6);
    const mel = r.tracks.slice(r.drums);
    expect(mel.some((t) => t.notes.voice === 'root' && t.notes.high <= 60)).toBe(true);
    expect(mel.some((t) => t.notes.voice === 'mono' && t.notes.low >= 55)).toBe(true);
    expect(new Set(r.tracks.map((t) => t.mode)).size).toBeGreaterThanOrEqual(4);
    const strip = (x: ReturnType<typeof randomSetup>) => x.tracks.map(({ id: _id, ...t }) => t);
    expect(strip(randomSetup(42, 6))).toEqual(strip(r));
    expect(strip(randomSetup(43, 6))).not.toEqual(strip(r));
  });

  it('clamps the count to 4…8 and keeps listen sources valid', () => {
    expect(randomSetup(1, 1).tracks).toHaveLength(4);
    expect(randomSetup(1, 20).tracks).toHaveLength(8);
    for (let seed = 1; seed < 100; seed++) {
      const r = randomSetup(seed, 6);
      r.tracks.forEach((t, i) => {
        if (t.listen.source >= 0) {
          expect(t.listen.source).toBeLessThan(r.drums);
          expect(i).toBeGreaterThanOrEqual(r.drums);
        }
      });
    }
  });
});
