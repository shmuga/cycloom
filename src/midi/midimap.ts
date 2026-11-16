/** MIDI learn / controller mapping with soft takeover (pickup). */

export interface MidiSource {
  port: string;
  ch: number; // 1..16
  kind: 'cc' | 'note';
  num: number;
}

export type ActionId = 'play' | 'stop' | 'mute' | 'solo' | 'snap' | 'restore' | 'nextTrack' | 'prevTrack' | 'holdChord' | 'panic';

export type Target =
  | { scope: 'track'; track: number; param: string }
  | { scope: 'focus'; param: string }
  | { scope: 'global'; param: string }
  | { scope: 'offset'; key: 'rotation' | 'weather' }
  | { scope: 'action'; action: ActionId; arg?: number };

export interface Mapping {
  src: MidiSource;
  target: Target;
  mode: 'absolute' | 'relative' | 'toggle' | 'momentary';
  min: number; // normalised 0..1 range of the target
  max: number;
  curve: 'lin' | 'exp';
  invert: boolean;
}

export interface MapHost {
  /** Current normalised value (0..1) of a parameter target. */
  getNorm(t: Target): number | null;
  setNorm(t: Target, v: number): void;
  setOffset(key: 'rotation' | 'weather', v: number): void;
  action(a: ActionId, arg: number | undefined, pressed: boolean): void;
}

export const targetKey = (t: Target): string => {
  switch (t.scope) {
    case 'track':
      return `track:${t.track}:${t.param}`;
    case 'focus':
      return `focus:${t.param}`;
    case 'global':
      return `global:${t.param}`;
    case 'offset':
      return `offset:${t.key}`;
    case 'action':
      return `action:${t.action}:${t.arg ?? ''}`;
  }
};

export const sourceKey = (s: MidiSource): string => `${s.port}|${s.ch}|${s.kind}|${s.num}`;

export function describeSource(s: MidiSource, portLabel = s.port): string {
  const dev = portLabel.split(/[\s:]/)[0] || 'midi';
  return `${dev} · ${s.kind === 'cc' ? 'CC' : 'note'} ${s.num}`;
}

export const ENTRY_8MU_STEPS: { label: string; target: Target }[] = [
  { label: 'move fader 1', target: { scope: 'focus', param: 'macros.intensity' } },
  { label: 'move fader 2', target: { scope: 'focus', param: 'macros.color' } },
  { label: 'move fader 3', target: { scope: 'focus', param: 'macros.rotation' } },
  { label: 'move fader 4', target: { scope: 'focus', param: 'macros.randomness' } },
  { label: 'move fader 5', target: { scope: 'global', param: 'journey.pace' } },
  { label: 'move fader 6', target: { scope: 'global', param: 'journey.weather' } },
  { label: 'move fader 7', target: { scope: 'global', param: 'journey.breathe' } },
  { label: 'move fader 8', target: { scope: 'global', param: 'journey.rest' } },
  { label: 'tilt left / right', target: { scope: 'offset', key: 'rotation' } },
  { label: 'tilt forward / back', target: { scope: 'offset', key: 'weather' } },
];

const PICKUP_WINDOW = 0.03;

export class MidiMap {
  mappings: Mapping[] = [];
  /** target being learned (single learn) */
  learning: Target | null = null;
  learnMode = false;
  /** guided wizard queue */
  wizard: { label: string; target: Target }[] = [];
  /** per mapping: whether hardware has caught the value */
  private picked = new Map<string, boolean>();
  private lastIn = new Map<string, number>();
  /** hardware positions for ghost lines, by target key */
  readonly ghosts = new Map<string, number>();
  onChange: (() => void) | null = null;
  onNotice: ((msg: string) => void) | null = null;

  constructor(private host: MapHost) {}

  startLearn(t: Target): void {
    this.learning = t;
    this.onChange?.();
  }

  startWizard(steps = ENTRY_8MU_STEPS): void {
    this.wizard = [...steps];
    this.learnMode = true;
    this.learning = this.wizard[0]?.target ?? null;
    this.onChange?.();
  }

  get wizardLabel(): string | null {
    return this.wizard[0]?.label ?? null;
  }

  stopLearn(): void {
    this.learning = null;
    this.learnMode = false;
    this.wizard = [];
    this.onChange?.();
  }

