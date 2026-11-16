import { HINTS } from './hints';
import type { HarmonyEngine, Relation } from '../harmony/engine';
import { type Chord, scaleName, scalePcs, spellScale } from '../music/theory';
import type { Store } from '../state/store';
import { h, s } from './dom';

export interface BandHost {
  store: Store;
  harmony: () => HarmonyEngine;
  rewind(index: number): void;
  openKey(): void;
  newSeed(): void;
}

const CHORD = [1, 2, 4, 8];
const DEPTH = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
const DRIFT = [4, 8, 16, 32, 64];
export const RELATIONS: Relation[] = ['fifths', 'brightness', 'relative', 'walk'];

function cycle<T>(list: T[], cur: T, back: boolean): T {
  const i = list.indexOf(cur);
  const n = list.length;
  return list[((i < 0 ? 0 : i) + (back ? -1 : 1) + n) % n];
}

export interface BandView {
  chords: Chord[]; // [current, next, up1, up2]
  subs: string[];
  history: { index: number; name: string; recent: boolean }[];
  pendingRewind: boolean;
  driftText: { target: string; inBars: number | null; relation: string } | null;
}

/** Derive everything the harmony displays need from the engine. */
export function bandView(hm: HarmonyEngine): BandView {
  const cur = hm.chord;
  const up = hm.upcoming(3);
  const drift = hm.driftTarget;
  const pending = hm.core.pendingScale;
  const pendPcs = pending ? scalePcs(pending) : null;
  const morphing = cur.degree !== hm.core.base.degree || cur.ext !== hm.core.base.ext;
  const subs = [
    `${cur.roman}${morphing ? ' · morphing' : ''}`,
    `${up[0]?.roman ?? ''} · next`,
    up[1]?.roman ?? '',
    up[2]?.roman ?? '',
  ];
  up.forEach((c, k) => {
    if (pendPcs && c.pcs.every((p) => pendPcs.includes(p)) && k > 0) subs[k + 1] += ' · pivot';
  });
  const len = hm.history.length;
  const from = Math.max(0, len - 6);
  const history = hm.history.slice(from, len - 1).map((e, k, arr) => ({ index: from + k, name: e.chordName, recent: k >= arr.length - 2 }));
  return {
    chords: [cur, ...up],
    subs,
    history,
    pendingRewind: hm.rewindPending,
    driftText: drift ? { target: scaleName(drift.scale), inBars: pending ? null : drift.inBars, relation: hm.settings.relation } : null,
  };
}

/** Full harmony band (E1 / desktop, and inside the phone sheet). */
export function renderBand(el: HTMLElement, host: BandHost): void {
  const hm = host.harmony();
  const st = host.store.state;
  const v = bandView(hm);
  const scale = hm.scale;
  el.replaceChildren();

  const driftEl = h('span', { class: 'drift' });
  if (st.harmony.holdScale) driftEl.append('scale held');
  else if (v.driftText) {
    driftEl.append('drifting to ', h('b', {}, v.driftText.target), v.driftText.inBars === null ? ' at the next pivot' : ` in ${v.driftText.inBars} bar${v.driftText.inBars === 1 ? '' : 's'}`, ' · by ', h('button', { class: 'rel', 'data-tip': 'How the key drifts: fifths = neighbouring keys, brightness = one mode brighter/darker, relative = same notes new centre, walk = a mix. Click to change.', onclick: () => host.store.update((s2) => (s2.harmony.relation = cycle(RELATIONS, s2.harmony.relation, false))) }, v.driftText.relation));
  }

  const key = h(
    'div',
    { class: 'key' },
    h('span', { class: 'cap' }, 'harmony · ', h('button', { class: 'cyc cap', style: 'background:none;border:none;padding:0;cursor:pointer', 'data-tip': HINTS.seed, onclick: () => host.newSeed() }, `seed ${st.harmony.seed}`)),
    h('button', { class: 'scale-name', 'data-tip': HINTS.key, onclick: () => host.openKey() }, scaleName(scale)),
    driftEl,
  );

  const hist = h('div', { class: 'hist', role: 'group', 'aria-label': 'History: click to go back' });
  for (const e of v.history) {
    hist.append(
      h('button', {
        class: e.recent ? 'recent' : '',
        'aria-label': `Back to ${e.name}`,
        'data-tip': `Back to ${e.name}. The future branches anew from there.`,
        onclick: () => host.rewind(e.index),
      }),
    );
  }
  if (v.pendingRewind) hist.lastElementChild?.classList.add('pending');

  const pills = h('div', { class: 'chord-pills', 'data-tip': HINTS.chords });
  v.chords.forEach((c, k) => {
    pills.append(h('div', { class: `cp ${k === 0 ? 'cur' : k >= 2 ? 'up' : ''}` }, h('span', { class: 'nm' }, c.name), h('span', { class: 'rn' }, v.subs[k])));
  });

  const hs = st.harmony;
  const set = (fn: (d: typeof hs) => void) => host.store.update((s2) => fn(s2.harmony));
  const pace = hm.settings.pace;
  const eff = (bars: number) => Math.max(1, Math.round(bars * pace));
  const barsTxt = (n: number) => `${n} bar${n === 1 ? '' : 's'}`;
  const paceNote = Math.abs(pace - 1) > 0.01 ? ` Pace is ×${+pace.toFixed(2)} now.` : '';
  const cyc = (label: string, value: string, title: string, onClick: (back: boolean) => void) =>
    h('button', { class: 'cyc', onclick: (e: Event) => onClick((e as MouseEvent).shiftKey), 'data-tip': title }, `${label} `, h('b', {}, value));
  const hold = h(
    'div',
    { class: 'seg sm', role: 'group', 'aria-label': 'Hold', 'data-tip': HINTS.hold },
    h('span', { class: 'lbl tip-label' }, 'hold'),
    h('button', { class: hs.holdChord ? 'on' : '', 'aria-pressed': String(hs.holdChord), onclick: () => set((d) => (d.holdChord = !d.holdChord)) }, 'chord'),
    h('button', { class: hs.holdScale ? 'on' : '', 'aria-pressed': String(hs.holdScale), onclick: () => set((d) => (d.holdScale = !d.holdScale)) }, 'key'),
  );
  const settings = h(
    'div',
    { class: 'settings' },
    cyc('chord every', barsTxt(eff(hs.barsPerChord)), HINTS.chordEvery + paceNote, (b) =>
      set((d) => {
        d.barsPerChord = cycle(CHORD, d.barsPerChord, b);
        // colour changes happen halfway through a chord
        d.morphBars = Math.max(1, d.barsPerChord / 2);
      }),
    ),
    cyc('colour', hs.depth.toFixed(2), HINTS.colour, (b) => set((d) => (d.depth = cycle(DEPTH, +d.depth.toFixed(2), b)))),
    cyc('key every', barsTxt(eff(hs.driftBars)), HINTS.keyEvery + paceNote, (b) => set((d) => (d.driftBars = cycle(DRIFT, d.driftBars, b)))),
    hold,
  );

  const chords = h('div', { class: 'chords' }, h('div', { class: 'chord-row' }, hist, pills), settings);

  el.append(key, chords, h('div', { class: 'pitch', 'data-tip': HINTS.pitchSet }, h('span', { class: 'cap tip-label' }, 'pitch set'), pitchSet(hm)));
}

