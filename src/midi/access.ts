/** Web MIDI access wrapper (works with native Web MIDI and iOS Web MIDI browser shims). */

export interface PortInfo {
  id: string;
  name: string;
}

export class MidiAccess {
  access: MIDIAccess | null = null;
  error: string | null = null;
  /** True when navigator.requestMIDIAccess looks injected by a shim (not native). */
  isShim = false;
  onPorts: (() => void) | null = null;
  onMessage: ((portName: string, data: Uint8Array, timeSec: number) => void) | null = null;
  private inputId = '';

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async init(): Promise<boolean> {
    if (!this.supported) {
      this.error = 'Web MIDI not available — using sine preview';
      return false;
    }
    try {
      const fn = navigator.requestMIDIAccess as unknown as { toString(): string };
      this.isShim = !/\[native code\]/.test(Function.prototype.toString.call(fn));
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => {
        this.bindInput(this.inputId);
        this.onPorts?.();
      };
      return true;
    } catch (e) {
      this.error = `MIDI unavailable (${(e as Error).name}) — using sine preview`;
      return false;
    }
  }

  outputs(): PortInfo[] {
    if (!this.access) return [];
    return [...this.access.outputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id }));
  }

  inputs(): PortInfo[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id }));
  }

  output(id: string): MIDIOutput | null {
    return (id && this.access?.outputs.get(id)) || null;
  }

  /** Prefer a port whose name mentions the Model:Cycles. */
  guessOutput(): string {
    const outs = this.outputs();
    return (outs.find((o) => /cycles/i.test(o.name)) ?? outs[0])?.id ?? '';
  }

  /** Listen to one input (or all inputs when id is '*'). */
  bindInput(id: string): void {
    this.inputId = id;
    if (!this.access) return;
    for (const inp of this.access.inputs.values()) {
      inp.onmidimessage = id === '*' || inp.id === id ? (e: MIDIMessageEvent) => this.onMessage?.(inp.name ?? inp.id, e.data ?? new Uint8Array(), e.timeStamp / 1000) : null;
    }
  }
}
