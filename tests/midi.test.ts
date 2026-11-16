import { describe, expect, it } from 'vitest';
import { Recorder, PPQ, vlq, writeSMF } from '../src/midi/capture';
import { ClockFollower } from '../src/midi/clock';
import { MidiMap, type MapHost, type Target, targetKey } from '../src/midi/midimap';
import { type NoteEvent, OutputRouter } from '../src/midi/router';

class FakeOut {
  sent: { data: number[]; ts?: number }[] = [];
  cleared = 0;
  send(data: number[], ts?: number) {
    this.sent.push({ data, ts });
  }
  clear() {
    this.cleared++;
  }
}

const ev = (p: Partial<NoteEvent>): NoteEvent => ({ time: 1, beat: 0, ch: 1, note: 60, vel: 100, dur: 0.2, track: 0, ...p });

describe('output router', () => {
  it('sends timestamped note on + off', () => {
    const r = new OutputRouter();
    const o = new FakeOut();
    r.out = o;
    r.note(ev({ ch: 3, note: 64, time: 2, dur: 0.5 }));
    expect(o.sent).toEqual([
      { data: [0x92, 64, 100], ts: 2000 },
      { data: [0x82, 64, 0], ts: 2500 },
    ]);
  });

  it('applies latency offset', () => {
    const r = new OutputRouter();
    const o = new FakeOut();
    r.out = o;
    r.latencyMs = 20;
    r.note(ev({ time: 1 }));
    expect(o.sent[0].ts).toBeCloseTo(980);
  });

  it('cuts a sounding note before retriggering it', () => {
    const r = new OutputRouter();
    const o = new FakeOut();
    r.out = o;
    r.note(ev({ time: 1, dur: 1 }));
    r.note(ev({ time: 1.5, dur: 1 }));
    const kinds = o.sent.map((s) => s.data[0]);
    expect(kinds).toEqual([0x90, 0x80, 0x80, 0x90, 0x80]);
  });

  it('just-in-time mode queues and flushes in time order without timestamps', () => {
    const r = new OutputRouter();
    const o = new FakeOut();
    r.out = o;
    r.setTimestampMode('auto', true);
    expect(r.timestamped).toBe(false);
    expect(r.lookahead).toBeLessThan(0.05);
    r.note(ev({ time: 1, dur: 0.5 }));
    r.note(ev({ time: 1.2, note: 62, dur: 0.1 }));
    r.flush(0.9);
    expect(o.sent).toHaveLength(0);
    r.flush(1.0);
    expect(o.sent.map((s) => s.data)).toEqual([[0x90, 60, 100]]);
    r.flush(2);
    expect(o.sent.map((s) => s.data[1])).toEqual([60, 62, 62, 60]);
    expect(o.sent.every((s) => s.ts === undefined)).toBe(true);
  });

  it('panic clears queues and silences every channel', () => {
    const r = new OutputRouter();
    const o = new FakeOut();
    r.out = o;
    r.note(ev({}));
    o.sent = [];
    r.panic();
    expect(o.cleared).toBe(1);
    expect(o.sent.some((s) => s.data[0] === 0x80 && s.data[1] === 60)).toBe(true);
    expect(o.sent.filter((s) => s.data[1] === 123)).toHaveLength(16);
  });

  it('feeds sinks even without an output (preview / capture)', () => {
    const r = new OutputRouter();
    const got: NoteEvent[] = [];
    r.sinks.push({ noteOn: (e) => got.push(e) });
    r.note(ev({}));
    expect(got).toHaveLength(1);
  });
});

describe('capture (SMF)', () => {
  it('encodes variable-length quantities', () => {
    expect(vlq(0)).toEqual([0]);
    expect(vlq(127)).toEqual([0x7f]);
    expect(vlq(128)).toEqual([0x81, 0x00]);
    expect(vlq(0x3fff)).toEqual([0xff, 0x7f]);
  });

  it('writes a valid format-1 file with one track per channel', () => {
    const bytes = writeSMF([ev({ ch: 1, beat: 0 }), ev({ ch: 4, beat: 1, note: 67 })], [{ beat: 0, text: 'Dm9' }], 120);
    const str = (o: number, n: number) => String.fromCharCode(...bytes.slice(o, o + n));
    expect(str(0, 4)).toBe('MThd');
    expect(bytes[9]).toBe(1); // format 1
    expect((bytes[10] << 8) | bytes[11]).toBe(3); // meta + 2 channels
    expect((bytes[12] << 8) | bytes[13]).toBe(PPQ);
    expect(str(14, 4)).toBe('MTrk');
    // every track ends with end-of-track
    const text = Array.from(bytes).join(',');
    expect(text.split('255,47,0').length - 1).toBe(3);
  });

  it('recorder keeps notes relative to the start beat', () => {
    const rec = new Recorder();
    rec.noteOn(ev({ beat: 3 }));
    rec.start(8, 100);
    rec.noteOn(ev({ beat: 10 }));
    rec.marker(8, 'x');
    expect(rec.notes).toHaveLength(1);
    expect(rec.notes[0].beat).toBe(2);
    expect(rec.markers[0].beat).toBe(0);
    expect(rec.toSMF().length).toBeGreaterThan(30);
  });
});

