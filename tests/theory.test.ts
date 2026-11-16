import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import {
  MODES,
  buildChord,
  modeFromTonic,
  noteName,
  romanFor,
  scaleName,
  scalePcs,
  signature,
  spellScale,
  voiceLead,
} from '../src/music/theory';

describe('rng', () => {
  it('is deterministic and serialisable', () => {
    const a = new Rng(42);
    const seq = [a.next(), a.next(), a.next()];
    const b = new Rng(42);
    expect([b.next(), b.next(), b.next()]).toEqual(seq);
    const c = new Rng(a.state);
    expect(c.next()).toBe(a.next());
  });
  it('weighted picks proportionally and handles zero weights', () => {
    const r = new Rng(1);
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) counts[r.weighted([1, 0, 3])]++;
    expect(counts[1]).toBe(0);
    expect(counts[2] / counts[0]).toBeGreaterThan(2);
    expect(r.weighted([0, 0])).toBe(-1);
  });
  it('fork yields independent streams', () => {
    const r = new Rng(7);
    expect(r.fork('a').next()).not.toBe(r.fork('b').next());
  });
});

describe('scales', () => {
  it('builds D aeolian and spells it with flats', () => {
    const s = { root: 2, mode: 'aeolian' as const };
    expect(scalePcs(s)).toEqual([2, 4, 5, 7, 9, 10, 0]);
    expect(spellScale(s)).toEqual(['D', 'E', 'F', 'G', 'A', 'B♭', 'C']);
    expect(scaleName(s)).toBe('D aeolian');
  });
  it('signatures follow the circle of fifths', () => {
    expect(signature({ root: 0, mode: 'ionian' })).toBe(0);
    expect(signature({ root: 2, mode: 'aeolian' })).toBe(-1); // F major
    expect(signature({ root: 9, mode: 'aeolian' })).toBe(0);
    expect(signature({ root: 7, mode: 'ionian' })).toBe(1);
  });
  it('finds relative modes', () => {
    const pcs = scalePcs({ root: 2, mode: 'aeolian' });
    expect(modeFromTonic(pcs, 5)).toBe('ionian'); // F
    expect(modeFromTonic(pcs, 4)).toBe(null); // E locrian is excluded
  });
  it('every mode has 7 distinct notes', () => {
    for (const m of MODES) expect(new Set(scalePcs({ root: 3, mode: m })).size).toBe(7);
  });
  it('names notes', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(57)).toBe('A3');
  });
});

describe('chords', () => {
  const s = { root: 2, mode: 'aeolian' as const };
  it('names the mock progression in D aeolian', () => {
    expect(buildChord(s, { degree: 0, ext: '9' }).name).toBe('Dm9');
    expect(buildChord(s, { degree: 5, ext: '7' }).name).toBe('B♭maj7');
    expect(buildChord(s, { degree: 2, ext: 'add9' }).name).toBe('Fadd9');
    expect(buildChord(s, { degree: 6, ext: '6' }).name).toBe('C6');
  });
  it('chord tones are diatonic', () => {
    const pcs = scalePcs(s);
    for (let d = 0; d < 7; d++) for (const ext of ['triad', '7', '9', 'sus2', 'add9'] as const) {
      expect(buildChord(s, { degree: d, ext }).pcs.every((p) => pcs.includes(p))).toBe(true);
    }
  });
  it('roman numerals reflect quality', () => {
    expect(romanFor(s, 0)).toBe('i');
    expect(romanFor(s, 5)).toBe('VI');
    expect(romanFor(s, 1)).toBe('ii°');
  });
  it('voice leading keeps voices close', () => {
    const a = voiceLead([2, 5, 9, 0], null);
    const b = voiceLead([10, 2, 5, 9], a);
    const move = b.reduce((acc, n, i) => acc + Math.abs(n - (a[i] ?? n)), 0);
    expect(move).toBeLessThan(16);
  });
});
