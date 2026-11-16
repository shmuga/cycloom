import { type AppState, cloneState } from './types';

type Listener = (s: AppState) => void;

export interface UpdateOptions {
  /** Record an undo step (default true). */
  undo?: boolean;
  /** Consecutive updates with the same key within 1.2 s collapse into one undo step (fader drags). */
  coalesce?: string;
}

const UNDO_LIMIT = 50;

/** Small observable store with an undo stack of whole-state snapshots. */
export class Store {
  private s: AppState;
  private listeners = new Set<Listener>();
  private undoStack: AppState[] = [];
  private lastKey: string | null = null;
  private lastTime = 0;
  now: () => number = () => Date.now();

  constructor(initial: AppState) {
    this.s = initial;
  }

  get state(): AppState {
    return this.s;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  update(mutate: (draft: AppState) => void, opts: UpdateOptions = {}): void {
    const prev = this.s;
    const draft = cloneState(prev);
    mutate(draft);
    if (opts.undo !== false) {
      const t = this.now();
      const same = opts.coalesce && opts.coalesce === this.lastKey && t - this.lastTime < 1200;
      if (!same) {
        this.undoStack.push(prev);
        if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
      }
      this.lastKey = opts.coalesce ?? null;
      this.lastTime = t;
    }
    this.s = draft;
    this.emit();
  }

  /** Replace the whole state (scene load / snapshot restore). Undoable. */
  replace(next: AppState): void {
    this.undoStack.push(this.s);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.lastKey = null;
    this.s = cloneState(next);
    this.emit();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.s = prev;
    this.lastKey = null;
    this.emit();
    return true;
  }

  private emit(): void {
    for (const l of this.listeners) l(this.s);
  }
}
