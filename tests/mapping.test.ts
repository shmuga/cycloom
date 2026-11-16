import { describe, expect, it } from 'vitest';
import { HarmonyEngine } from '../src/harmony/engine';
import { divisionBeats, snapForward } from '../src/mapping/grid';
import { DEFAULT_NOTES, foldRange, hitToNotes, poolFor, slotToNote, stepScale } from '../src/mapping/notes';
import { mod12 } from '../src/music/theory';
import { Rng } from '../src/rng';

const ctx = new HarmonyEngine().context(); // D aeolian, Dm9

describe('grid', () => {
  it('parses divisions', () => {
    expect(divisionBeats('1/4')).toBe(1);
    expect(divisionBeats('1/16')).toBe(0.25);
    expect(divisionBeats('1/8T')).toBeCloseTo(1 / 3);
    expect(divisionBeats('1/4.')).toBe(1.5);
  });
  it('snaps forward, never backward', () => {
    for (const b of [0, 0.01, 0.24, 0.25, 0.26, 3.99]) {
      const s = snapForward(b, 0.25, 0.5);
      expect(s.beat).toBeGreaterThanOrEqual(b - 1e-9);
      expect(s.beat - b).toBeLessThan(0.25 + 1e-9);
    }
    expect(snapForward(0.25, 0.25).index).toBe(1);
  });
  it('swing delays off-beats only', () => {
    expect(snapForward(0.1, 0.25, 0.66).beat).toBeCloseTo(0.25 + 0.32 * 0.25);
    expect(snapForward(0.3, 0.25, 0.66).beat).toBeCloseTo(0.5);
    expect(snapForward(0.1, 0.25, 0.66, false).beat).toBeCloseTo(0.25);
  });
});

describe('note mapping', () => {
  it('color selects the pitch pool', () => {
    expect(poolFor(0.1, ctx)).toEqual(ctx.chordTones);
    expect(poolFor(0.5, ctx).length).toBeGreaterThanOrEqual(ctx.chordTones.length);
    const full = poolFor(0.9, ctx);
    expect(full).toHaveLength(7);
    expect(full[0]).toBe(ctx.chord.rootPc);
  });

  it('slots map into range and stay in the pool', () => {
    const s = { ...DEFAULT_NOTES, low: 50, high: 74, transpose: 0 };
    for (let slot = 0; slot < 20; slot++) {
      const n = slotToNote(slot, 0.1, s, ctx);
      expect(n).toBeGreaterThanOrEqual(50);
      expect(n).toBeLessThanOrEqual(74);
      expect(ctx.chordTones).toContain(mod12(n));
    }
  });

  it('transposition is diatonic', () => {
    expect(stepScale(62, 2, ctx.scalePcs)).toBe(65); // D → F
    expect(stepScale(62, -1, ctx.scalePcs)).toBe(60); // D → C
    expect(stepScale(69, 1, ctx.scalePcs)).toBe(70); // A → B♭
  });

  it('fold keeps notes within narrow ranges', () => {
    expect(foldRange(90, 50, 74)).toBeLessThanOrEqual(74);
    expect(foldRange(30, 50, 74)).toBeGreaterThanOrEqual(50);
    expect(foldRange(80, 60, 65)).toBe(65);
  });

  it('mono picks one note, chord stacks scale steps', () => {
    const rng = new Rng(1);
    const mono = hitToNotes(0, 0.8, 0.1, { ...DEFAULT_NOTES, voice: 'mono' }, { low: 40, high: 100 }, ctx, rng);
    expect(mono).toHaveLength(1);
    const chord = hitToNotes(0, 0.8, 0.1, { ...DEFAULT_NOTES, voice: 'chord', steps: [1, 3, 5] }, { low: 40, high: 100 }, ctx, rng);
    expect(chord).toHaveLength(3);
    for (const n of chord) expect(ctx.scalePcs).toContain(mod12(n.note));
    const root = hitToNotes(0, 0.8, 0.1, { ...DEFAULT_NOTES, voice: 'root' }, { low: 40, high: 100 }, ctx, rng);
    expect(root).toHaveLength(1);
  });

  it('velocity follows strength', () => {
    const rng = new Rng(1);
    const s = { ...DEFAULT_NOTES, steps: [1] };
    const soft = hitToNotes(0, 0, 0.1, s, { low: 40, high: 100 }, ctx, rng)[0];
    const hard = hitToNotes(0, 1, 0.1, s, { low: 40, high: 100 }, ctx, rng)[0];
    expect(soft.velocity).toBe(40);
    expect(hard.velocity).toBe(100);
  });

  it('drum tracks ignore harmony, accent strong hits', () => {
    const rng = new Rng(1);
    const s = { ...DEFAULT_NOTES, kind: 'drum' as const, drumNote: 48, drumSpread: 0, accent: 0.7 };
    const a = hitToNotes(3, 0.9, 0.5, s, { low: 40, high: 120 }, ctx, rng)[0];
    const g = hitToNotes(1, 0.3, 0.5, s, { low: 40, high: 120 }, ctx, rng)[0];
    expect(a.note).toBe(48);
    expect(g.note).toBe(48);
    expect(a.velocity).toBe(120);
    expect(g.velocity).toBeLessThan(80);
    const spread = { ...s, drumSpread: 6 };
    const notes = new Set([0, 1, 2, 3, 4].map((k) => hitToNotes(k, 0.5, 1, spread, { low: 40, high: 120 }, ctx, rng)[0].note));
    expect(notes.size).toBeGreaterThan(1);
    for (const n of notes) expect(Math.abs(n - 48)).toBeLessThanOrEqual(6);
  });
});
