import { describe, expect, it } from 'vitest';
import { makeGrid } from '../src/engine/engine';
import { Rng } from '../src/rng';
import { MODE_IDS, MODE_PARAMS, createVoice, type Grid, type Hit, type Macros, type ModeId, type Voice } from '../src/voices';
import { type Drop, DropsVoice } from '../src/voices/drops';
import { OrbitsVoice } from '../src/voices/orbits';
import { Pen, project } from '../src/voices/pen';
import { PendulumVoice } from '../src/voices/pendulum';
import { type Rock, RockfallVoice } from '../src/voices/rockfall';
import { arcAt, PALETTE } from '../src/voices/types';
import { WavesVoice } from '../src/voices/waves';
import { type Leaf, WindVoice } from '../src/voices/wind';

const M: Macros = { intensity: 0.6, color: 0.5, rotation: 0.3, randomness: 0.3 };
const BEAT = 60 / 112;
const H = 0.14;
const DT = 1 / 240;

const gridFor = (stepBeats = 0.25, swing = 0.5): Grid =>
  makeGrid(
    (t) => t / BEAT,
    (b) => b * BEAT,
    BEAT,
    stepBeats,
    swing,
  );

interface Emitted extends Hit {
  at: number;
}

function simulate(
  mode: ModeId,
  seconds: number,
  opts: { macros?: Macros; seed?: number; grid?: Grid; onStep?: (v: Voice, hits: Hit[], t: number) => void } = {},
): { hits: Emitted[]; voice: Voice } {
  const v = createVoice(mode, new Rng(opts.seed ?? 1));
  const grid = opts.grid ?? gridFor();
  const hits: Emitted[] = [];
  for (let t = DT; t <= seconds; t += DT) {
    const hs = v.step({ dt: DT, t, beatSec: BEAT, macros: opts.macros ?? M, grid, horizon: H });
    opts.onStep?.(v, hs, t);
    for (const h of hs) hits.push({ ...h, at: t });
  }
  return { hits, voice: v };
}

