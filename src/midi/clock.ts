/** Clock helpers: a background-safe worker timer and an external MIDI clock follower. */

export interface Ticker {
  start(): void;
  stop(): void;
}

const WORKER_SRC = `let id=null;onmessage=(e)=>{if(e.data==='start'){if(id===null)id=setInterval(()=>postMessage('tick'),${25});}else{clearInterval(id);id=null;}};`;

/**
 * Timer that keeps ticking in hidden tabs (main-thread timers are throttled to ~1 Hz there).
 * Falls back to setInterval when Workers are unavailable.
 */
export function createTicker(onTick: () => void): Ticker {
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && 'createObjectURL' in URL) {
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = () => onTick();
      return { start: () => w.postMessage('start'), stop: () => w.postMessage('stop') };
    } catch {
      /* fall through */
    }
  }
  let id: ReturnType<typeof setInterval> | null = null;
  return {
    start: () => {
      if (id === null) id = setInterval(onTick, 25);
    },
    stop: () => {
      if (id !== null) clearInterval(id);
      id = null;
    },
  };
}

/** Estimates tempo from incoming 0xF8 clock pulses (24 PPQN) with smoothing. */
export class ClockFollower {
  private times: number[] = [];
  bpm: number | null = null;
  running = false;
  pulses = 0;
  onStart: ((t: number) => void) | null = null;
  onStop: (() => void) | null = null;

  /** Feed a MIDI message received at time t (seconds). */
  message(data: ArrayLike<number>, t: number): void {
    const st = data[0];
    if (st === 0xf8) {
      this.times.push(t);
      if (this.times.length > 49) this.times.shift();
      if (this.running) this.pulses++;
      if (this.times.length >= 7) {
        const n = this.times.length - 1;
        const per = (this.times[n] - this.times[0]) / n;
        if (per > 0) {
          const est = 60 / (per * 24);
          this.bpm = this.bpm === null ? est : this.bpm + (est - this.bpm) * 0.2;
        }
      }
    } else if (st === 0xfa) {
      this.running = true;
      this.pulses = 0;
      this.onStart?.(t);
    } else if (st === 0xfb) {
      this.running = true;
    } else if (st === 0xfc) {
      this.running = false;
      this.onStop?.();
    }
  }

  /** Rounded tempo for display/use (0.1 BPM). */
  get tempo(): number | null {
    return this.bpm === null ? null : Math.round(this.bpm * 10) / 10;
  }
}

/** Keep the screen awake while playing (where supported). */
export class WakeLock {
  private sentinel: { release(): Promise<void> } | null = null;

  async acquire(): Promise<void> {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
      if (nav.wakeLock && !this.sentinel) this.sentinel = await nav.wakeLock.request('screen');
    } catch {
      this.sentinel = null;
    }
  }

  async release(): Promise<void> {
    try {
      await this.sentinel?.release();
    } finally {
      this.sentinel = null;
    }
  }
}
