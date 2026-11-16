import type { EngineSnapshot } from '../engine/engine';
import type { Mapping } from '../midi/midimap';
import { type AppState, defaultState } from './types';

const KEY = 'nc.state.v1';
const SCENES = 'nc.scenes.v1';
const SNAPS = 'nc.snaps.v1';
const MAPS = 'nc.midimap.v1';

export const SNAP_SLOTS = 8;

export interface Snapshot {
  state: AppState;
  engine: EngineSnapshot;
  at: number;
}

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/** Fill missing fields from defaults so older saves keep loading. */
export function migrate(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = defaultState();
  const r = raw as Partial<AppState>;
  if (!Array.isArray(r.tracks) || r.tracks.length === 0) return null;
  const base = d.tracks[0];
  return {
    ...d,
    ...r,
    harmony: { ...d.harmony, ...(r.harmony ?? {}) },
    journey: { ...d.journey, ...(r.journey ?? {}) },
    tracks: r.tracks.map((t) => ({
      ...base,
      ...t,
      macros: { ...base.macros, ...t.macros },
      notes: { ...base.notes, ...t.notes },
      midi: { ...base.midi, ...t.midi },
      life: { ...base.life, ...t.life },
      listen: { ...base.listen, ...t.listen },
      modeParams: { ...t.modeParams },
    })),
  };
}

export class Persist {
  private kv: KV;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(kv?: KV) {
    let store: KV | undefined = kv;
    if (!store) {
      try {
        store = window.localStorage;
        store.getItem('nc.probe');
      } catch {
        store = undefined;
      }
    }
    this.kv = store ?? memoryKV();
  }

  private read<T>(k: string): T | null {
    try {
      const v = this.kv.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  }

  private write(k: string, v: unknown): void {
    try {
      this.kv.setItem(k, JSON.stringify(v));
    } catch {
      /* quota / private mode: ignore */
    }
  }

  loadState(): AppState | null {
    return migrate(this.read(KEY));
  }

  saveState(s: AppState): void {
    this.write(KEY, s);
  }

  saveSoon(s: AppState): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveState(s), 400);
  }

  // scenes ---------------------------------------------------------------
  scenes(): Record<string, Snapshot> {
    return this.read<Record<string, Snapshot>>(SCENES) ?? {};
  }

  saveScene(name: string, snap: Snapshot): void {
    const all = this.scenes();
    all[name] = snap;
    this.write(SCENES, all);
  }

  deleteScene(name: string): void {
    const all = this.scenes();
    delete all[name];
    this.write(SCENES, all);
  }

  // temporary snap slots -------------------------------------------------
  snaps(): (Snapshot | null)[] {
    const s = this.read<(Snapshot | null)[]>(SNAPS) ?? [];
    return Array.from({ length: SNAP_SLOTS }, (_, i) => s[i] ?? null);
  }

  setSnaps(s: (Snapshot | null)[]): void {
    this.write(SNAPS, s);
  }

  // controller mappings --------------------------------------------------
  mappings(): Mapping[] {
    return this.read<Mapping[]>(MAPS) ?? [];
  }

  setMappings(m: Mapping[]): void {
    this.write(MAPS, m);
  }
}

export function exportJSON(s: AppState, mappings: Mapping[]): string {
  return JSON.stringify({ app: 'cycloom', version: 1, state: s, mappings }, null, 2);
}

export function importJSON(text: string): { state: AppState; mappings: Mapping[] } | null {
  try {
    const d = JSON.parse(text) as { state?: unknown; mappings?: Mapping[] };
    const state = migrate(d.state ?? d);
    if (!state) return null;
    return { state, mappings: Array.isArray(d.mappings) ? d.mappings : [] };
  } catch {
    return null;
  }
}
