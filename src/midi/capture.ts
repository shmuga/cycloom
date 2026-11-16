import type { NoteEvent, NoteSink } from './router';

export const PPQ = 480;

interface Marker {
  beat: number;
  text: string;
}

/** Records sent notes (by transport beat) and writes a Standard MIDI File, format 1. */
export class Recorder implements NoteSink {
  recording = false;
  notes: NoteEvent[] = [];
  markers: Marker[] = [];
  bpm = 120;
  private startBeat = 0;

  start(beat: number, bpm: number): void {
    this.recording = true;
    this.notes = [];
    this.markers = [];
    this.startBeat = beat;
    this.bpm = bpm;
  }

  stop(): void {
    this.recording = false;
  }

  noteOn(ev: NoteEvent): void {
    if (this.recording) this.notes.push({ ...ev, beat: ev.beat - this.startBeat });
  }

  marker(beat: number, text: string): void {
    if (this.recording) this.markers.push({ beat: beat - this.startBeat, text });
  }

  toSMF(): Uint8Array {
    return writeSMF(this.notes, this.markers, this.bpm);
  }
}

export function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

const text = (s: string): number[] => [...new TextEncoder().encode(s)];
const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number): number[] => [(n >>> 8) & 255, n & 255];

function chunk(type: string, body: number[]): number[] {
  return [...text(type), ...u32(body.length), ...body];
}

function trackFrom(events: { tick: number; bytes: number[] }[]): number[] {
  // stable sort keeps the caller's tie order
  events.sort((a, b) => a.tick - b.tick);
  const out: number[] = [];
  let last = 0;
  for (const e of events) {
    out.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  out.push(0, 0xff, 0x2f, 0x00);
  return chunk('MTrk', out);
}

/** Note durations are converted using the recording tempo. */
export function writeSMF(notes: NoteEvent[], markers: Marker[], bpm: number): Uint8Array {
  const tick = (beat: number) => Math.max(0, Math.round(beat * PPQ));
  const usPerQ = Math.round(60_000_000 / bpm);
  const meta: { tick: number; bytes: number[] }[] = [
    { tick: 0, bytes: [0xff, 0x51, 0x03, (usPerQ >> 16) & 255, (usPerQ >> 8) & 255, usPerQ & 255] },
    { tick: 0, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
    ...markers.map((m) => {
      const t = text(m.text);
      return { tick: tick(m.beat), bytes: [0xff, 0x06, ...vlq(t.length), ...t] };
    }),
  ];
  const tracks: number[][] = [trackFrom(meta)];
  const channels = [...new Set(notes.map((n) => n.ch))].sort((a, b) => a - b);
  for (const ch of channels) {
    const c = (ch - 1) & 15;
    const evs: { tick: number; bytes: number[] }[] = [];
    const name = text(`ch ${ch}`);
    evs.push({ tick: 0, bytes: [0xff, 0x03, ...vlq(name.length), ...name] });
    for (const n of notes.filter((x) => x.ch === ch)) {
      const on = tick(n.beat);
      const off = on + Math.max(1, tick((n.dur * bpm) / 60));
      evs.push({ tick: on, bytes: [0x90 | c, n.note, n.vel] });
      evs.push({ tick: off, bytes: [0x80 | c, n.note, 0] });
    }
    // at equal ticks: meta first, then note-offs, then note-ons
    const rank = (b: number[]) => (b[0] === 0xff ? 0 : (b[0] & 0xf0) === 0x80 ? 1 : 2);
    tracks.push(trackFrom(evs.sort((a, b) => a.tick - b.tick || rank(a.bytes) - rank(b.bytes))));
  }
  const header = chunk('MThd', [...u16(1), ...u16(tracks.length), ...u16(PPQ)]);
  return new Uint8Array([...header, ...tracks.flat()]);
}