function fakeCtx(): { g: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const g = new Proxy(
    { globalAlpha: 1 },
    {
      get: (target, k) => (k in target ? (target as Record<string | symbol, unknown>)[k] : (..._a: unknown[]) => calls.push(String(k))),
      set: (target, k, v) => {
        (target as Record<string | symbol, unknown>)[k] = v;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { g, calls };
}

describe('iso projection', () => {
  it('is 2:1 isometric with z up', () => {
    expect(project(1, 0, 0)).toEqual([48, 24]);
    expect(project(0, 1, 0)).toEqual([-48, 24]);
    expect(project(0, 0, 1)).toEqual([0, -48]);
  });
});

describe('grid', () => {
  it('maps integer steps to swung times and back', () => {
    const g = gridFor(0.25, 0.66);
    for (let k = 0; k < 20; k++) expect(g.stepAt(g.timeOfStep(k))).toBeCloseTo(k, 9);
    expect(g.timeOfStep(1) - g.timeOfStep(0)).toBeCloseTo(0.25 * BEAT * 1.32, 9);
    expect(g.timeOfStep(2) - g.timeOfStep(1)).toBeCloseTo(0.25 * BEAT * 0.68, 9);
  });
});

describe('voices are rhythm-locked', () => {
  for (const mode of MODE_IDS) {
    for (const swing of [0.5, 0.66]) {
      it(`${mode} (swing ${swing}): every hit is exactly on a grid step and reported ahead`, () => {
        const grid = gridFor(mode === 'waves' || mode === 'orbits' ? 0.5 : 0.25, swing);
        const { hits, voice } = simulate(mode, 30, { grid });
        expect(hits.length).toBeGreaterThan(3);
        for (const h of hits) {
          expect(Number.isInteger(h.step)).toBe(true);
          expect(h.t).toBe(grid.timeOfStep(h.step));
          expect(h.t - h.at).toBeGreaterThanOrEqual(H - 1e-9);
          expect(h.slot).toBeGreaterThanOrEqual(0);
          expect(h.slot).toBeLessThan(voice.slots());
          expect(h.strength).toBeGreaterThanOrEqual(0);
          expect(h.strength).toBeLessThanOrEqual(1);
        }
      });
    }

    it(`${mode}: deterministic for a seed`, () => {
      expect(simulate(mode, 10).hits).toEqual(simulate(mode, 10).hits);
    });

    it(`${mode}: intensity raises activity`, () => {
      const lo = simulate(mode, 40, { macros: { ...M, intensity: 0.05 } }).hits.length;
      const hi = simulate(mode, 40, { macros: { ...M, intensity: 0.95 } }).hits.length;
      expect(hi).toBeGreaterThanOrEqual(lo);
    });

    it(`${mode}: param specs have in-range defaults`, () => {
      for (const p of MODE_PARAMS[mode]) {
        expect(p.def).toBeGreaterThanOrEqual(p.min);
        expect(p.def).toBeLessThanOrEqual(p.max);
      }
    });

    it(`${mode}: draws through the iso pen, flashes only once the note time has come`, () => {
      const { voice, hits } = simulate(mode, 6);
      const { g, calls } = fakeCtx();
      voice.draw(new Pen(g, PALETTE, 1));
      expect(calls.length).toBeGreaterThan(5);
      for (const h of hits.filter((x) => x.t > voice.time)) expect(voice.flashes.get(h.slot) ?? -1).toBeLessThanOrEqual(voice.time);
    });

    it(`${mode}: reset clears everything in flight`, () => {
      const { voice } = simulate(mode, 5);
      voice.reset();
      expect(voice.flashes.size).toBe(0);
    });
  }
});

describe('visual collisions coincide with the notes', () => {
  it('drops land on their stone exactly at the note time', () => {
    const seen = new Set<Drop>();
    const { hits, voice } = simulate('drops', 20, { onStep: (v) => (v as DropsVoice).drops.forEach((d) => seen.add(d)) });
    const v = voice as DropsVoice;
    const mains = [...seen].filter((d) => d.main);
    expect(mains.length).toBeGreaterThan(5);
    for (const d of seen) {
      const st = v.stones[d.slot];
      const p = arcAt(d.arc, d.arc.t1);
      expect(p[2]).toBeCloseTo(st.z, 9);
      expect(Math.abs(p[0] - st.x)).toBeLessThan(0.17);
      expect(Math.abs(p[1] - st.y)).toBeLessThan(0.17);
      expect(hits.some((h) => h.t === d.arc.t1 && h.slot === d.slot)).toBe(true);
    }
    // main drops fall straight down from their spout
    for (const d of mains) {
      expect(d.arc.x0).toBe(d.arc.x1);
      expect(d.arc.vz0).toBeCloseTo(0, 9);
    }
  });

  it('rocks bounce on stair tops exactly on the beat, with shrinking intervals', () => {
    const seen = new Set<Rock>();
    const { hits, voice } = simulate('rockfall', 40, { onStep: (v) => (v as RockfallVoice).rocks.forEach((r) => seen.add(r)) });
    const v = voice as RockfallVoice;
    expect(seen.size).toBeGreaterThan(1);
    for (const r of seen) {
      const landing = r.arcs.slice(0, -1);
      landing.forEach((a, j) => {
        expect(arcAt(a, a.t1)[2]).toBeCloseTo(v.stairZ(r.terraces[j]), 9);
        expect(hits.some((h) => h.t === a.t1)).toBe(true);
      });
      const gaps = landing.slice(1).map((a, j) => a.t1 - landing[j].t1);
      for (let j = 1; j < gaps.length; j++) expect(gaps[j]).toBeLessThanOrEqual(gaps[j - 1] + 1e-9);
      // consecutive hops are continuous
      r.arcs.slice(1).forEach((a, j) => {
        const end = arcAt(r.arcs[j], r.arcs[j].t1);
        const start = arcAt(a, a.t0);
        end.forEach((c, q) => expect(start[q]).toBeCloseTo(c, 9));
      });
    }
  });

  it('leaves are at a chime, inside its body, on every strike; runs are stepwise', () => {
    const leaves = new Set<Leaf>();
    const { hits, voice } = simulate('wind', 30, { onStep: (v) => (v as WindVoice).leaves.forEach((l) => leaves.add(l)) });
    const v = voice as WindVoice;
    expect(hits.length).toBeGreaterThan(5);
    for (const h of hits) {
      const l = [...leaves].find((x) => Math.abs(v.leafX(x, h.step) - v.chimeX(h.slot)) < 1e-9);
      expect(l).toBeDefined();
      const z = v.leafZ(l!, h.step);
      expect(z).toBeGreaterThanOrEqual(v.chimeBottom(h.slot) - 0.05);
      expect(z).toBeLessThanOrEqual(v.chimeBottom(h.slot) + 0.47);
    }
  });

  it('pendulums pass the gate (angle 0) exactly on each note', () => {
    const checks: number[] = [];
    simulate('pendulum', 30, {
      onStep: (v, hs) => {
        const p = v as PendulumVoice;
        const n = p.slots();
        for (const h of hs) {
          const i = h.slot; // rotation < .5 → slot = pendulum index
          checks.push(Math.abs(p.angle(i, h.step)));
          expect(Math.abs(p.angle(i, h.step + 0.5))).toBeGreaterThan(0.05);
          expect(i).toBeLessThan(n);
        }
      },
    });
    expect(checks.length).toBeGreaterThan(10);
    for (const c of checks) expect(c).toBeLessThan(1e-9);
  });

  it('orbiting bodies sit on their ray exactly on each note', () => {
    let n = 0;
    simulate('orbits', 30, {
      grid: gridFor(0.5),
      onStep: (v, hs) => {
        const o = v as OrbitsVoice;
        const R = o.rays();
        for (const h of hs) {
          const j = Math.floor(h.slot / R);
          const k = h.slot % R;
          const diff = (((o.bodyAngle(j, h.step) - o.rayAngle(k)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          expect(Math.min(diff, 2 * Math.PI - diff)).toBeLessThan(1e-9);
          n++;
        }
      },
    });
    expect(n).toBeGreaterThan(5);
  });

  it('buoys trigger on a crest', () => {
    let n = 0;
    simulate('waves', 30, {
      grid: gridFor(0.5),
      onStep: (v, hs) => {
        const w = v as WavesVoice;
        for (const h of hs) {
          const x = w.buoyX(h.slot);
          expect(w.carrier(x, h.step)).toBeCloseTo(1, 9);
          expect(w.swell(x, h.step)).toBeGreaterThan(0);
          n++;
        }
      },
    });
    expect(n).toBeGreaterThan(3);
  });
});

describe('characters stay distinct', () => {
  it('waves hold long notes; rockfall comes in bursts; wind plays stepwise runs', () => {
    const waves = simulate('waves', 40, { grid: gridFor(0.5) }).hits;
    expect(waves.every((h) => (h.length ?? 0) > 0.1)).toBe(true);
    const rocks = simulate('rockfall', 60).hits.map((h) => h.t).sort((a, b) => a - b);
    const gaps = rocks.slice(1).map((t, i) => t - rocks[i]);
    expect(gaps.filter((g) => g < 0.4).length).toBeGreaterThan(3);
    expect(Math.max(...gaps)).toBeGreaterThan(0.8);
    const wind = simulate('wind', 30, { macros: { ...M, rotation: 0.1 } }).hits.sort((a, b) => a.t - b.t);
    const steps = wind.slice(1).filter((h, i) => Math.abs(h.slot - wind[i].slot) === 1).length;
    expect(steps).toBeGreaterThan(wind.length * 0.3);
  });

  it('pendulums drift out of phase (different periods per pendulum)', () => {
    const p = createVoice('pendulum', new Rng(1)) as PendulumVoice;
    expect(new Set([0, 1, 2, 3].map((i) => p.halfPeriod(i, 0.5))).size).toBe(4);
  });

  it('nudges are accepted by every voice', () => {
    for (const mode of MODE_IDS) expect(() => createVoice(mode, new Rng(4)).nudge(1)).not.toThrow();
  });
});
