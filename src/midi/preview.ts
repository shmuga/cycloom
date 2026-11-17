import type { NoteEvent, NoteSink } from './router';
import { AudioTape, encodeWav } from './wav';

/** Small WebAudio synth used when no MIDI output is selected. */
export class PreviewSynth implements NoteSink {
  enabled = true;
  /** track index → drum? */
  isDrum: (track: number) => boolean = () => false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private tape: AudioTape | null = null;
  private tap: ScriptProcessorNode | null = null;
  private tapSink: GainNode | null = null;

  /** Must be called from a user gesture on iOS. Safe to call often: it only acts when audio is not running. */
  resume(): void {
    if (this.ctx?.state === 'running') return;
    if (!this.ctx) {
      // iOS 17+: play like a music app, so the ring/silent switch doesn't mute the preview
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) {
        try {
          session.type = 'playback';
        } catch {
          /* older WebKit: setting is not supported */
        }
      }
      const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.3);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
  }

  get taping(): boolean {
    return this.tape !== null;
  }

  /** Start capturing what the preview plays. Call from a user gesture (it may create the audio context). */
  startTape(): boolean {
    this.resume();
    const ctx = this.ctx;
    if (!ctx || !this.master || this.tape) return false;
    const tape = new AudioTape();
    // ScriptProcessor is deprecated but works everywhere (incl. iOS) without a separate worklet file
    const tap = ctx.createScriptProcessor(4096, 2, 2);
    tap.onaudioprocess = (e) => {
      if (!this.tape) return;
      const ib = e.inputBuffer;
      tape.push([ib.getChannelData(0), ib.getChannelData(ib.numberOfChannels > 1 ? 1 : 0)]);
    };
    // the node only runs when it reaches the destination: route it through a silent gain
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.master.connect(tap);
    tap.connect(sink).connect(ctx.destination);
    this.tape = tape;
    this.tap = tap;
    this.tapSink = sink;
    return true;
  }

  /** Stop capturing and return a 16-bit WAV (null when nothing was heard). */
  stopTape(): Uint8Array | null {
    const tape = this.tape;
    if (!tape || !this.ctx) return null;
    this.tape = null;
    try {
      this.master?.disconnect(this.tap!);
    } catch {
      /* already gone */
    }
    this.tap?.disconnect();
    this.tapSink?.disconnect();
    this.tap = null;
    this.tapSink = null;
    const ch = tape.join(this.ctx.sampleRate);
    if (!ch[0]?.length) return null;
    return encodeWav(ch, this.ctx.sampleRate);
  }

  noteOn(ev: NoteEvent): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, ev.time - performance.now() / 1000);
    const amp = (ev.vel / 127) * 0.6;
    const f = 440 * Math.pow(2, (ev.note - 69) / 12);
    const g = ctx.createGain();
    g.connect(this.master);
    if (this.isDrum(ev.track)) {
      if (ev.note >= 62 && this.noise) {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f * 4;
        bp.Q.value = 2;
        src.connect(bp).connect(g);
        g.gain.setValueAtTime(amp, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
        src.start(when);
        src.stop(when + 0.15);
      } else {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f * 2.5, when);
        o.frequency.exponentialRampToValueAtTime(f, when + 0.06);
        o.connect(g);
        g.gain.setValueAtTime(amp, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
        o.start(when);
        o.stop(when + 0.32);
      }
      return;
    }
    const o = ctx.createOscillator();
    o.type = ev.track % 2 ? 'triangle' : 'sine';
    o.frequency.value = f;
    o.connect(g);
    const dur = Math.max(0.06, ev.dur);
    // long notes fade in and out (drones); short ones stay plucky
    const attack = dur > 1 ? Math.min(1.5, dur * 0.25) : 0.01;
    const release = dur > 1 ? Math.min(1.2, dur * 0.2) : 0.08;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(amp * (dur > 1 ? 0.5 : 0.7), when + attack);
    g.gain.setTargetAtTime(0, when + dur, release / 3);
    o.start(when);
    o.stop(when + dur + release + 0.3);
  }
}
