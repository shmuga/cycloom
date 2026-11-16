import { HINTS, MODE_BLURB, hintFor } from './hints';
import { decodeShare, encodeShare, shareURL } from '../state/share';
import { PRESETS } from '../state/presets';
import { randomSetup } from '../state/randomise';
import type { Engine } from '../engine/engine';
import { DIVISIONS, GATES } from '../mapping/grid';
import { poolLabel } from '../mapping/notes';
import type { MidiAccess } from '../midi/access';
import type { Recorder } from '../midi/capture';
import type { ClockFollower } from '../midi/clock';
import { type MidiMap, type Target, describeSource, targetKey } from '../midi/midimap';
import type { PreviewSynth } from '../midi/preview';
import type { OutputRouter } from '../midi/router';
import { MODES, noteName, pcName } from '../music/theory';
import { SceneRenderer } from '../scene/renderer';
import { PARAMS } from '../state/params';
import { type Persist, type Snapshot, exportJSON, importJSON } from '../state/persist';
import type { Store } from '../state/store';
import { type AppState, MAX_TRACKS, defaultModeParams, defaultState, makeTrack } from '../state/types';
import { MODE_IDS, MODE_PARAMS, type ModeId } from '../voices';
import { RELATIONS, renderBand, renderMiniBand, renderPhoneBand } from './band';
import { dice, h, loadIcon, logo, pad2, presetsIcon, saveIcon, setText, shareIcon, toggle } from './dom';
import { Fader, type FaderHost } from './fader';

export interface AppDeps {
  store: Store;
  engine: Engine;
  router: OutputRouter;
  recorder: Recorder;
  preview: PreviewSynth;
  midi: MidiAccess;
  map: MidiMap;
  persist: Persist;
  follower: ClockFollower;
}

type View = 'overview' | 'zoom';
type ZoomTab = 'mode' | 'motion' | 'notes' | 'midi';

const SLOT_WORD: Record<ModeId, string> = { drops: 'paddle', waves: 'buoy', rockfall: 'terrace', wind: 'chime', pendulum: 'pendulum', orbits: 'ray' };
const VEL_PRESETS: [number, number][] = [
  [1, 127],
  [30, 90],
  [50, 100],
  [60, 110],
  [80, 127],
  [100, 127],
];

/** Box label → hint key, where they differ. */
const BOX_TIPS: Record<string, string> = { 'base note': 'drumNote', 'accent above': 'accent', swing: 'trackSwing' };

export class App {
  view: View = 'overview';
  focus = 0;
  zoomTab: ZoomTab = 'motion';
  snaps: (Snapshot | null)[];
  sceneName = '';
  private root: HTMLElement;
  private overview!: SceneRenderer;
  private stage!: SceneRenderer;
  private faders: Fader[] = [];
  private zoomFaders: Fader[] = [];
  private els: Record<string, HTMLElement> = {};
  private stripKey = '';
  private panelKey = '';
  private lastHarmonyRender = 0;
  private lastFrame = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private learnFocus = false;

  constructor(
    mount: HTMLElement,
    readonly d: AppDeps,
  ) {
    this.root = mount;
    this.snaps = d.persist.snaps();
    this.build();
    d.store.subscribe(() => this.update());
    d.engine.onHarmony = () => (this.lastHarmonyRender = 0);
    d.map.onChange = () => {
      document.body.classList.toggle('learning', d.map.learnMode || !!d.map.learning);
      d.persist.setMappings(d.map.toJSON());
      this.updateFaders();
      this.learnToast();
    };
    d.map.onNotice = (m) => this.toast(m);
    this.update();
    window.addEventListener('keydown', (e) => this.key(e));
  }

  get store(): Store {
    return this.d.store;
  }
  get state(): AppState {
    return this.d.store.state;
  }

  // ================================================================ build

  private build(): void {
    document.body.dataset.view = this.view;
    const page = h('div', { class: 'page' });
    page.append(this.buildHeader(), this.buildZoomHead());
    const content = h('div', { class: 'content' });
    content.append(...this.buildOverview(), ...this.buildZoom());
    page.append(content);
    this.root.replaceChildren(page);
    this.overview = new SceneRenderer(this.els.overviewCanvas as HTMLCanvasElement, this.d.engine, 'overview');
    this.stage = new SceneRenderer(this.els.stageCanvas as HTMLCanvasElement, this.d.engine, 'zoom');
    const ro = new ResizeObserver(() => {
      this.overview.resize();
      this.stage.resize();
    });
    ro.observe(this.els.overviewCanvas);
    ro.observe(this.els.stageCanvas);
  }

  private faderHost(trackFn: () => number): FaderHost {
    return {
      store: this.store,
      track: trackFn,
      learnMode: () => this.d.map.learnMode || !!this.d.map.learning,
      learn: (path, track, fixed) => this.learnClick(path, track, fixed),
      ghost: (path, track) => this.d.map.ghosts.get(targetKey(this.targetFor(path, track))),
      badge: (path, track) => {
        const m = this.d.map.mappingFor(this.targetFor(path, track)) ?? (track >= 0 ? this.d.map.mappingFor({ scope: 'track', track, param: path }) : undefined);
        return m ? describeSource(m.src) : null;
      },
    };
  }

  private targetFor(path: string, track: number): Target {
    if (!path.startsWith('macros.') && !path.startsWith('mode.') && !path.startsWith('life.')) return { scope: 'global', param: path };
    void track;
    return { scope: 'focus', param: path };
  }

  private buildHeader(): HTMLElement {
    const e = this.els;
    e.playBtn = h('button', { class: 'play', 'aria-label': 'Play', 'data-tip': HINTS.play, onclick: () => this.togglePlay() }, h('span', { class: 'tri' }));
    e.playBtnPhone = h('button', { class: 'play', 'aria-label': 'Play', 'data-tip': HINTS.play, onclick: () => this.togglePlay() }, h('span', { class: 'tri' }));
    e.bpm = h('span', { class: 'n big' });
    e.bpmPhone = h('span', { class: 'n big' });
    e.swing = h('span', { class: 'n mid' });
    e.bar = h('span', { class: 'n sub', style: 'font-size:14px', 'data-tip': HINTS.bar });
    e.port = h('span', { class: 'pill', style: 'cursor:pointer', 'data-tip': HINTS.output });
    e.recBtn = h('button', { class: 'pill hdr-over', 'aria-label': 'Record', 'data-tip': HINTS.rec, onclick: () => this.toggleRec() }, h('span', { class: 'rec-dot' }), 'rec');
    e.restoreDots = h('span', { class: 'restore-dots' });

    const bpmReadout = this.dragReadout(h('div', { class: 'readout', 'data-tip': HINTS.bpm }, e.bpm, h('span', { class: 'cap tip-label' }, 'bpm')), 'bpm', 0.25);
    const bpmReadoutPhone = this.dragReadout(h('div', { class: 'readout', 'data-tip': HINTS.bpm }, e.bpmPhone, h('span', { class: 'cap tip-label', style: 'font-size:11px' }, 'bpm')), 'bpm', 0.25);
    const swingReadout = this.dragReadout(h('div', { class: 'readout', 'data-tip': HINTS.swing }, e.swing, h('span', { class: 'cap tip-label' }, 'swing')), 'swing', 0.0025);

    return h(
      'header',
      { class: 'top' },
      // desktop
      h('div', { class: 'brand desk-only' }, logo(40), h('span', { class: 'word' }, 'cycloom')),
      h('div', { class: 'transport desk-only' }, e.playBtn, bpmReadout, swingReadout, e.bar),
      h(
        'div',
        { class: 'hdr-right desk-only' },
        e.port,
        e.recBtn,
        h(
          'div',
          { class: 'icon-group hdr-over', role: 'group', 'aria-label': 'Library' },
          h('button', { class: 'pill icon', 'aria-label': 'Presets', 'data-tip': HINTS.presets, onclick: () => this.openPresets() }, presetsIcon()),
          h('button', { class: 'pill icon', 'aria-label': 'Snap', 'data-tip': HINTS.snap, onclick: () => this.snap() }, saveIcon()),
          h(
            'div',
            { class: 'pill icon snap-pill', role: 'group', 'aria-label': 'Restore snapshot', 'data-tip': HINTS.restore },
            h('button', { class: 'bare', 'aria-label': 'Restore last snap', onclick: () => this.restore() }, loadIcon()),
            e.restoreDots,
          ),
          h('button', { class: 'pill icon', 'aria-label': 'Share link', 'data-tip': HINTS.share, onclick: () => this.openShare() }, shareIcon()),
          h('button', { class: 'pill icon dice-btn', 'aria-label': 'Randomise tracks', 'data-tip': HINTS.randomise, onclick: () => this.randomise() }, dice()),
        ),
        h('button', { class: 'pill hdr-over', 'aria-label': 'More', 'data-tip': HINTS.menu, onclick: () => this.openMenu() }, '⋯'),
      ),
      // phone (E3)
      h('span', { class: 'phone-only', style: 'align-items:center' }, logo(34)),
      h('span', { class: 'phone-only', style: 'align-items:baseline;gap:6px' }, bpmReadoutPhone),
      h('span', { class: 'sp phone-only' }),
      (e.recPhone = h('button', { class: 'icon-btn phone-only', 'aria-label': 'Record', 'data-tip': HINTS.rec, onclick: () => this.toggleRec() }, h('span', { class: 'rec-dot', style: 'width:10px;height:10px' }))),
      h('span', { class: 'phone-only' }, e.playBtnPhone),
      h('button', { class: 'icon-btn phone-only dice-btn', 'aria-label': 'Randomise tracks', 'data-tip': HINTS.randomise, onclick: () => this.randomise() }, dice(22)),
      h('button', { class: 'icon-btn phone-only', 'aria-label': 'More', 'data-tip': HINTS.menu, onclick: () => this.openMenu() }, '⋯'),
    );
  }

