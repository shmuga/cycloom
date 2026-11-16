/**
 * Output routing. Note events are timestamped in seconds on the performance clock
 * (performance.now() / 1000). Sinks: a Web MIDI output, the sine preview, the recorder.
 */

export interface NoteEvent {
  time: number; // seconds, performance clock
  beat: number; // transport beat (for capture)
  ch: number; // 1..16
  note: number;
  vel: number;
  dur: number; // seconds
  track: number;
}

export interface MidiSendLike {
  send(data: number[], timestamp?: number): void;
  /** Chrome: drop messages already queued with future timestamps. */
  clear?(): void;
}

export interface NoteSink {
  noteOn(ev: NoteEvent): void;
}

interface Pending {
  time: number;
  data: number[];
}

export type TimestampMode = 'auto' | 'on' | 'off';

export class OutputRouter {
  out: MidiSendLike | null = null;
  sinks: NoteSink[] = [];
  latencyMs = 0;
  /** When false, messages are queued and sent just-in-time (for Web MIDI shims that ignore timestamps). */
  timestamped = true;
  private queue: Pending[] = [];
  /** key ch:note → time of scheduled note-off */
  private active = new Map<string, number>();

  setTimestampMode(mode: TimestampMode, isShim: boolean): void {
    this.timestamped = mode === 'on' ? true : mode === 'off' ? false : !isShim;
  }

  /** Lookahead the engine should use for this output mode. */
  get lookahead(): number {
    return this.timestamped ? 0.1 : 0.03;
  }

  note(ev: NoteEvent): void {
    for (const s of this.sinks) s.noteOn(ev);
    if (!this.out) return;
    const ch = (ev.ch - 1) & 0x0f;
    const key = `${ch}:${ev.note}`;
    // latency = how late the device sounds: send that much earlier so sound and visuals coincide
    const t = ev.time - this.latencyMs / 1000;
    const prevOff = this.active.get(key);
    if (prevOff !== undefined && prevOff > t) {
      // retrigger: cut the sounding note just before the new one
      this.enqueue(t - 0.0005, [0x80 | ch, ev.note, 0]);
    }
    this.enqueue(t, [0x90 | ch, ev.note, ev.vel]);
    const off = t + Math.max(0.01, ev.dur);
    this.enqueue(off, [0x80 | ch, ev.note, 0]);
    this.active.set(key, off);
  }

  /** Raw message (clock, start/stop) at a time. */
  raw(time: number, data: number[]): void {
    if (!this.out) return;
    this.enqueue(time - this.latencyMs / 1000, data);
  }

  private enqueue(time: number, data: number[]): void {
    if (this.timestamped) {
      this.out?.send(data, time * 1000);
      return;
    }
    // keep sorted (mostly appended in order)
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].time > time) i--;
    this.queue.splice(i, 0, { time, data });
  }

  /** Just-in-time flush for non-timestamped outputs. Call every scheduler tick. */
  flush(now: number): void {
    if (this.timestamped || !this.out) return;
    let n = 0;
    while (n < this.queue.length && this.queue[n].time <= now + 0.004) n++;
    for (const p of this.queue.splice(0, n)) this.out.send(p.data);
    const cutoff = now - 5;
    for (const [k, t] of this.active) if (t < cutoff) this.active.delete(k);
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  /** Panic: drop everything queued and send All Notes Off + explicit note-offs on all channels. */
  panic(): void {
    this.queue = [];
    if (!this.out) return;
    this.out.clear?.();
    for (const key of this.active.keys()) {
      const [ch, note] = key.split(':').map(Number);
      this.out.send([0x80 | ch, note, 0]);
    }
    for (let ch = 0; ch < 16; ch++) {
      this.out.send([0xb0 | ch, 123, 0]);
      this.out.send([0xb0 | ch, 120, 0]);
    }
    this.active.clear();
  }
}