export function pitchSet(hm: HarmonyEngine): SVGSVGElement {
  const ctx = hm.context();
  const spelled = spellScale(ctx.scale);
  const svg = s('svg', { viewBox: '0 0 264 44', role: 'img', 'aria-label': `${scaleName(ctx.scale)} scale with ${ctx.chord.name} chord tones highlighted` });
  const labels = s('g', { 'font-family': 'Outfit', 'font-size': 9, fill: '#83A6CE', 'text-anchor': 'middle' });
  for (let pc = 0; pc < 12; pc++) {
    const cx = 11 + pc * 22;
    const inChord = ctx.chordTones.includes(pc);
    const deg = ctx.scalePcs.indexOf(pc);
    if (inChord) svg.append(s('circle', { cx, cy: 14, r: 8, fill: '#C48CB3' }));
    else if (deg >= 0) svg.append(s('circle', { cx, cy: 14, r: 8, fill: '#83A6CE' }));
    else svg.append(s('circle', { cx, cy: 14, r: 8, fill: 'none', stroke: '#26415E', 'stroke-width': 1.5 }));
    if (deg >= 0) labels.append(s('text', { x: cx, y: 40 }, spelled[deg]));
  }
  svg.append(labels);
  return svg;
}

/** Compact one-line band (E2 zoom view). */
export function renderMiniBand(el: HTMLElement, hm: HarmonyEngine, held: boolean): void {
  const v = bandView(hm);
  el.replaceChildren(
    h('span', { class: 'sn' }, scaleName(hm.scale)),
    h('span', { class: 'sub', style: 'font-size:13px' }, held || !v.driftText ? 'scale held' : `→ ${v.driftText.target}${v.driftText.inBars === null ? ' at pivot' : ` in ${v.driftText.inBars} bars`}`),
    h('span', { class: 'sp' }),
    h('span', { class: 'cur' }, v.chords[0].name),
    h('span', { class: 'pill' }, v.chords[1]?.name ?? ''),
    h('span', { class: 'pill dashed' }, v.chords[2]?.name ?? ''),
    h('span', { class: 'pill dashed' }, v.chords[3]?.name ?? ''),
  );
}

/** Phone one-line band (E3). */
export function renderPhoneBand(el: HTMLElement, hm: HarmonyEngine, held: boolean): void {
  const v = bandView(hm);
  const dots = h('span', { class: 'hd' });
  for (const e of v.history.slice(-3)) dots.append(h('span', { class: e.recent ? 'recent' : '' }));
  const short = v.driftText ? v.driftText.target.replace(/ .*/, '') : '';
  const mode = v.driftText ? v.driftText.target.replace(/^\S+ /, '') : '';
  el.replaceChildren(
    h('div', { class: 'r1' }, h('span', { class: 'sn' }, scaleName(hm.scale)), h('span', { class: 'dr' }, held || !v.driftText ? 'held' : `→ ${short} ${mode}${v.driftText.inBars === null ? ' · pivot' : ` · ${v.driftText.inBars} bars`}`)),
    h('div', { class: 'r2' }, dots, h('span', { class: 'c cur' }, v.chords[0].name), h('span', { class: 'c' }, v.chords[1]?.name ?? ''), h('span', { class: 'c up' }, v.chords[2]?.name ?? '')),
  );
}
