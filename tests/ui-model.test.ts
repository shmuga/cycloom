import { describe, expect, it } from 'vitest';
import { HarmonyEngine } from '../src/harmony/engine';
import { hitPlinth, iso, layoutIsland } from '../src/scene/iso';
import { type KV, Persist, exportJSON, importJSON, migrate } from '../src/state/persist';
import { defaultState } from '../src/state/types';
import { bandView } from '../src/ui/band';

const memKV = (): KV => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe('island layout (E1 mock geometry)', () => {
  it('places six plinths exactly like the mock', () => {
    const l = layoutIsland(6);
    expect(l.w).toBe(10);
    expect(l.d).toBe(7);
    // mock: translate(600,170) for 01 relative to island origin (600,170) → (0,0)
    const rel = l.plinths.map((p) => p.top.map(Math.round));
    expect(rel).toEqual([
      [0, 0],
      [144, 43],
      [288, 163],
      [-144, 58],
      [0, 154],
      [144, 168],
    ]);
    expect(l.order[l.order.length - 1]).toBe(5);
  });
  it('grows a row per three tracks', () => {
    expect(layoutIsland(7).d).toBe(10);
    expect(layoutIsland(16).plinths).toHaveLength(16);
  });
  it('hit-tests plinths', () => {
    const l = layoutIsland(6);
    for (const p of l.plinths) expect(hitPlinth(l, [p.top[0], p.top[1] + 48])).toBe(p.track);
    expect(hitPlinth(l, iso(0, 7))).toBe(-1);
  });
});

describe('harmony band view', () => {
  it('shows current, next and two upcoming chords with roman numerals', () => {
    const v = bandView(new HarmonyEngine());
    expect(v.chords).toHaveLength(4);
    expect(v.chords[0].name).toBe('Dm9');
    expect(v.subs[0]).toBe('i');
    expect(v.subs[1]).toMatch(/· next$/);
    expect(v.driftText?.relation).toBe('fifths');
  });
  it('lists up to five history entries, last two marked recent', () => {
    const hm = new HarmonyEngine({ seed: 3 });
    for (let i = 0; i < 40; i++) hm.advanceBar();
    const v = bandView(hm);
    expect(v.history.length).toBe(5);
    expect(v.history.filter((h) => h.recent)).toHaveLength(2);
    expect(v.history.at(-1)!.index).toBe(hm.history.length - 2);
  });
});

describe('persistence', () => {
  it('saves and loads state, scenes, snaps and mappings', () => {
    const p = new Persist(memKV());
    const s = defaultState();
    s.bpm = 99;
    p.saveState(s);
    expect(p.loadState()?.bpm).toBe(99);
    p.saveScene('dawn', { state: s, engine: { harmony: new HarmonyEngine().serialize(), journey: { weatherValue: 0, tracks: [], rng: 1 } }, at: 1 });
    expect(Object.keys(p.scenes())).toEqual(['dawn']);
    p.deleteScene('dawn');
    expect(p.scenes()).toEqual({});
    expect(p.snaps()).toHaveLength(8);
    p.setMappings([]);
    expect(p.mappings()).toEqual([]);
  });
  it('migrates older saves by filling defaults', () => {
    const old = { bpm: 80, tracks: [{ mode: 'waves', macros: { intensity: 0.1 } }] };
    const m = migrate(old)!;
    expect(m.bpm).toBe(80);
    expect(m.tracks[0].macros.intensity).toBe(0.1);
    expect(m.tracks[0].macros.color).toBeDefined();
    expect(m.journey.voices).toBe(4);
    expect(migrate({})).toBe(null);
  });
  it('round-trips JSON export/import', () => {
    const s = defaultState();
    s.harmony.seed = 1234;
    const back = importJSON(exportJSON(s, []))!;
    expect(back.state.harmony.seed).toBe(1234);
    expect(importJSON('not json')).toBe(null);
  });
});