  bind(src: MidiSource, target: Target, mode?: Mapping['mode']): Mapping {
    const sk = sourceKey(src);
    const existing = this.mappings.find((m) => sourceKey(m.src) === sk);
    if (existing && targetKey(existing.target) !== targetKey(target)) this.onNotice?.('control moved to new target');
    this.mappings = this.mappings.filter((m) => sourceKey(m.src) !== sk && targetKey(m.target) !== targetKey(target));
    const isAction = target.scope === 'action';
    const m: Mapping = {
      src,
      target,
      mode: mode ?? (isAction ? (src.kind === 'note' ? 'momentary' : 'toggle') : 'absolute'),
      min: 0,
      max: 1,
      curve: 'lin',
      invert: false,
    };
    this.mappings.push(m);
    this.picked.set(sk, false);
    this.onChange?.();
    return m;
  }

  unbind(target: Target): void {
    const k = targetKey(target);
    this.mappings = this.mappings.filter((m) => targetKey(m.target) !== k);
    this.onChange?.();
  }

  mappingFor(target: Target): Mapping | undefined {
    const k = targetKey(target);
    return this.mappings.find((m) => targetKey(m.target) === k);
  }

  /** Call when targets change underneath the hardware (scene load, focus change). */
  resetPickup(filter?: (m: Mapping) => boolean): void {
    for (const m of this.mappings) if (!filter || filter(m)) this.picked.set(sourceKey(m.src), false);
  }

  /** Feed an incoming MIDI message. Returns true when consumed. */
  message(port: string, data: ArrayLike<number>): boolean {
    const st = data[0] & 0xf0;
    const ch = (data[0] & 0x0f) + 1;
    if (data[0] >= 0xf0) return false; // clock / transport are never mapping input
    let src: MidiSource | null = null;
    let value = 0;
    let pressed = false;
    if (st === 0xb0) {
      src = { port, ch, kind: 'cc', num: data[1] };
      value = data[2];
    } else if (st === 0x90 || st === 0x80) {
      src = { port, ch, kind: 'note', num: data[1] };
      pressed = st === 0x90 && data[2] > 0;
      value = pressed ? 127 : 0;
    }
    if (!src) return false;

    if (this.learning) {
      if (src.kind === 'note' && !pressed) return true;
      this.bind(src, this.learning);
      if (this.wizard.length) {
        this.wizard.shift();
        this.learning = this.wizard[0]?.target ?? null;
        if (!this.learning) this.learnMode = false;
      } else {
        this.learning = null;
      }
      this.onChange?.();
      return true;
    }

    const sk = sourceKey(src);
    const m = this.mappings.find((x) => sourceKey(x.src) === sk);
    if (!m) return false;
    this.apply(m, value, pressed);
    return true;
  }

  private shape(m: Mapping, raw01: number): number {
    let v = m.invert ? 1 - raw01 : raw01;
    if (m.curve === 'exp') v = v * v;
    return m.min + (m.max - m.min) * v;
  }

  private apply(m: Mapping, raw: number, pressed: boolean): void {
    const t = m.target;
    if (t.scope === 'action') {
      if (m.mode === 'momentary') this.host.action(t.action, t.arg, pressed);
      else if (raw > 63 || pressed) this.host.action(t.action, t.arg, true);
      return;
    }
    if (t.scope === 'offset') {
      // centred: 64 = no offset → −0.5 … +0.5
      this.host.setOffset(t.key, (raw - 64) / 127);
      return;
    }
    const sk = sourceKey(m.src);
    if (m.mode === 'relative') {
      const cur = this.host.getNorm(t) ?? 0;
      const delta = raw >= 64 ? raw - 128 : raw;
      this.host.setNorm(t, Math.max(0, Math.min(1, cur + delta / 127)));
      return;
    }
    const v = this.shape(m, raw / 127);
    const tk = targetKey(t);
    this.ghosts.set(tk, v);
    if (!this.picked.get(sk)) {
      const cur = this.host.getNorm(t);
      const prev = this.lastIn.get(sk);
      this.lastIn.set(sk, v);
      if (cur === null) return;
      const near = Math.abs(v - cur) <= PICKUP_WINDOW;
      const crossed = prev !== undefined && (prev - cur) * (v - cur) < 0;
      if (!near && !crossed) {
        this.onChange?.();
        return;
      }
      this.picked.set(sk, true);
    }
    this.lastIn.set(sk, v);
    this.ghosts.delete(tk);
    this.host.setNorm(t, v);
  }

  isPicked(m: Mapping): boolean {
    return this.picked.get(sourceKey(m.src)) ?? false;
  }

  toJSON(): Mapping[] {
    return this.mappings.map((m) => ({ ...m, src: { ...m.src }, target: { ...m.target } as Target }));
  }

  load(ms: Mapping[]): void {
    this.mappings = ms.map((m) => ({ ...m }));
    this.picked.clear();
    this.onChange?.();
  }
}
