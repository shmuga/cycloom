type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | number | null | undefined | false;

/** Minimal hyperscript for HTML elements. Keys starting with "on" become listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function toggle(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/** The isometric cube logo used in the header. */
/** The Cycloom mark (filmstrip waveform in corner brackets), light on transparent — see scripts/brand.mjs. */
export function logo(size = 28): HTMLImageElement {
  return h('img', { class: 'logo', src: 'logo.png', width: size, height: size, alt: '', 'aria-hidden': 'true', draggable: 'false' }) as HTMLImageElement;
}

const line = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };

/** Presets: three stacked isometric slabs (like plinths). */
export function presetsIcon(size = 20): SVGSVGElement {
  return s(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    s('path', { d: 'M12 3 21 7.5 12 12 3 7.5Z', ...line }),
    s('path', { d: 'M3 12 12 16.5 21 12', ...line }),
    s('path', { d: 'M3 16.5 12 21 21 16.5', ...line }),
  );
}

/** Save: an arrow dropping into an isometric tray. */
export function saveIcon(size = 20): SVGSVGElement {
  return s(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    s('path', { d: 'M3 14.5 12 19l9-4.5 M12 3v11 M8 10.5l4 3.5 4-3.5', ...line }),
  );
}

/** Load: an arrow rising out of an isometric tray. */
export function loadIcon(size = 20): SVGSVGElement {
  return s(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    s('path', { d: 'M3 14.5 12 19l9-4.5 M12 14V3 M8 6.5 12 3l4 3.5', ...line }),
  );
}

/** Share: three linked nodes. */
export function shareIcon(size = 20): SVGSVGElement {
  return s(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    s('path', { d: 'M8.2 10.6 15.8 6.4 M8.2 13.4l7.6 4.2', ...line }),
    s('circle', { cx: 6, cy: 12, r: 2.6, ...line }),
    s('circle', { cx: 18, cy: 5.2, r: 2.6, ...line }),
    s('circle', { cx: 18, cy: 18.8, r: 2.6, ...line }),
  );
}

/** Isometric die (line art, currentColor): one pip on top, two on the left face, three on the right. */
export function dice(size = 20): SVGSVGElement {
  const pip = (cx: number, cy: number) => s('circle', { cx, cy, r: 1.25, fill: 'currentColor' });
  return s(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    s('path', { d: 'M12 2.5 21 7.25v9.5L12 21.5 3 16.75v-9.5Z M3 7.25 12 12l9-4.75 M12 12v9.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linejoin': 'round' }),
    pip(12, 7.25),
    pip(5.9, 11.6),
    pip(9.1, 16.6),
    pip(14.6, 18.4),
    pip(16.5, 14.4),
    pip(18.4, 10.4),
  );
}

export const pad2 = (n: number): string => String(n).padStart(2, '0');
