import { type ParamDef, paramDef, toNorm, quantize } from '../state/params';
import type { Store } from '../state/store';
import type { AppState } from '../state/types';
import { h, setText, toggle } from './dom';

export interface FaderHost {
  store: Store;
  /** Track index the fader currently addresses (−1 for global params). */
  track(): number;
  learnMode(): boolean;
  /** Learn target clicked (shift = fixed track instead of focus). */
  learn(path: string, track: number, fixed: boolean): void;
  /** Hardware position for the takeover ghost line (0..1) or undefined. */
  ghost(path: string, track: number): number | undefined;
  badge(path: string, track: number): string | null;
}

export interface FaderOpts {
  path: string;
  label: string;
  color?: 'pink' | 'blue';
  /** Optional caption override for the value (e.g. pace "×2"). */
  hint?: () => string;
  /** Tooltip text; tapping the label shows it on phones. */
  tip?: string;
}

let uid = 0;

/**
 * Vertical fill fader: a drawn bar with an invisible range input on top for keyboard/a11y.
 * Pointer drags are relative (no jump), double-click resets, wheel nudges.
 */
export class Fader {
  readonly el: HTMLLabelElement;
  private fill: HTMLElement;
  private ghostEl: HTMLElement;
  private val: HTMLElement;
  private badgeEl: HTMLElement;
  private input: HTMLInputElement;
  private bar: HTMLElement;
  private drag: { y: number; v: number; h: number } | null = null;
  private lastTap = 0;

  constructor(
    private host: FaderHost,
    readonly opts: FaderOpts,
  ) {
    const id = `fd${uid++}`;
    this.fill = h('i', { class: opts.color === 'blue' ? 'blue' : '' });
    this.ghostEl = h('b', { class: 'ghost', hidden: true });
    this.input = h('input', { type: 'range', id, min: 0, max: 1000, step: 1, 'aria-label': opts.label, tabindex: 0 });
    this.bar = h('span', { class: 'fb' }, this.fill, this.ghostEl, this.input);
    this.val = h('span', { class: 'fv' });
    this.badgeEl = h('span', { class: 'badge', hidden: true });
    this.el = h('label', { class: 'fd', for: id, 'data-tip': opts.tip || null }, this.val, this.bar, h('span', { class: `fl${opts.tip ? ' tip-label' : ''}` }, opts.label), this.badgeEl);

    this.bar.addEventListener('pointerdown', (e) => this.down(e));
    this.bar.addEventListener('pointermove', (e) => this.move(e));
    this.bar.addEventListener('pointerup', (e) => this.up(e));
    this.bar.addEventListener('pointercancel', () => (this.drag = null));
    this.bar.addEventListener('dblclick', () => this.reset());
    this.bar.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const d = this.def();
        if (!d) return;
        this.set(this.get() - Math.sign(e.deltaY) * d.step * (e.shiftKey ? 1 : Math.max(1, Math.round((d.max - d.min) / d.step / 100))));
      },
      { passive: false },
    );
    this.input.addEventListener('input', () => {
      const d = this.def();
      if (d) this.set(d.min + (Number(this.input.value) / 1000) * (d.max - d.min));
    });
    this.el.addEventListener('click', (e) => e.preventDefault());
  }

  private def(s: AppState = this.host.store.state): ParamDef | null {
    return paramDef(this.opts.path, s, Math.max(0, this.host.track()));
  }

  private get(): number {
    const d = this.def();
    return d ? d.get(this.host.store.state, Math.max(0, this.host.track())) : 0;
  }

  private set(v: number, coalesce = true): void {
    const d = this.def();
    if (!d) return;
    const t = Math.max(0, this.host.track());
    const q = quantize(d, v);
    if (q === d.get(this.host.store.state, t)) return;
    this.host.store.update((s) => d.set(s, t, q), coalesce ? { coalesce: `${this.opts.path}:${t}` } : {});
  }

  /** Reset is its own undo step, never merged into a preceding drag. */
  private reset(): void {
    const d = this.def();
    if (d) this.set(d.def, false);
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    if (this.host.learnMode()) {
      this.host.learn(this.opts.path, this.host.track(), e.shiftKey);
      return;
    }
    // double-tap reset on touch
    const now = performance.now();
    if (e.pointerType === 'touch' && now - this.lastTap < 300) {
      this.reset();
      this.lastTap = 0;
      return;
    }
    this.lastTap = now;
    try {
      this.bar.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer: drag still works without capture */
    }
    this.input.focus({ preventScroll: true });
    this.drag = { y: e.clientY, v: this.get(), h: this.bar.getBoundingClientRect().height };
  }

  private move(e: PointerEvent): void {
    if (!this.drag) return;
    const d = this.def();
    if (!d) return;
    const fine = e.shiftKey ? 0.25 : 1;
    const dv = ((this.drag.y - e.clientY) / this.drag.h) * (d.max - d.min) * fine;
    this.set(this.drag.v + dv);
  }

  private up(e: PointerEvent): void {
    try {
      if (this.bar.hasPointerCapture(e.pointerId)) this.bar.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.drag = null;
  }

  update(s: AppState): void {
    const d = this.def(s);
    if (!d) return;
    const t = Math.max(0, this.host.track());
    const v = d.get(s, t);
    const n = Math.max(0, Math.min(1, toNorm(d, v)));
    const pct = `${(n * 100).toFixed(1)}%`;
    if (this.fill.style.height !== pct) this.fill.style.height = pct;
    setText(this.val, this.opts.hint ? this.opts.hint() : d.fmt(v));
    const iv = String(Math.round(n * 1000));
    if (this.input.value !== iv && document.activeElement !== this.input) this.input.value = iv;
    this.input.setAttribute('aria-valuetext', d.fmt(v));
    const g = this.host.ghost(this.opts.path, t);
    this.ghostEl.hidden = g === undefined;
    if (g !== undefined) this.ghostEl.style.bottom = `${(g * 100).toFixed(1)}%`;
    const b = this.host.badge(this.opts.path, t);
    this.badgeEl.hidden = !b;
    if (b) setText(this.badgeEl, b);
    toggle(this.el, 'mapped', !!b);
  }
}