describe('clock follower', () => {
  it('estimates tempo from 24 PPQN pulses and handles start/stop', () => {
    const c = new ClockFollower();
    let started = false;
    c.onStart = () => (started = true);
    c.message([0xfa], 0);
    const per = 60 / 120 / 24;
    for (let i = 0; i < 48; i++) c.message([0xf8], i * per);
    expect(started).toBe(true);
    expect(c.tempo).toBeCloseTo(120, 0);
    c.message([0xfc], 2);
    expect(c.running).toBe(false);
  });
});

describe('midi map', () => {
  class Host implements MapHost {
    values = new Map<string, number>();
    offsets: Record<string, number> = {};
    actions: string[] = [];
    getNorm(t: Target) {
      return this.values.get(targetKey(t)) ?? 0.5;
    }
    setNorm(t: Target, v: number) {
      this.values.set(targetKey(t), v);
    }
    setOffset(k: string, v: number) {
      this.offsets[k] = v;
    }
    action(a: string, arg: number | undefined, pressed: boolean) {
      this.actions.push(`${a}:${arg ?? ''}:${pressed}`);
    }
  }
  const T: Target = { scope: 'focus', param: 'macros.intensity' };

  it('learns a CC and binds it', () => {
    const h = new Host();
    const m = new MidiMap(h);
    m.startLearn(T);
    expect(m.message('8mu', [0xb0, 34, 10])).toBe(true);
    expect(m.mappings).toHaveLength(1);
    expect(m.mappings[0].src).toEqual({ port: '8mu', ch: 1, kind: 'cc', num: 34 });
    expect(m.learning).toBe(null);
  });

  it('soft takeover: ignores the control until it reaches the current value', () => {
    const h = new Host();
    const m = new MidiMap(h);
    m.bind({ port: 'p', ch: 1, kind: 'cc', num: 1 }, T);
    h.values.set(targetKey(T), 0.5);
    m.message('p', [0xb0, 1, 10]); // far below
    expect(h.getNorm(T)).toBe(0.5);
    expect(m.ghosts.get(targetKey(T))).toBeCloseTo(10 / 127);
    m.message('p', [0xb0, 1, 40]);
    expect(h.getNorm(T)).toBe(0.5);
    m.message('p', [0xb0, 1, 70]); // crossed 0.5 → picked up
    expect(h.getNorm(T)).toBeCloseTo(70 / 127);
    m.message('p', [0xb0, 1, 20]);
    expect(h.getNorm(T)).toBeCloseTo(20 / 127);
    m.resetPickup();
    m.message('p', [0xb0, 1, 120]);
    expect(h.getNorm(T)).toBeCloseTo(20 / 127);
  });

  it('a source can only drive one target; rebinding moves it', () => {
    const h = new Host();
    const m = new MidiMap(h);
    const notices: string[] = [];
    m.onNotice = (s) => notices.push(s);
    const src = { port: 'p', ch: 1, kind: 'cc' as const, num: 5 };
    m.bind(src, T);
    m.bind(src, { scope: 'global', param: 'journey.pace' });
    expect(m.mappings).toHaveLength(1);
    expect(notices).toHaveLength(1);
  });

  it('pads trigger actions, tilt sets centred offsets, clock is ignored', () => {
    const h = new Host();
    const m = new MidiMap(h);
    m.bind({ port: 'p', ch: 1, kind: 'note', num: 36 }, { scope: 'action', action: 'mute', arg: 2 });
    m.bind({ port: 'p', ch: 1, kind: 'cc', num: 50 }, { scope: 'offset', key: 'weather' });
    m.message('p', [0x90, 36, 100]);
    m.message('p', [0x80, 36, 0]);
    expect(h.actions).toEqual(['mute:2:true', 'mute:2:false']);
    m.message('p', [0xb0, 50, 64]);
    expect(h.offsets.weather).toBeCloseTo(0);
    m.message('p', [0xb0, 50, 127]);
    expect(h.offsets.weather).toBeGreaterThan(0.45);
    expect(m.message('p', [0xf8])).toBe(false);
  });

  it('8mu wizard binds controls in order', () => {
    const h = new Host();
    const m = new MidiMap(h);
    m.startWizard();
    expect(m.wizardLabel).toBe('move fader 1');
    for (let i = 0; i < 10; i++) m.message('8mu', [0xb0, 34 + i, 0]);
    expect(m.mappings).toHaveLength(10);
    expect(m.learnMode).toBe(false);
    expect(m.mappings[4].target).toEqual({ scope: 'global', param: 'journey.pace' });
  });

  it('relative mode adds two’s-complement deltas', () => {
    const h = new Host();
    const m = new MidiMap(h);
    m.bind({ port: 'p', ch: 1, kind: 'cc', num: 9 }, T, 'relative');
    m.message('p', [0xb0, 9, 10]);
    expect(h.getNorm(T)).toBeCloseTo(0.5 + 10 / 127);
    m.message('p', [0xb0, 9, 118]); // −10
    expect(h.getNorm(T)).toBeCloseTo(0.5);
  });
});