  /** BPM/swing readouts: drag vertically, wheel, double-click to type. */
  private dragReadout(el: HTMLElement, path: 'bpm' | 'swing', perPx: number): HTMLElement {
    const def = PARAMS[path];
    let start: { y: number; v: number } | null = null;
    el.addEventListener('pointerdown', (ev) => {
      if (path === 'bpm' && this.state.clock === 'external') return;
      start = { y: ev.clientY, v: def.get(this.state, 0) };
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    });
    el.addEventListener('pointermove', (ev) => {
      if (!start) return;
      const v = Math.max(def.min, Math.min(def.max, start.v + (start.y - ev.clientY) * perPx));
      const q = path === 'bpm' ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
      if (q !== def.get(this.state, 0)) this.store.update((s) => def.set(s, 0, q), { coalesce: path });
    });
    el.addEventListener('pointerup', () => (start = null));
    el.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const step = path === 'bpm' ? (ev.shiftKey ? 0.1 : 1) : 0.01;
      const v = Math.max(def.min, Math.min(def.max, def.get(this.state, 0) - Math.sign(ev.deltaY) * step));
      this.store.update((s) => def.set(s, 0, Math.round(v * 100) / 100), { coalesce: path });
    }, { passive: false });
    if (path === 'bpm') {
      el.addEventListener('dblclick', () => {
        if (this.state.clock === 'external') return;
        const input = h('input', { type: 'number', step: '0.1', min: 40, max: 200, value: this.state.bpm.toFixed(1), 'aria-label': 'Tempo' });
        const big = el.querySelector('.big');
        big?.replaceWith(input);
        input.focus();
        input.select();
        const done = () => {
          const v = Number(input.value);
          if (v >= 40 && v <= 200) this.store.update((s) => (s.bpm = Math.round(v * 10) / 10));
          input.replaceWith(big!);
        };
        input.addEventListener('blur', done, { once: true });
        input.addEventListener('keydown', (k) => k.key === 'Enter' && input.blur());
      });
    }
    return el;
  }

  private buildZoomHead(): HTMLElement {
    const e = this.els;
    e.zhName = h('span', { class: 'tname' });
    e.zhM = h('button', { class: 'ms', 'data-tip': HINTS.mute, onclick: () => this.toggleMute(this.focus) }, 'M');
    e.zhS = h('button', { class: 'ms', 'data-tip': HINTS.solo, onclick: () => this.toggleSolo(this.focus) }, 'S');
    return h('div', { class: 'zoom-head' }, h('button', { class: 'icon-btn', 'aria-label': 'Back to island', 'data-tip': HINTS.back, onclick: () => this.back() }, '←'), e.zhName, h('span', { class: 'sp' }), e.zhM, e.zhS);
  }

  private buildOverview(): HTMLElement[] {
    const e = this.els;
    e.band = h('section', { class: 'band v-over desk-only', 'aria-label': 'Harmony' });
    e.bandPhone = h('button', { class: 'band-line v-over phone-only', 'aria-label': 'Harmony details', onclick: () => this.openBandSheet() });

    e.overviewCanvas = h('canvas', { 'aria-label': 'Floating island with one plinth per track. Click a plinth to zoom.', role: 'img' });
    e.overviewCanvas.addEventListener('click', (ev) => {
      const r = e.overviewCanvas.getBoundingClientRect();
      const i = this.overview.pick(ev.clientX - r.left, ev.clientY - r.top);
      if (i >= 0) this.zoom(i);
    });
    e.overviewCanvas.addEventListener('pointermove', (ev) => {
      const r = e.overviewCanvas.getBoundingClientRect();
      e.overviewCanvas.style.cursor = this.overview.pick(ev.clientX - r.left, ev.clientY - r.top) >= 0 ? 'pointer' : 'default';
    });
    const island = h('div', { class: 'island-wrap' }, e.overviewCanvas, h('div', { class: 'island-hint' }, 'tap a plinth to zoom'));

    // journey
    const jf = (path: string, label: string, color: 'pink' | 'blue' = 'pink') => {
      const f = new Fader(this.faderHost(() => -1), { path, label, color, tip: hintFor(path) });
      this.faders.push(f);
      return f.el;
    };
    e.elapsed = h('span', { class: 'n time' });
    e.journeyStatus = h('span', { class: 'status' });
    const journey = h(
      'aside',
      { class: 'journey collapsed-able', 'aria-label': 'Journey' },
      h(
        'div',
        { class: 'jh' },
        h('span', { class: 'cap' }, 'journey'),
        h('button', { class: 'toggle', 'aria-expanded': 'true', onclick: (ev: Event) => {
          journey.classList.toggle('collapsed');
          const b = ev.currentTarget as HTMLElement;
          b.textContent = journey.classList.contains('collapsed') ? 'journey ▸' : 'journey ▾';
          b.setAttribute('aria-expanded', String(!journey.classList.contains('collapsed')));
        } }, 'journey ▾'),
        e.elapsed,
      ),
      h(
        'div',
        { class: 'grid' },
        jf('journey.pace', 'pace'),
        jf('journey.home', 'home'),
        jf('journey.weather', 'weather'),
        jf('journey.breathe', 'breathe'),
        jf('journey.rest', 'rest'),
        jf('journey.wander', 'wander'),
        jf('journey.voices', 'voices', 'blue'),
        jf('journey.notesPerBar', 'notes/bar', 'blue'),
      ),
      e.journeyStatus,
    );

    e.cards = h('div', { class: 'cards' });
    const strip = h(
      'section',
      { class: 'strip v-over', 'aria-label': 'Tracks' },
      h(
        'div',
        { class: 'strip-head' },
        h('span', { class: 'cap' }, 'tracks'),
        h(
          'div',
          { class: 'acts' },
          h('button', { class: 'pill', 'data-tip': HINTS.muteAll, onclick: () => this.muteAll() }, 'mute all'),
          h('button', { class: 'pill', 'data-tip': HINTS.soloAll, onclick: () => this.soloAll() }, 'solo all'),
          h('button', { class: 'pill dashed add', 'data-tip': HINTS.add, onclick: () => this.addTrack() }, '+ add plinth'),
        ),
      ),
      e.cards,
    );

    const main = h('div', { class: 'main-row v-over' }, island, journey);
    return [e.band, e.bandPhone, main, strip];
  }

  private buildZoom(): HTMLElement[] {
    const e = this.els;
    e.bandMini = h('section', { class: 'band-mini v-zoom', 'aria-label': 'Harmony' });
    e.crumbName = h('span', { class: 'tname' });
    e.crumbMeta = h('span', { class: 'sub n', style: 'font-size:14px' });
    e.tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Jump to track' });
    const crumbs = h(
      'div',
      { class: 'crumbs v-zoom' },
      h('div', { class: 'title' }, h('button', { class: 'pill', 'data-tip': HINTS.back, onclick: () => this.back() }, '← island'), e.crumbName, e.crumbMeta),
      e.tabs,
    );
    e.stageCanvas = h('canvas', { role: 'img', 'aria-label': 'Zoomed plinth' });
    e.capL = h('span', { class: 'cap-l' });
    e.capR = h('span', { class: 'cap-r' });
    e.dots = h('div', { class: 'dots', 'aria-hidden': 'true' });
    const stage = h('div', { class: 'stage v-zoom' }, e.stageCanvas, e.capL, e.capR, e.dots);
    this.bindStageGestures(e.stageCanvas);
    e.panel = h('section', { class: 'panel v-zoom', 'data-tab': this.zoomTab, 'aria-label': 'Track settings' });
    return [e.bandMini, crumbs, stage, e.panel];
  }

  private bindStageGestures(c: HTMLElement): void {
    let start: { x: number; y: number; t: number } | null = null;
    c.addEventListener('pointerdown', (ev) => (start = { x: ev.clientX, y: ev.clientY, t: performance.now() }));
    c.addEventListener('pointerup', (ev) => {
      if (!start) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      const n = this.state.tracks.length;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        this.setFocus((this.focus + (dx < 0 ? 1 : -1) + n) % n);
      } else if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
        const r = c.getBoundingClientRect();
        const i = this.stage.pick(ev.clientX - r.left, ev.clientY - r.top);
        if (i >= 0 && i !== this.focus) this.setFocus(i);
      }
      start = null;
    });
  }

  // ================================================================ zoom panel

  private buildPanel(): void {
    const e = this.els;
    const st = this.state;
    const i = this.focus;
    const tr = st.tracks[i];
    if (!tr) return;
    this.zoomFaders = [];
    const zf = (path: string, label: string, color: 'pink' | 'blue' = 'pink') => {
      const f = new Fader(this.faderHost(() => this.focus), { path, label, color, tip: hintFor(path, this.state.tracks[this.focus]?.mode) });
      this.zoomFaders.push(f);
      return f.el;
    };
    const up = (fn: (s: AppState) => void) => this.store.update(fn);
    const T = (s: AppState) => s.tracks[this.focus];

    const tabbar = h('div', { class: 'tabbar', role: 'tablist' });
    for (const [id, label] of [
      ['mode', 'Mode'],
      ['motion', 'Motion'],
      ['notes', 'Notes'],
      ['midi', 'MIDI'],
    ] as [ZoomTab, string][]) {
      tabbar.append(
        h('button', { role: 'tab', class: this.zoomTab === id ? 'on' : '', 'aria-selected': String(this.zoomTab === id), onclick: () => {
          this.zoomTab = id;
          e.panel.dataset.tab = id;
          tabbar.querySelectorAll('button').forEach((b) => toggle(b, 'on', b.textContent === label));
        } }, label),
      );
    }

    // MODE
    const chips = h('div', { class: 'chips' });
    for (const m of MODE_IDS) {
      chips.append(h('button', { class: `pill ${tr.mode === m ? 'on' : ''}`, 'aria-pressed': String(tr.mode === m), 'data-tip': MODE_BLURB[m], onclick: () => up((s) => {
        const t = T(s);
        if (t.mode !== m) {
          t.mode = m;
          t.modeParams = defaultModeParams(m);
        }
      }) }, m));
    }
    const modeFaders = h('div', { class: 'faders' });
    for (const p of MODE_PARAMS[tr.mode]) modeFaders.append(zf(`mode.${p.key}`, p.label, 'blue'));
    const listenOpts: [string, string][] = [['-1', 'none'], ...st.tracks.map((_t, k) => [String(k), pad2(k + 1)] as [string, string]).filter(([k]) => Number(k) !== i)];
    const listen = h(
      'div',
      { class: 'listen' },
      this.box('listen', tr.listen.source < 0 ? 'none' : pad2(tr.listen.source + 1), listenOpts, String(tr.listen.source), (v) => up((s) => (T(s).listen.source = Number(v)))),
      this.box('amount', tr.listen.amount.toFixed(2), ['0.25', '0.5', '0.75', '1'].map((x) => [x, x] as [string, string]), String(tr.listen.amount), (v) => up((s) => (T(s).listen.amount = Number(v)))),
    );
    const colMode = h(
      'div',
      { class: 'col col-mode' },
      h('span', { class: 'cap' }, 'mode'),
      chips,
      modeFaders,
      listen,
      st.tracks.length > 1 ? h('button', { class: 'pill sm remove', 'data-tip': HINTS.remove, onclick: () => this.removeTrack(this.focus) }, 'remove plinth') : null,
    );

    // MOTION
    const colMotion = h(
      'div',
      { class: 'col col-motion' },
      h('span', { class: 'cap' }, 'motion'),
      h('div', { class: 'faders' }, zf('macros.intensity', 'intensity'), zf('macros.color', 'color'), zf('macros.rotation', 'rotation'), zf('macros.randomness', 'random')),
    );

    // NOTES
    const n = tr.notes;
    const seg = (opts: [string, string][], cur: string, set: (v: string) => void, label: string) =>
      h('div', { class: 'seg', role: 'group', 'aria-label': label, 'data-tip': label === 'Track kind' ? HINTS.kind : HINTS.voice }, ...opts.map(([v, l]) => h('button', { class: cur === v ? 'on' : '', 'aria-pressed': String(cur === v), onclick: () => set(v) }, l)));
    const segs = h(
      'div',
      { class: 'segs' },
      seg([['tonal', 'tonal'], ['drum', 'drum']], n.kind, (v) => up((s) => (T(s).notes.kind = v as 'tonal' | 'drum')), 'Track kind'),
      n.kind === 'tonal' ? seg([['mono', 'mono'], ['chord', 'chord'], ['root', 'root']], n.voice, (v) => up((s) => (T(s).notes.voice = v as 'mono' | 'chord' | 'root')), 'Voicing') : null,
    );
    const noteOpts = (lo: number, hi: number): [string, string][] => Array.from({ length: hi - lo + 1 }, (_, k) => [String(lo + k), noteName(lo + k)]);
    let notesBody: HTMLElement;
    if (n.kind === 'tonal') {
      const rangeBox = h(
        'div',
        { class: 'box', 'data-tip': HINTS.range },
        h('div', { class: 'bl tip-label' }, 'range'),
        h('div', { class: 'bv' }, this.inlineSelect(noteOpts(24, 96), String(n.low), (v) => up((s) => {
          T(s).notes.low = Math.min(Number(v), T(s).notes.high - 1);
        }), 'Range low'), ' – ', this.inlineSelect(noteOpts(24, 108), String(n.high), (v) => up((s) => {
          T(s).notes.high = Math.max(Number(v), T(s).notes.low + 1);
        }), 'Range high')),
      );
      const stepRow = h('div', { class: 'row' });
      for (let k = 1; k <= 7; k++) {
        const on = n.steps.includes(k);
        stepRow.append(h('button', { class: `pill ${on ? 'on' : ''}`, 'aria-pressed': String(on), onclick: () => up((s) => {
          const t = T(s);
          const has = t.notes.steps.includes(k);
          if (has && t.notes.steps.length === 1) return;
          t.notes.steps = has ? t.notes.steps.filter((x) => x !== k) : [...t.notes.steps, k].sort((a, b) => a - b);
        }) }, String(k)));
      }
      e.poolBox = h('div', { class: 'bv' }, poolLabel(tr.macros.color));
      notesBody = h(
        'div',
        { style: 'display:flex;flex-direction:column;gap:16px' },
        h(
          'div',
          { class: 'boxes2' },
          h('div', { class: 'box static', 'data-tip': HINTS.pool }, h('div', { class: 'bl tip-label' }, 'pool'), e.poolBox),
          rangeBox,
          this.box('transpose', `${n.transpose >= 0 ? '+' : ''}${n.transpose} steps`, Array.from({ length: 15 }, (_, k) => [String(k - 7), `${k - 7 >= 0 ? '+' : ''}${k - 7} steps`]), String(n.transpose), (v) => up((s) => (T(s).notes.transpose = Number(v)))),
          this.box('octave', `${n.octave >= 0 ? '+' : ''}${n.octave}`, Array.from({ length: 7 }, (_, k) => [String(k - 3), `${k - 3 >= 0 ? '+' : ''}${k - 3}`]), String(n.octave), (v) => up((s) => (T(s).notes.octave = Number(v)))),
        ),
        h('div', { class: 'steps', 'data-tip': HINTS.steps }, h('span', { class: 'lbl tip-label' }, 'interval steps'), stepRow),
      );
    } else {
      notesBody = h(
        'div',
        { style: 'display:flex;flex-direction:column;gap:16px' },
        h(
          'div',
          { class: 'boxes2' },
          this.box('base note', noteName(n.drumNote), noteOpts(24, 96), String(n.drumNote), (v) => up((s) => (T(s).notes.drumNote = Number(v)))),
          this.box('spread', `±${n.drumSpread}`, Array.from({ length: 13 }, (_, k) => [String(k), `±${k}`]), String(n.drumSpread), (v) => up((s) => (T(s).notes.drumSpread = Number(v)))),
          this.box('accent above', n.accent.toFixed(2), ['0.5', '0.6', '0.7', '0.8', '0.9', '1'].map((x) => [x, Number(x).toFixed(2)] as [string, string]), String(n.accent), (v) => up((s) => (T(s).notes.accent = Number(v)))),
          h('div', { class: 'box static', 'data-tip': 'Drum tracks ignore the harmony: they always send their base note (± spread).' }, h('div', { class: 'bl tip-label' }, 'harmony'), h('div', { class: 'bv' }, 'ignored')),
        ),
        h('span', { class: 'hint' }, 'color widens the pitch spread; strong hits accent, weak hits ghost'),
      );
    }
    const colNotes = h('div', { class: 'col col-notes' }, h('span', { class: 'cap' }, 'notes'), segs, notesBody);

    // MIDI & LIFE
    const m = tr.midi;
    const velIdx = VEL_PRESETS.findIndex(([a, b]) => a === m.velLow && b === m.velHigh);
    const velOpts: [string, string][] = VEL_PRESETS.map(([a, b], k) => [String(k), `${a}–${b}`]);
    if (velIdx < 0) velOpts.unshift(['-1', `${m.velLow}–${m.velHigh}`]);
    const colMidi = h(
      'div',
      { class: 'col col-midi' },
      h('span', { class: 'cap' }, 'MIDI & life'),
      h(
        'div',
        { class: 'boxes3' },
        this.box('channel', String(m.channel), Array.from({ length: 16 }, (_, k) => [String(k + 1), String(k + 1)]), String(m.channel), (v) => up((s) => (T(s).midi.channel = Number(v)))),
        this.box('division', m.division, DIVISIONS.map((x) => [x, x]), m.division, (v) => up((s) => (T(s).midi.division = v as (typeof DIVISIONS)[number]))),
        this.box('swing', m.swing ? 'on' : 'off', [['on', 'on'], ['off', 'off']], m.swing ? 'on' : 'off', (v) => up((s) => (T(s).midi.swing = v === 'on'))),
        this.box('gate', m.gate, GATES.map((x) => [x, x]), m.gate, (v) => up((s) => (T(s).midi.gate = v as (typeof GATES)[number]))),
        this.box('velocity', `${m.velLow}–${m.velHigh}`, velOpts, String(velIdx), (v) => {
          const k = Number(v);
          if (k >= 0) up((s) => ([T(s).midi.velLow, T(s).midi.velHigh] = VEL_PRESETS[k]));
        }),
        this.box('chance', `${Math.round(m.chance * 100)}%`, Array.from({ length: 10 }, (_, k) => [String((10 - k) / 10), `${(10 - k) * 10}%`]), String(m.chance), (v) => up((s) => (T(s).midi.chance = Number(v)))),
      ),
      h('div', { class: 'faders life' }, zf('life.breathe', 'breathe', 'blue'), zf('life.swell', 'swell', 'blue'), zf('life.rest', 'rest', 'blue'), zf('life.wander', 'wander', 'blue')),
    );

    e.foot = h('span', { class: 'foot n' });
    e.panel.replaceChildren(tabbar, colMode, colMotion, colNotes, colMidi, e.foot);
    e.panel.dataset.tab = this.zoomTab;
    for (const f of this.zoomFaders) f.update(st);
  }

  /** Labelled value box with a transparent native select over it (native pickers on phones). */
  private box(label: string, value: string, options: [string, string][], current: string, onChange: (v: string) => void): HTMLElement {
    const sel = h('select', { 'aria-label': label, onchange: (ev: Event) => onChange((ev.target as HTMLSelectElement).value) });
    for (const [v, l] of options) sel.append(h('option', { value: v, selected: v === current }, l));
    const tip = HINTS[BOX_TIPS[label] ?? label] || null;
    return h('div', { class: 'box', 'data-tip': tip }, h('div', { class: `bl${tip ? ' tip-label' : ''}` }, label), h('div', { class: 'bv' }, value), sel);
  }

  private inlineSelect(options: [string, string][], current: string, onChange: (v: string) => void, label: string): HTMLSelectElement {
    const sel = h('select', { 'aria-label': label, onchange: (ev: Event) => onChange((ev.target as HTMLSelectElement).value) });
    for (const [v, l] of options) sel.append(h('option', { value: v, selected: v === current }, l));
    return sel;
  }

  // ================================================================ update

  update(): void {
    const st = this.state;
    if (this.focus >= st.tracks.length) this.focus = st.tracks.length - 1;
    this.d.engine.focus = this.view === 'zoom' ? this.focus : -1;
    const e = this.els;
    // header
    const ext = st.clock === 'external';
    const bpm = ext && this.d.follower.tempo ? this.d.follower.tempo : st.bpm;
    setText(e.bpm, bpm.toFixed(1));
    setText(e.bpmPhone, String(Math.round(bpm)));
    setText(e.swing, `${Math.round(st.swing * 100)}%`);
    this.updatePort();
    this.updateSnaps();
    this.updateRec();
    // faders
    this.updateFaders();
    // strip
    this.renderStrip();
    // zoom
    const key = `${this.focus}|${st.tracks.length}|${JSON.stringify(st.tracks[this.focus]?.notes)}|${st.tracks[this.focus]?.mode}|${JSON.stringify(st.tracks[this.focus]?.midi)}|${JSON.stringify(st.tracks[this.focus]?.listen)}|${st.tracks.length}`;
    if (key !== this.panelKey) {
      this.panelKey = key;
      this.buildPanel();
    }
    this.updateZoomChrome();
    this.lastHarmonyRender = 0;
  }

  private updateFaders(): void {
    for (const f of this.faders) f.update(this.state);
    for (const f of this.zoomFaders) f.update(this.state);
  }

  private updatePort(): void {
    const e = this.els;
    const outs = this.d.midi.outputs();
    const cur = outs.find((o) => o.id === this.state.outputId);
    const sel = h('select', { 'aria-label': 'MIDI output', onchange: (ev: Event) => this.selectOutput((ev.target as HTMLSelectElement).value) });
    sel.append(h('option', { value: '', selected: !cur }, 'sine preview'));
    for (const o of outs) sel.append(h('option', { value: o.id, selected: o.id === this.state.outputId }, o.name));
    e.port.replaceChildren(h('span', { class: `dot ${cur ? '' : 'off'}` }), cur ? shortPort(cur.name) : 'sine preview', sel);
  }

  private updateSnaps(): void {
    const e = this.els;
    e.restoreDots.replaceChildren(
      ...this.snaps.slice(0, Math.max(3, this.snaps.filter(Boolean).length + 1)).map((sn, k) => {
        const b = h('button', {
          class: sn ? 'full' : '',
          style: 'all:unset;width:6px;height:6px;border-radius:50%;cursor:pointer;' + (sn ? 'background:#E5C9D7' : 'border:1px solid #83A6CE'),
          'aria-label': sn ? `Restore snapshot ${k + 1}` : `Empty slot ${k + 1}`,
          'data-tip': sn ? `snap ${k + 1}: click to restore · long-press to keep as a scene` : `slot ${k + 1}: empty`,
          onclick: (ev: Event) => {
            ev.stopPropagation();
            if (sn) this.restore(k);
          },
        });
        let timer: ReturnType<typeof setTimeout> | null = null;
        b.addEventListener('pointerdown', () => (timer = setTimeout(() => sn && this.saveSnapAsScene(k), 600)));
        b.addEventListener('pointerup', () => timer && clearTimeout(timer));
        return b;
      }),
    );
  }

  private renderStrip(): void {
    const st = this.state;
    const key = JSON.stringify([this.focus, this.view, st.tracks.map((t) => [t.mode, t.notes.kind, t.notes.voice, t.midi.channel, t.midi.division, t.mute, t.solo])]);
    if (key === this.stripKey) return;
    this.stripKey = key;
    const e = this.els;
    e.cards.replaceChildren(
      ...st.tracks.map((t, i) => {
        const card = h(
          'div',
          {
            class: `card ${i === this.focus ? 'focus' : ''} ${t.mute ? 'muted' : ''}`,
            role: 'button',
            tabindex: 0,
            'aria-label': `Track ${pad2(i + 1)} ${t.mode}: open`,
            onclick: () => this.zoom(i),
            onkeydown: (ev: Event) => (ev as KeyboardEvent).key === 'Enter' && this.zoom(i),
          },
          h('div', { class: 'ct' }, h('span', { class: 'n num' }, pad2(i + 1)), h('span', { class: 'act', 'data-act': i })),
          h('span', { class: 'nm' }, t.mode),
          h('span', { class: 'meta n', 'data-meta': i }, this.cardMeta(i)),
          h(
            'div',
            { class: 'cb' },
            h('button', { class: `ms ${t.mute ? 'm-on' : ''}`, 'aria-pressed': String(t.mute), 'aria-label': `Mute ${pad2(i + 1)}`, 'data-tip': HINTS.mute, onclick: (ev: Event) => (ev.stopPropagation(), this.toggleMute(i)) }, 'M'),
            h('button', { class: `ms ${t.solo ? 's-on' : ''}`, 'aria-pressed': String(t.solo), 'aria-label': `Solo ${pad2(i + 1)}`, 'data-tip': HINTS.solo, onclick: (ev: Event) => (ev.stopPropagation(), this.toggleSolo(i)) }, 'S'),
          ),
        );
        return card;
      }),
    );
  }

  private cardMeta(i: number): string {
    const t = this.state.tracks[i];
    const parts: string[] = [t.notes.kind];
    if (t.notes.kind === 'tonal' && t.notes.voice !== 'mono') parts.push(t.notes.voice);
    parts.push(String(t.midi.channel), t.midi.division);
    if (this.d.engine.journey.isResting(i) && !t.mute) parts.push('resting');
    return parts.join(' · ');
  }

  private updateZoomChrome(): void {
    const e = this.els;
    const st = this.state;
    const t = st.tracks[this.focus];
    if (!t) return;
    const nameNodes = () => [h('span', { class: 'n' }, pad2(this.focus + 1)), ` ${t.mode}`];
    e.crumbName.replaceChildren(...nameNodes());
    e.zhName.replaceChildren(...nameNodes());
    setText(e.crumbMeta, `ch ${t.midi.channel} · ${t.midi.division} · ${t.notes.kind === 'drum' ? 'drum' : t.notes.voice}`);
    e.tabs.replaceChildren(
      ...st.tracks.map((x, i) => h('button', { class: `tab ${i === this.focus ? 'on' : ''}`, 'aria-current': i === this.focus ? 'true' : null, 'data-tip': `Track ${pad2(i + 1)} · ${x.mode} (key ${i + 1 <= 9 ? i + 1 : '—'})`, onclick: () => this.setFocus(i) }, pad2(i + 1))),
      h('span', { style: 'width:16px' }),
      h('button', { class: `ms ${t.mute ? 'm-on' : ''}`, 'aria-pressed': String(t.mute), 'data-tip': HINTS.mute, onclick: () => this.toggleMute(this.focus) }, 'M'),
      h('button', { class: `ms ${t.solo ? 's-on' : ''}`, 'aria-pressed': String(t.solo), 'data-tip': HINTS.solo, onclick: () => this.toggleSolo(this.focus) }, 'S'),
    );
    toggle(e.zhM, 'm-on', t.mute);
    toggle(e.zhS, 's-on', t.solo);
    e.dots.replaceChildren(...st.tracks.map((_x, i) => h('span', { class: i === this.focus ? 'on' : '' })));
    if (e.poolBox) setText(e.poolBox, poolLabel(t.macros.color));
    const n = st.tracks.length;
    if (e.foot) setText(e.foot, `ch ${t.midi.channel} · ${t.midi.division} · ${t.notes.kind} ${t.notes.kind === 'tonal' ? t.notes.voice : ''} · swipe stage for ${pad2(((this.focus - 1 + n) % n) + 1)} / ${pad2(((this.focus + 1) % n) + 1)}`);
  }

  // ================================================================ frame

  frame(now: number): void {
    const phone = window.matchMedia('(max-width: 699px)').matches;
    if (phone && now - this.lastFrame < 31) return;
    this.lastFrame = now;
    const eng = this.d.engine;
    const e = this.els;
    eng.prepareView(now / 1000);
    if (this.view === 'overview') this.overview.render(now);
    else this.stage.render(now);

    // readouts
    const pos = eng.positionAt(now / 1000);
    const bar = Math.floor(pos / 4) + 1;
    const beat = Math.floor(pos % 4) + 1;
    setText(e.bar, (eng.playing ? `bar ${bar} · ${beat}` : 'bar 1 · 1') + (this.state.clock === 'external' ? ' · ext clock' : ''));
    const sec = Math.floor(eng.playing ? pos * eng.beatSec : 0);
    setText(e.elapsed, `${Math.floor(sec / 3600)}:${pad2(Math.floor(sec / 60) % 60)}:${pad2(sec % 60)}`);
    const resting = this.state.tracks.map((_t, i) => i).filter((i) => eng.journey.isResting(i) && !this.state.tracks[i].mute);
    const restText = !resting.length
      ? ''
      : resting.length <= 2
        ? ` · ${resting.map((i) => pad2(i + 1)).join(', ')} resting ${eng.journey.tracks[resting[0]]?.restBars ?? 0} more bars`
        : ` · ${resting.length} of ${this.state.tracks.length} resting`;
    setText(e.journeyStatus, `weather: ${eng.journey.weatherLabel()}${restText}`);
    toggle(e.playBtn, 'playing', eng.playing);
    for (const b of [e.playBtn, e.playBtnPhone]) {
      const want = eng.playing ? 'sq' : 'tri';
      if (b.firstElementChild?.className !== want) {
        b.replaceChildren(h('span', { class: want }));
        b.setAttribute('aria-label', eng.playing ? 'Stop' : 'Play');
      }
    }
    const rec = this.d.recorder.recording || this.d.preview.taping;
    toggle(e.recBtn, 'recording', rec);
    toggle(e.recPhone, 'recording', rec);
    if (rec) e.recPhone.style.background = '#C48CB3';
    else e.recPhone.style.background = '';

    // activity ticks + resting meta
    const t = now / 1000;
    e.cards.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
      const i = Number(el.dataset.act);
      const ln = eng.lastNote[i] ?? -1;
      toggle(el, 'on', ln > 0 && t >= ln && t - ln < 0.15);
    });
    e.cards.querySelectorAll<HTMLElement>('[data-meta]').forEach((el) => setText(el, this.cardMeta(Number(el.dataset.meta))));

    // harmony (cheap enough at 4 Hz)
    if (now - this.lastHarmonyRender > 250) {
      this.lastHarmonyRender = now;
      const host = {
        store: this.store,
        harmony: () => eng.harmony,
        rewind: (i: number) => this.rewind(i),
        openKey: () => this.openKey(),
        newSeed: () => this.store.update((s) => (s.harmony.seed = Math.floor(Math.random() * 9000) + 1000)),
      };
      if (this.view === 'overview') {
        if (!phone) renderBand(e.band, host);
        else renderPhoneBand(e.bandPhone, eng.harmony, this.state.harmony.holdScale);
        if (this.els.sheetBand) renderBand(this.els.sheetBand, host);
      } else renderMiniBand(e.bandMini, eng.harmony, this.state.harmony.holdScale);
    }

    // zoom captions
    if (this.view === 'zoom') this.updateCaptions(t);
    // takeover ghosts
    if (this.d.map.ghosts.size) this.updateFaders();
  }

  private updateCaptions(t: number): void {
    const eng = this.d.engine;
    const v = eng.voices[this.focus];
    const tr = this.state.tracks[this.focus];
    if (!v || !tr) return;
    let left = '';
    switch (v.mode) {
      case 'wind': {
        const w = v as unknown as { gustLevel: number };
        left = `gust ${w.gustLevel.toFixed(2)} · ${eng.journey.weatherTrend > 0 ? 'rising' : 'easing'}`;
        break;
      }
      case 'drops':
        left = `${(v as unknown as { drops: unknown[] }).drops.length} drops falling`;
        break;
      case 'rockfall':
        left = `${(v as unknown as { rocks: unknown[] }).rocks.length} rocks in motion`;
        break;
      case 'waves':
        left = `amplitude ${(eng.journey.macros(this.focus, this.state, 0).intensity).toFixed(2)}`;
        break;
      case 'pendulum':
        left = `${v.slots()} pendulums · +${tr.modeParams.spread ?? 1} step spread`;
        break;
      case 'orbits':
        left = `ratios ${MODE_PARAMS.orbits[0].fmt!(tr.modeParams.ratios)} · ${tr.modeParams.rays} rays`;
        break;
    }
    if (!eng.audible(this.focus)) left += tr.mute ? ' · muted' : eng.journey.isResting(this.focus) ? ' · resting' : ' · not soloed';
    setText(this.els.capL, left);
    const info = eng.lastNoteInfo[this.focus];
    setText(this.els.capR, info && t - info.time < 4 ? `${SLOT_WORD[v.mode]} ${info.slot + 1} → ${info.notes} · vel ${info.vel}` : '');
  }

  // ================================================================ actions

  togglePlay(): void {
    const eng = this.d.engine;
    const now = performance.now() / 1000;
    this.d.preview.resume();
    if (eng.playing) {
      eng.stop(now);
      this.onStop?.();
    } else {
      if (this.state.clock === 'external') {
        this.toast('waiting for clock start from the external device');
        return;
      }
      eng.start(now);
      this.onPlay?.();
    }
  }

  onPlay: (() => void) | null = null;
  onStop: (() => void) | null = null;

  zoom(i: number): void {
    const was = this.view;
    this.focus = i;
    this.view = 'zoom';
    document.body.dataset.view = 'zoom';
    this.d.map.resetPickup((m) => m.target.scope === 'focus');
    this.update();
    requestAnimationFrame(() => {
      this.stage.resize();
      this.stage.focus = i;
      if (was === 'overview') this.stage.zoomIn(i, performance.now());
      window.scrollTo({ top: 0 });
    });
  }

  back(): void {
    this.view = 'overview';
    document.body.dataset.view = 'overview';
    this.update();
    requestAnimationFrame(() => this.overview.resize());
  }

  setFocus(i: number): void {
    if (i === this.focus) return;
    this.focus = i;
    this.stage.setFocus(i, performance.now());
    this.d.map.resetPickup((m) => m.target.scope === 'focus');
    this.update();
  }

  toggleMute(i: number): void {
    this.store.update((s) => (s.tracks[i].mute = !s.tracks[i].mute));
  }

  toggleSolo(i: number): void {
    this.store.update((s) => (s.tracks[i].solo = !s.tracks[i].solo));
  }

  muteAll(): void {
    const all = this.state.tracks.every((t) => t.mute);
    this.store.update((s) => s.tracks.forEach((t) => (t.mute = !all)));
  }

  soloAll(): void {
    const all = this.state.tracks.every((t) => t.solo);
    this.store.update((s) => s.tracks.forEach((t) => (t.solo = !all)));
  }

  /** Make a link that carries this setup (in the URL fragment), copy it, and offer the system share sheet. */
  async openShare(): Promise<void> {
    const url = shareURL(location.href, await encodeShare(this.state));
    const field = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Share link' });
    const copy = async (): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(url);
        return true;
      } catch {
        field.select();
        try {
          return document.execCommand('copy');
        } catch {
          return false;
        }
      }
    };
    const canShare = typeof navigator.share === 'function';
    const el = this.sheet(
      'share',
      h('div', { class: 'scene' }, field, h('button', { class: 'pill on', onclick: async () => this.toast((await copy()) ? 'link copied' : 'select the link and copy it') }, 'copy')),
      canShare ? h('div', { class: 'btns' }, h('button', { class: 'pill', onclick: () => navigator.share({ title: 'Cycloom — Generative MIDI Sequencer', url }).catch(() => {}) }, 'share…')) : null,
      h('span', { class: 'note' }, `This link (${url.length} characters) contains the tracks, harmony settings, journey and tempo. Device settings, controller mappings and mute/solo states are excluded. Nothing is uploaded.`),
    );
    void el;
    field.focus();
    field.select();
    if (await copy()) this.toast('link copied');
  }

  /** Open a shared setup (from a link). Undoable; keeps this device's MIDI settings. */
  async loadShared(code: string): Promise<boolean> {
    const st = await decodeShare(code, this.state);
    if (!st) {
      this.toast('that share link could not be read');
      return false;
    }
    this.store.update((s) => Object.assign(s, st));
    this.sceneName = '';
    this.update();
    this.toast('opened shared setup', 'undo', () => this.undo());
    return true;
  }

  /** Save the current state as a named scene, or download it as a file. */
  openSave(): void {
    const scenes = this.d.persist.scenes();
    const name = h('input', { type: 'text', placeholder: 'scene name', value: this.sceneName || `scene ${Object.keys(scenes).length + 1}`, 'aria-label': 'Scene name' });
    const save = () => {
      const n = name.value.trim();
      if (!n) return;
      this.d.persist.saveScene(n, { state: structuredClone(this.state), engine: this.d.engine.snapshot(), at: Date.now() });
      this.sceneName = n;
      el.remove();
      this.toast(scenes[n] ? `updated “${n}”` : `saved “${n}”`);
    };
    name.addEventListener('keydown', (k) => (k as KeyboardEvent).key === 'Enter' && save());
    const el = this.sheet(
      'save',
      h('div', { class: 'scene' }, name, h('button', { class: 'pill on', onclick: save }, 'save scene')),
      h('span', { class: 'note' }, 'A scene saves the tracks, harmony position, journey and tempo in this browser. Export a JSON file to keep a separate copy of your settings and controller mappings.'),
      h('span', { class: 'cap' }, 'file'),
      h('div', { class: 'btns' }, h('button', { class: 'pill', onclick: () => {
        const blob = new Blob([exportJSON(this.state, this.d.map.toJSON())], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: `cycloom-${this.state.harmony.seed}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } }, 'export JSON')),
    );
    name.focus();
    name.select();
  }

  /** Load a saved scene or an exported file. */
  openLoad(): void {
    const scenes = this.d.persist.scenes();
    const list = h('div', { class: 'scenes' });
    const names = Object.entries(scenes).sort((x, y) => y[1].at - x[1].at);
    for (const [name, sn] of names) {
      list.append(
        h(
          'div',
          { class: 'scene' },
          h('span', { class: 'nm' }, name),
          h('span', { class: 'sub', style: 'font-size:12px' }, new Date(sn.at).toLocaleDateString()),
          h('button', { class: 'pill sm', onclick: () => {
            this.applySnapshot(sn);
            this.sceneName = name;
            this.update();
            el.remove();
            this.toast(`loaded “${name}”`, 'undo', () => this.undo());
          } }, 'load'),
          h('button', { class: 'pill sm', 'aria-label': `Delete ${name}`, onclick: () => {
            this.d.persist.deleteScene(name);
            el.remove();
            this.openLoad();
            this.toast(`deleted “${name}”`);
          } }, 'delete'),
        ),
      );
    }
    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr', 'aria-label': 'Import JSON' });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files?.[0];
      if (!f) return;
      const res = importJSON(await f.text());
      if (!res) return this.toast('could not read that file');
      this.store.replace({ ...res.state, outputId: this.state.outputId, inputId: this.state.inputId });
      if (res.mappings.length) this.d.map.load(res.mappings);
      el.remove();
      this.toast('session imported', 'undo', () => this.undo());
    });
    const el = this.sheet(
      'load',
      names.length ? list : h('span', { class: 'note' }, 'No saved scenes yet. Choose save scene, or long-press a snapshot dot to save it as a scene.'),
      h('span', { class: 'cap' }, 'file'),
      h('div', { class: 'btns' }, h('button', { class: 'pill', onclick: () => fileIn.click() }, 'import JSON'), fileIn),
    );
  }

  /** Preset picker: replaces tracks, harmony, journey and tempo; keeps MIDI ports and clock. Undoable. */
  openPresets(): void {
    const el = this.sheet(
      'presets',
      ...PRESETS.map((p) =>
        h(
          'button',
          {
            class: 'preset',
            onclick: () => {
              this.applyPreset(p.id);
              el.remove();
            },
          },
          h('span', { class: 'nm' }, p.name),
          h('span', { class: 'sub' }, p.blurb),
        ),
      ),
      h('span', { class: 'note' }, 'Replaces tracks, harmony, journey and tempo. Keeps your MIDI ports and clock. Undo with ⌘Z or Ctrl+Z.'),
    );
  }

  applyPreset(id: string): void {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    const keep = this.state;
    const next = p.build();
    this.store.update((s) => {
      Object.assign(s, next, { outputId: keep.outputId, inputId: keep.inputId, clock: keep.clock, timestamped: keep.timestamped, latencyMs: keep.latencyMs });
    });
    this.sceneName = p.name;
    if (this.view === 'zoom') this.focus = Math.min(this.focus, next.tracks.length - 1);
    this.update();
    this.toast(`preset “${p.name}”`, 'undo', () => this.undo());
  }

  /** Replace the tracks with a random playable setup (undoable). Harmony, tempo and journey stay. */
  randomise(): void {
    const n = this.state.tracks.length;
    const { tracks, drums, melodic } = randomSetup((Math.random() * 2 ** 31) | 0, n >= 4 && n <= 8 ? n : 6);
    this.store.update((s) => (s.tracks = tracks));
    if (this.view === 'zoom') this.focus = Math.min(this.focus, tracks.length - 1);
    this.update();
    this.toast(`randomised · ${drums} drum + ${melodic} melodic`, 'undo', () => this.undo());
  }

  addTrack(): void {
    if (this.state.tracks.length >= MAX_TRACKS) return this.toast(`${MAX_TRACKS} plinths at most`);
    this.store.update((s) => {
      const i = s.tracks.length;
      s.tracks.push(makeTrack(i, { mode: MODE_IDS[i % MODE_IDS.length], modeParams: defaultModeParams(MODE_IDS[i % MODE_IDS.length]) }));
    });
  }

  removeTrack(i: number): void {
    if (this.state.tracks.length <= 1) return;
    this.store.update((s) => {
      s.tracks.splice(i, 1);
      for (const t of s.tracks) {
        if (t.listen.source === i) t.listen.source = -1;
        else if (t.listen.source > i) t.listen.source--;
      }
    });
    this.toast('plinth removed', 'undo', () => this.undo());
    if (this.view === 'zoom') this.focus = Math.max(0, Math.min(this.focus, this.state.tracks.length - 1));
    this.update();
  }

  undo(): void {
    if (!this.store.undo()) this.toast('nothing to undo');
  }

  panic(): void {
    this.d.router.panic();
    this.toast('all notes off');
  }

  setClock(c: 'internal' | 'external'): void {
    if (this.d.engine.playing) this.d.engine.stop(performance.now() / 1000);
    this.store.update((s) => (s.clock = c));
    if (c === 'external' && !this.state.inputId) this.toast('choose a MIDI input in ⋯ to receive clock');
  }

  selectOutput(id: string): void {
    this.store.update((s) => (s.outputId = id), { undo: false });
  }

  /**
   * rec: with a MIDI device, captures the notes sent and saves a .mid; with no device (sine preview),
   * records the preview audio and saves a .wav.
   */
  toggleRec(): void {
    const r = this.d.recorder;
    const pv = this.d.preview;
    const date = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const download = (data: Uint8Array, type: string, ext: string) => {
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
      const a = h('a', { href: url, download: `cycloom-${this.state.harmony.seed}-${date}.${ext}` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    if (pv.taping) {
      const wav = pv.stopTape();
      this.updateRec();
      if (!wav) return this.toast('nothing recorded');
      download(wav, 'audio/wav', 'wav');
      const hdr = new DataView(wav.buffer);
      const secs = hdr.getUint32(40, true) / hdr.getUint16(32, true) / hdr.getUint32(24, true);
      return this.toast(`saved ${secs >= 60 ? `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s` : `${Math.max(1, Math.round(secs))}s`} of audio as .wav`);
    }
    if (r.recording) {
      r.stop();
      this.updateRec();
      if (!r.notes.length) return this.toast('nothing recorded');
      download(r.toSMF(), 'audio/midi', 'mid');
      return this.toast(`saved ${r.notes.length} notes as .mid`);
    }
    const eng = this.d.engine;
    if (!this.state.outputId && pv.enabled) {
      if (!pv.startTape()) return this.toast('audio could not start — click play first');
      if (!eng.playing) this.togglePlay();
      this.toast('recording audio…');
    } else {
      r.start(eng.playing ? eng.beatAt(eng.simTime) : 0, this.state.bpm);
      if (!eng.playing) this.togglePlay();
      this.toast('recording MIDI…');
    }
    this.updateRec();
  }

  /** rec button label: says what it will capture. */
  private updateRec(): void {
    const audio = !this.state.outputId;
    const busy = this.d.preview.taping || this.d.recorder.recording;
    const tip = busy ? 'Stop recording and save the file.' : audio ? 'Record the sine preview audio — saved as a .wav file.' : 'Record the notes sent to your device — saved as a .mid file.';
    for (const button of [this.els.recBtn, this.els.recPhone]) {
      button.dataset.tip = tip;
      button.setAttribute('aria-label', busy ? 'Stop recording and save' : audio ? 'Record audio' : 'Record MIDI');
    }
    const label = this.els.recBtn.lastChild;
    if (label && label.nodeType === 3) label.textContent = busy ? 'stop' : audio ? 'rec wav' : 'rec';
  }

  snap(): void {
    let k = this.snaps.findIndex((x) => !x);
    if (k < 0) {
      // overwrite the oldest
      k = this.snaps.reduce((best, x, i, arr) => (x && arr[best] && x.at < arr[best]!.at ? i : best), 0);
    }
    this.snaps[k] = { state: structuredClone(this.state), engine: this.d.engine.snapshot(), at: Date.now() };
    this.d.persist.setSnaps(this.snaps);
    this.updateSnaps();
    this.toast(`snap ${k + 1} saved`);
  }

  restore(slot?: number): void {
    let k = slot;
    if (k === undefined) {
      let best = -1;
      this.snaps.forEach((x, i) => x && (best < 0 || x.at > this.snaps[best]!.at) && (best = i));
      k = best;
    }
    const sn = k !== undefined && k >= 0 ? this.snaps[k] : null;
    if (!sn) return this.toast('no snapshot yet — press snap first');
    this.applySnapshot(sn);
    this.toast(this.d.engine.playing ? `restoring snap ${k! + 1} at the next bar` : `restored snap ${k! + 1}`);
  }

  private applySnapshot(sn: Snapshot): void {
    const keep = { outputId: this.state.outputId, inputId: this.state.inputId };
    this.store.replace({ ...sn.state, ...keep });
    this.d.engine.sync();
    this.d.engine.restore(sn.engine);
    this.d.map.resetPickup();
  }

  private saveSnapAsScene(k: number): void {
    const sn = this.snaps[k];
    if (!sn) return;
    const name = prompt('Save snapshot as scene:', `scene ${Object.keys(this.d.persist.scenes()).length + 1}`);
    if (!name) return;
    this.d.persist.saveScene(name, sn);
    this.toast(`saved “${name}”`);
  }

  rewind(index: number): void {
    const hm = this.d.engine.harmony;
    const name = hm.history[index]?.chordName ?? '';
    hm.requestRewind(index);
    if (!this.d.engine.playing) hm.advanceBar();
    this.lastHarmonyRender = 0;
    this.toast(`back to ${name}${this.d.engine.playing ? ' at the next bar' : ''}`);
  }

  // ================================================================ learn

  private learnClick(path: string, track: number, fixed: boolean): void {
    const map = this.d.map;
    const target: Target = track < 0 || (!path.startsWith('macros.') && !path.startsWith('mode.') && !path.startsWith('life.')) ? { scope: 'global', param: path } : fixed ? { scope: 'track', track, param: path } : { scope: 'focus', param: path };
    if (map.mappingFor(target) && !map.learning) {
      map.unbind(target);
      this.toast('mapping cleared');
      return;
    }
    map.startLearn(target);
    this.learnFocus = true;
  }

  private learnToast(): void {
    const map = this.d.map;
    if (map.wizardLabel) this.toast(`8mu setup: ${map.wizardLabel}`, 'cancel', () => map.stopLearn(), true);
    else if (map.learning) this.toast('move a control on your device…', 'cancel', () => map.stopLearn(), true);
    else if (map.learnMode) this.toast('learn: tap a fader, then move hardware · tap a mapped fader to clear', 'done', () => map.stopLearn(), true);
    else if (this.learnFocus) {
      this.learnFocus = false;
      this.toast('mapped');
    } else if (document.querySelector('.toast button')?.textContent?.match(/done|cancel/)) document.querySelector('.toast')?.remove();
  }

  // ================================================================ sheets

  private sheet(title: string, ...body: (HTMLElement | null)[]): HTMLElement {
    const close = () => {
      el.remove();
      this.els.sheetBand = undefined as unknown as HTMLElement;
      delete this.els.sheetBand;
    };
    const el = h(
      'div',
      { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onclick: (ev: Event) => ev.target === el && close() },
      h('div', { class: 'sheet-in' }, h('div', { class: 'sheet-h' }, h('span', { class: 't' }, title), h('button', { class: 'pill', onclick: close }, 'close')), ...body),
    );
    el.addEventListener('keydown', (ev) => (ev as KeyboardEvent).key === 'Escape' && close());
    document.body.append(el);
    (el.querySelector('button, select, input') as HTMLElement | null)?.focus();
    return el;
  }

  openBandSheet(): void {
    this.els.sheetBand = h('div', { class: 'band' });
    this.sheet('harmony', this.els.sheetBand);
    this.lastHarmonyRender = 0;
  }

  openKey(): void {
    const st = this.state;
    const root = h('select', { 'aria-label': 'Root' });
    for (let pc = 0; pc < 12; pc++) root.append(h('option', { value: pc, selected: pc === st.harmony.root }, pcName(pc)));
    const mode = h('select', { 'aria-label': 'Mode' });
    for (const m of MODES) mode.append(h('option', { value: m, selected: m === st.harmony.mode }, m));
    const rel = h('select', { 'aria-label': 'Key drift' });
    for (const r of RELATIONS) rel.append(h('option', { value: r, selected: r === st.harmony.relation }, r));
    const seed = h('input', { type: 'number', value: st.harmony.seed, 'aria-label': 'Seed' });
    const el = this.sheet(
      'base key',
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'root'), root),
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'mode'), mode),
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'key drifts by'), rel),
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'seed'), seed),
      h('span', { class: 'note' }, 'Changing the root, mode or seed restarts the chord generator from the tonic. Key drift: fifths visits neighbouring keys; brightness moves to a brighter or darker mode; relative keeps the notes and changes the tonal centre; walk mixes all three.'),
      h(
        'div',
        { class: 'btns' },
        h('button', { class: 'pill on', onclick: () => {
          this.store.update((s) => {
            s.harmony.root = Number(root.value);
            s.harmony.mode = mode.value as AppState['harmony']['mode'];
            s.harmony.relation = rel.value as AppState['harmony']['relation'];
            s.harmony.seed = Math.round(Number(seed.value)) || s.harmony.seed;
          });
          el.remove();
        } }, 'apply'),
        h('button', { class: 'pill', onclick: () => (seed.value = String(Math.floor(Math.random() * 9000) + 1000)) }, 'random seed'),
      ),
    );
  }

  openMenu(section?: 'scenes'): void {
    const st = this.state;
    const midi = this.d.midi;
    const out = h('select', { 'aria-label': 'Output', onchange: (ev: Event) => this.selectOutput((ev.target as HTMLSelectElement).value) });
    out.append(h('option', { value: '', selected: !st.outputId }, 'sine preview (no device)'));
    for (const o of midi.outputs()) out.append(h('option', { value: o.id, selected: o.id === st.outputId }, o.name));
    const inp = h('select', { 'aria-label': 'Input', onchange: (ev: Event) => this.store.update((s) => (s.inputId = (ev.target as HTMLSelectElement).value), { undo: false }) });
    inp.append(h('option', { value: '', selected: !st.inputId }, 'none'), h('option', { value: '*', selected: st.inputId === '*' }, 'all inputs'));
    for (const o of midi.inputs()) inp.append(h('option', { value: o.id, selected: o.id === st.inputId }, o.name));
    const ts = h('select', { 'aria-label': 'Timestamps', onchange: (ev: Event) => this.store.update((s) => (s.timestamped = (ev.target as HTMLSelectElement).value as AppState['timestamped']), { undo: false }) });
    for (const [v, l] of [
      ['auto', `auto (${midi.isShim ? 'browser MIDI adapter → just-in-time' : 'native MIDI → timestamped'})`],
      ['on', 'timestamped'],
      ['off', 'just-in-time'],
    ]) ts.append(h('option', { value: v, selected: v === st.timestamped }, l));
    const lat = h('input', { type: 'number', value: st.latencyMs, step: 1, min: -50, max: 200, 'aria-label': 'Latency', onchange: (ev: Event) => this.store.update((s) => (s.latencyMs = Number((ev.target as HTMLInputElement).value) || 0), { undo: false }) });
    const clock = h(
      'div',
      { class: 'seg' },
      h('button', { class: st.clock === 'internal' ? 'on' : '', onclick: () => (this.setClock('internal'), el.remove(), this.openMenu()) }, 'internal'),
      h('button', { class: st.clock === 'external' ? 'on' : '', onclick: () => (this.setClock('external'), el.remove(), this.openMenu()) }, 'external'),
    );

    const phoneExtras = h(
      'div',
      { style: 'display:flex;flex-direction:column;gap:12px' },
      h('span', { class: 'cap' }, 'session'),
      h(
        'div',
        { class: 'btns' },
        h('button', { class: 'pill phone-only', onclick: () => this.snap() }, saveIcon(16), ' snap'),
        h('button', { class: 'pill phone-only', onclick: () => (this.restore(), el.remove()) }, loadIcon(16), ' restore'),
        h('button', { class: 'pill phone-only', onclick: () => (el.remove(), this.openShare()) }, shareIcon(16), ' share'),
        h('button', { class: 'pill', onclick: () => this.undo() }, '↶ undo (⌘Z)'),
        h('button', { class: 'pill phone-only', onclick: () => (el.remove(), this.openPresets()) }, presetsIcon(16), ' presets'),
        h('button', { class: 'pill phone-only', onclick: () => (this.addTrack(), el.remove()) }, '+ add plinth'),
        h('button', { class: 'pill warn', onclick: () => this.panic() }, 'panic'),
      ),
      h('div', { class: 'row phone-only' }, h('span', { class: 'lbl' }, 'swing'), this.dragReadout(h('div', { class: 'readout' }, h('span', { class: 'n mid' }, `${Math.round(st.swing * 100)}%`), h('span', { class: 'cap' }, 'drag')), 'swing', 0.0025)),
    );

    const el = this.sheet(
      'settings',
      phoneExtras,
      h('span', { class: 'cap' }, 'MIDI'),
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'output'), out),
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'input'), inp),
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'clock'), clock),
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'timing'), ts),
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'latency ms'), lat),
      midi.error ? h('span', { class: 'note' }, midi.error) : null,
      h('span', { class: 'cap' }, 'controller'),
      h(
        'div',
        { class: 'btns' },
        h('button', { class: `pill ${this.d.map.learnMode ? 'on' : ''}`, onclick: () => {
          this.d.map.learnMode = !this.d.map.learnMode;
          this.d.map.onChange?.();
          el.remove();
        } }, 'learn (L)'),
        h('button', { class: 'pill', onclick: () => {
          if (!st.inputId) this.store.update((s) => (s.inputId = '*'), { undo: false });
          this.d.map.startWizard();
          el.remove();
        } }, '8mu setup'),
        h('button', { class: 'pill', onclick: () => {
          this.d.map.load([]);
          this.toast('mappings cleared');
        } }, 'clear mappings'),
      ),
      h('span', { class: 'note' }, `${this.d.map.mappings.length} mapping${this.d.map.mappings.length === 1 ? '' : 's'} · faders 1–4 follow the zoomed track`),
      h('span', { class: 'cap' }, 'scenes & files'),
      h(
        'div',
        { class: 'btns' },
        h('button', { class: 'pill', onclick: () => (el.remove(), this.openSave()) }, 'save scene / export…'),
        h('button', { class: 'pill', onclick: () => (el.remove(), this.openLoad()) }, 'load scene / import…'),
      ),
      h('div', { class: 'btns' }, h('button', { class: 'pill', onclick: () => {
        this.store.replace({ ...defaultState(), outputId: this.state.outputId, inputId: this.state.inputId });
        el.remove();
        this.toast('reset to defaults', 'undo', () => this.undo());
      } }, 'reset to defaults')),
    );
    void section;
  }

  toast(msg: string, actionLabel?: string, action?: () => void, sticky = false): void {
    document.querySelector('.toast')?.remove();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    const t = h('div', { class: 'toast', role: 'status' }, msg, actionLabel && action ? h('button', { onclick: () => (action(), t.remove()) }, actionLabel) : null);
    document.body.append(t);
    if (!sticky) this.toastTimer = setTimeout(() => t.remove(), 2600);
  }

  // ================================================================ keyboard

  private key(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
    if (tag === 'SELECT' || document.querySelector('.sheet')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      this.togglePlay();
    } else if (e.key === 'Escape') {
      if (this.d.map.learning || this.d.map.learnMode) this.d.map.stopLearn();
      else if (this.view === 'zoom') this.back();
    } else if (/^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (i < this.state.tracks.length) this.view === 'zoom' ? this.setFocus(i) : this.zoom(i);
    } else if (e.key.toLowerCase() === 'm' && this.view === 'zoom') this.toggleMute(this.focus);
    else if (e.key.toLowerCase() === 's' && this.view === 'zoom') this.toggleSolo(this.focus);
    else if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) this.randomise();
    else if (e.key.toLowerCase() === 'l') {
      this.d.map.learnMode = !this.d.map.learnMode;
      if (!this.d.map.learnMode) this.d.map.learning = null;
      this.d.map.onChange?.();
    }
  }
}

function shortPort(name: string): string {
  const m = /model:?\s*cycles/i.exec(name);
  if (m) return 'Model:Cycles';
  return name.length > 22 ? `${name.slice(0, 20)}…` : name;
}
