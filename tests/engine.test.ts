import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';
import { Journey } from '../src/journey/journey';
import { Recorder } from '../src/midi/capture';
import { type NoteEvent, OutputRouter } from '../src/midi/router';
import { PARAMS, fromNorm, paramDef, toNorm } from '../src/state/params';
import { Store } from '../src/state/store';
import { defaultState, paceFactor } from '../src/state/types';

function setup(mut?: (s: ReturnType<typeof defaultState>) => void) {
  const s = defaultState();
  mut?.(s);
  const store = new Store(s);
  const router = new OutputRouter();
  const notes: NoteEvent[] = [];
  router.sinks.push({ noteOn: (e) => notes.push(e) });
  const sent: number[][] = [];
  router.out = { send: (d) => sent.push(d) };
  const rec = new Recorder();
  router.sinks.push(rec);
  const engine = new Engine(store, router, rec);
  store.subscribe(() => engine.sync());
  return { store, router, engine, notes, sent, rec };
}

function runFor(engine: Engine, seconds: number, from = 0) {
  for (let t = from; t <= from + seconds; t += 0.025) engine.tick(t);
}

describe('engine', () => {
  it('plays notes on every default track and sends clock', () => {
    const { engine, notes, sent } = setup((s) => {
      s.journey.voices = 6;
      s.journey.rest = 0;
      s.journey.notesPerBar = 48;
    });
    engine.start(0);
    runFor(engine, 40);
    const tracks = new Set(notes.map((n) => n.track));
    expect(tracks.size).toBeGreaterThanOrEqual(5);
    expect(sent.filter((d) => d[0] === 0xf8).length).toBeGreaterThan(24 * 40);
    expect(sent[0]).toEqual([0xfa]);
  });

  it('places every note on its track grid (with swing)', () => {
    const { engine, notes, store } = setup((s) => {
      s.journey.voices = 6;
      s.journey.rest = 0;
    });
    engine.start(0);
    runFor(engine, 20);
    const beatSec = 60 / store.state.bpm;
    for (const n of notes) {
      const tr = store.state.tracks[n.track];
      const step = { '1/16': 0.25, '1/4': 1, '1/8': 0.5, '1/16T': 1 / 6, '1/4.': 1.5 }[tr.midi.division as string]!;
      const idx = Math.round(n.beat / step);
      const swingOff = tr.midi.swing && idx % 2 === 1 ? (2 * store.state.swing - 1) * step : 0;
      expect(Math.abs(n.beat - (idx * step + swingOff))).toBeLessThan(1e-6);
      expect(n.time - engine.startTime).toBeCloseTo(n.beat * beatSec, 6);
    }
  });

  it('every note sounds exactly when its visual collision happens', () => {
    const { engine, notes } = setup((s) => {
      s.journey.voices = 6;
      s.journey.rest = 0;
      s.journey.notesPerBar = 48;
      s.swing = 0.62;
    });
    const planned: Map<number, number>[] = engine.voices.map(() => new Map());
    engine.voices.forEach((v, i) => {
      const orig = v.step.bind(v);
      v.step = (env) => {
        const hs = orig(env);
        for (const h of hs) planned[i].set(h.step, h.t);
        return hs;
      };
    });
    engine.start(0);
    runFor(engine, 25);
    expect(notes.length).toBeGreaterThan(30);
    for (const n of notes) {
      const times = [...planned[n.track].values()];
      const hit = times.some((t) => Math.abs(engine.startTime + t - n.time) < 1e-9);
      expect(hit).toBe(true);
    }
  });

  it('flashes appear at the note time, not before', () => {
    const { engine, notes } = setup((s) => s.tracks.forEach((t, i) => (t.solo = i === 0)));
    engine.start(0);
    let now = 0;
    const early: number[] = [];
    for (now = 0; now < 15; now += 0.025) {
      engine.tick(now);
      const v = engine.voices[0];
      for (const t of v.flashes.values()) if (t > v.time + 1e-9) early.push(t - v.time);
    }
    expect(notes.length).toBeGreaterThan(0);
    expect(early).toEqual([]);
  });

  it('frames are drawn at their exact time between ticks', () => {
    const { engine } = setup();
    engine.start(0);
    runFor(engine, 3);
    const v = engine.voices[3];
    engine.prepareView(engine.startTime + engine.simTime + 0.012);
    expect(v.time).toBeCloseTo(engine.simTime + 0.012, 9);
    expect(v.u).toBeCloseTo(engine.grid(3).stepAt(engine.simTime + 0.012), 9);
  });

  it('never schedules a note in the past', () => {
    const { engine, router, notes } = setup();
    engine.start(0);
    let now = 0;
    const late: number[] = [];
    router.sinks.push({ noteOn: (e) => e.time < now - 1e-6 && late.push(e.time - now) });
    for (now = 0; now < 15; now += 0.025) engine.tick(now);
    expect(notes.length).toBeGreaterThan(0);
    expect(late).toEqual([]);
  });

  it('one note per step per mono track', () => {
    const { engine, notes } = setup((s) => s.tracks.forEach((t) => (t.notes.voice = 'mono')));
    engine.start(0);
    runFor(engine, 20);
    const seen = new Set<string>();
    for (const n of notes) {
      const k = `${n.track}:${n.beat.toFixed(6)}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('mute and solo silence tracks', () => {
    const { engine, notes, store } = setup((s) => (s.journey.voices = 6));
    store.update((s) => {
      s.tracks[0].mute = true;
      s.tracks[3].solo = true;
    });
    engine.start(0);
    runFor(engine, 20);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.track === 3)).toBe(true);
  });

  it('density cap limits notes per bar', () => {
    const { engine, notes } = setup((s) => {
      s.journey.notesPerBar = 3;
      s.journey.voices = 6;
    });
    engine.start(0);
    runFor(engine, 30);
    const perBar = new Map<number, number>();
    for (const n of notes) perBar.set(Math.floor(n.beat / 4), (perBar.get(Math.floor(n.beat / 4)) ?? 0) + 1);
    for (const c of perBar.values()) expect(c).toBeLessThanOrEqual(3 + 2); // chord tracks emit up to 3 notes as one event
  });

  it('chord mode emits simultaneous notes', () => {
    const { engine, notes } = setup((s) => {
      s.tracks.forEach((t, i) => (t.solo = i === 5));
      s.tracks[5].macros.intensity = 0.9;
    });
    engine.start(0);
    runFor(engine, 30);
    const byTime = new Map<number, number>();
    for (const n of notes) byTime.set(n.time, (byTime.get(n.time) ?? 0) + 1);
    expect(Math.max(...byTime.values())).toBeGreaterThan(1);
  });

  it('drum tracks stay near their base note', () => {
    const { engine, notes, store } = setup((s) => s.tracks.forEach((t, i) => (t.solo = i === 2)));
    engine.start(0);
    runFor(engine, 30);
    const base = store.state.tracks[2].notes.drumNote;
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(Math.abs(n.note - base)).toBeLessThanOrEqual(store.state.tracks[2].notes.drumSpread);
  });

  it('tonal notes belong to the harmony scale at the time they play', () => {
    const { engine, notes } = setup((s) => s.tracks.forEach((t, i) => (t.solo = i === 3)));
    const scales: Set<number>[] = [];
    engine.onBar = () => scales.push(new Set(engine.harmony.context().scalePcs));
    engine.start(0);
    runFor(engine, 30);
    expect(notes.length).toBeGreaterThan(5);
    let ok = 0;
    for (const n of notes) {
      const bar = Math.floor(n.beat / 4);
      const sc = scales[Math.min(bar, scales.length - 1)];
      if (sc?.has(n.note % 12)) ok++;
    }
    expect(ok / notes.length).toBeGreaterThan(0.9);
  });

  it('tempo changes keep time continuous', () => {
    const { engine, store } = setup();
    engine.start(0);
    runFor(engine, 5);
    const before = engine.beatAt(engine.simTime);
    store.update((s) => (s.bpm = 140));
    expect(engine.beatAt(engine.simTime)).toBeCloseTo(before, 6);
    expect(engine.beatSec).toBeCloseTo(60 / 140);
  });

  it('stop panics and sends MIDI stop', () => {
    const { engine, sent } = setup();
    engine.start(0);
    runFor(engine, 2);
    engine.stop(2.1);
    expect(engine.playing).toBe(false);
    expect(sent.some((d) => d[0] === 0xfc)).toBe(true);
    expect(sent.some((d) => d[0] === 0xb0 && d[1] === 123)).toBe(true);
  });

  it('listen nudges the listening track', () => {
    const withListen = setup((s) => {
      s.tracks.forEach((t, i) => (t.solo = i === 1));
      s.tracks[1].listen = { source: 0, amount: 1 };
      s.tracks[1].macros.intensity = 0.05;
    });
    const without = setup((s) => {
      s.tracks.forEach((t, i) => (t.solo = i === 1));
      s.tracks[1].macros.intensity = 0.05;
    });
    withListen.engine.start(0);
    without.engine.start(0);
    runFor(withListen.engine, 30);
    runFor(without.engine, 30);
    expect(withListen.notes.length).toBeGreaterThanOrEqual(without.notes.length);
  });

  it('records a capture with harmony markers', () => {
    const { engine, rec } = setup();
    engine.start(0);
    rec.start(0, 112);
    runFor(engine, 10);
    expect(rec.notes.length).toBeGreaterThan(0);
    expect(rec.markers.length).toBeGreaterThan(0);
  });

  it('snapshots restore harmony at the next bar', () => {
    const { engine } = setup();
    engine.start(0);
    runFor(engine, 4);
    const snap = engine.snapshot();
    const chord = engine.harmony.chord.name;
    runFor(engine, 30, 4.025);
    engine.restore(snap);
    runFor(engine, 3, 34.05);
    expect(engine.harmony.history.at(-1)!.chordName === chord || engine.harmony.chord.name === chord).toBe(true);
  });

  it('idles visuals while stopped without sending notes', () => {
    const { engine, notes } = setup();
    runFor(engine, 3);
    expect(notes).toHaveLength(0);
    expect(engine.voices.some((v) => v.time > 0)).toBe(true);
  });

  it('adding/removing tracks keeps voices aligned', () => {
    const { engine, store } = setup();
    store.update((s) => s.tracks.splice(1, 1));
    expect(engine.voices).toHaveLength(5);
    expect(engine.voices[1].mode).toBe('rockfall');
    store.update((s) => (s.tracks[0].mode = 'orbits'));
    expect(engine.voices[0].mode).toBe('orbits');
  });
});

describe('journey', () => {
  it('voice budget limits simultaneously playing tracks', () => {
    const s = defaultState();
    s.journey.voices = 2;
    const j = new Journey(1);
    for (let bar = 0; bar < 64; bar++) {
      j.onBar(bar, s);
      const playing = s.tracks.filter((_t, i) => !j.isResting(i)).length;
      expect(playing).toBeLessThanOrEqual(2);
    }
  });

  it('breathing and weather keep macros in range', () => {
    const s = defaultState();
    s.journey.breathe = 1;
    s.journey.weather = 1;
    const j = new Journey(2);
    for (let bar = 0; bar < 200; bar++) {
      j.onBar(bar, s);
      for (let i = 0; i < s.tracks.length; i++) {
        const m = j.macros(i, s, bar + 0.5, { rotation: 0.5, weather: 0.5 }, i);
        for (const v of Object.values(m)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(j.weatherLabel()).toMatch(/(calm|mild|stormy), (rising|easing|steady)/);
  });

  it('never lets every unmuted track rest at once', () => {
    const s = defaultState();
    s.journey.rest = 1;
    s.tracks.forEach((t) => (t.life.rest = 1));
    s.journey.voices = 4;
    const j = new Journey(5);
    for (let bar = 0; bar < 400; bar++) {
      j.onBar(bar, s);
      const awake = s.tracks.filter((_t, i) => !j.isResting(i)).length;
      expect(awake).toBeGreaterThanOrEqual(2);
      expect(awake).toBeLessThanOrEqual(4);
    }
  });

  it('rest = 0 means tracks never rest unless over budget', () => {
    const s = defaultState();
    s.journey.rest = 0;
    s.journey.voices = 6;
    const j = new Journey(3);
    for (let bar = 0; bar < 100; bar++) {
      j.onBar(bar, s);
      expect(s.tracks.every((_t, i) => !j.isResting(i))).toBe(true);
    }
  });
});

describe('state & params', () => {
  it('pace fader maps to ×0.25…×8 and the mock value shows ×2', () => {
    expect(paceFactor(0)).toBeCloseTo(0.25);
    expect(paceFactor(1)).toBeCloseTo(8);
    expect(PARAMS['journey.pace'].fmt(0.6)).toBe('×2');
  });

  it('norm conversion round-trips and quantises', () => {
    const d = PARAMS['life.breathe'];
    expect(fromNorm(d, toNorm(d, 32))).toBe(32);
    expect(fromNorm(d, 0.5)).toBe(68); // 1-bar steps so loops can be co-prime (23, 29, 31…)
    expect(fromNorm(PARAMS['journey.voices'], 0.49)).toBe(3);
    expect(PARAMS['macros.intensity'].fmt(0.62)).toBe('.62');
  });

  it('mode params resolve against the track mode', () => {
    const s = defaultState();
    expect(paramDef('mode.paddles', s, 0)?.get(s, 0)).toBe(4);
    expect(paramDef('mode.paddles', s, 1)).toBe(null);
    expect(paramDef('journey.voices', s)?.max).toBe(6);
  });

  it('store undo coalesces fader drags', () => {
    const store = new Store(defaultState());
    let t = 0;
    store.now = () => t;
    for (let i = 0; i < 10; i++) {
      t += 50;
      store.update((s) => (s.tracks[0].macros.intensity = i / 10), { coalesce: 'fader' });
    }
    store.update((s) => (s.bpm = 90));
    expect(store.state.bpm).toBe(90);
    store.undo();
    expect(store.state.bpm).toBe(112);
    expect(store.state.tracks[0].macros.intensity).toBeCloseTo(0.9);
    store.undo();
    expect(store.state.tracks[0].macros.intensity).toBeCloseTo(0.62);
    expect(store.undo()).toBe(false);
  });
});
