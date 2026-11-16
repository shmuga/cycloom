import { describe, expect, it } from 'vitest';
import { HarmonyEngine } from '../src/harmony/engine';
import { scaleEquals, scalePcs, signature } from '../src/music/theory';

const run = (e: HarmonyEngine, bars: number) => {
  const names: string[] = [];
  for (let i = 0; i < bars; i++) {
    e.advanceBar();
    names.push(`${e.chord.name}/${e.scale.root}${e.scale.mode}`);
  }
  return names;
};

describe('harmony engine', () => {
  it('starts on the tonic of the base key', () => {
    const e = new HarmonyEngine();
    expect(e.chord.name).toBe('Dm9');
    expect(e.scale).toEqual({ root: 2, mode: 'aeolian' });
    expect(e.upcoming(3)).toHaveLength(3);
  });

  it('is deterministic for a seed', () => {
    expect(run(new HarmonyEngine({ seed: 9 }), 200)).toEqual(run(new HarmonyEngine({ seed: 9 }), 200));
    expect(run(new HarmonyEngine({ seed: 9 }), 200)).not.toEqual(run(new HarmonyEngine({ seed: 10 }), 200));
  });

  it('keeps every chord inside the current scale', () => {
    const e = new HarmonyEngine({ seed: 3, driftBars: 4 });
    for (let i = 0; i < 500; i++) {
      e.advanceBar();
      const pcs = scalePcs(e.scale);
      expect(e.context().chordTones.every((p) => pcs.includes(p))).toBe(true);
    }
  });

  it('changes chords at the configured rate', () => {
    const e = new HarmonyEngine({ seed: 5, barsPerChord: 2, depth: 0 });
    const hist0 = e.history.length;
    run(e, 16);
    expect(e.history.length - hist0).toBe(8);
  });

  it('drifts by fifths to neighbouring keys only', () => {
    const e = new HarmonyEngine({ seed: 11, driftBars: 4, relation: 'fifths', homePull: 0 });
    let prev = e.scale;
    let changes = 0;
    for (let i = 0; i < 400; i++) {
      e.advanceBar();
      if (!scaleEquals(prev, e.scale)) {
        changes++;
        let d = Math.abs(signature(prev) - signature(e.scale));
        d = Math.min(d, 12 - d);
        expect(d).toBe(1);
        expect(e.scale.mode).toBe(prev.mode);
        prev = e.scale;
      }
    }
    expect(changes).toBeGreaterThan(5);
  });

  it('brightness drift keeps the root and moves one mode', () => {
    const e = new HarmonyEngine({ seed: 2, driftBars: 4, relation: 'brightness', homePull: 0 });
    let prev = e.scale;
    for (let i = 0; i < 300; i++) {
      e.advanceBar();
      if (!scaleEquals(prev, e.scale)) {
        expect(e.scale.root).toBe(prev.root);
        prev = e.scale;
      }
    }
  });

  it('home pull keeps long runs near the base key', () => {
    const far = (pull: number) => {
      const e = new HarmonyEngine({ seed: 4, driftBars: 2, relation: 'fifths', homePull: pull });
      let max = 0;
      for (let i = 0; i < 1000; i++) {
        e.advanceBar();
        let d = Math.abs(signature(e.scale) - signature({ root: 2, mode: 'aeolian' }));
        d = Math.min(d, 12 - d);
        max = Math.max(max, d);
      }
      return max;
    };
    expect(far(0.95)).toBeLessThanOrEqual(far(0));
    expect(far(0.95)).toBeLessThanOrEqual(2);
  });

  it('hold chord freezes chord changes, hold scale freezes drift', () => {
    const e = new HarmonyEngine({ seed: 1, holdChord: true, holdScale: true, driftBars: 2 });
    const name = e.chord.name;
    run(e, 50);
    expect(e.chord.name).toBe(name);
    expect(e.scale).toEqual({ root: 2, mode: 'aeolian' });
  });

  it('rewinds to a history entry at the next bar and branches', () => {
    const e = new HarmonyEngine({ seed: 8 });
    run(e, 20);
    const target = e.history[2];
    const originalAfter = e.history.slice(3).map((h) => h.chordName);
    e.requestRewind(2);
    expect(e.rewindPending).toBe(true);
    e.advanceBar();
    expect(e.rewindPending).toBe(false);
    expect(e.chord.name).toBe(target.chordName);
    expect(e.scale).toEqual(target.scale);
    expect(e.history.length).toBe(4);
    const branch = run(e, 20);
    expect(branch.length).toBe(20);
    expect(e.history.map((h) => h.chordName).slice(4, 4 + originalAfter.length)).not.toEqual(originalAfter);
  });

  it('serialises and restores exactly', () => {
    const a = new HarmonyEngine({ seed: 21 });
    run(a, 30);
    const data = a.serialize();
    const b = new HarmonyEngine({ seed: 999 });
    b.restore(data);
    expect(run(b, 40)).toEqual(run(a, 40));
  });

  it('exposes tensions that are scale tones outside the chord', () => {
    const e = new HarmonyEngine();
    const ctx = e.context();
    for (const t of ctx.tensions) {
      expect(ctx.scalePcs).toContain(t);
      expect(ctx.chordTones).not.toContain(t);
    }
  });
});
