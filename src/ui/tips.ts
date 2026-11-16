/**
 * Tooltips for every element with `data-tip`.
 *  - mouse: hover (short delay) — follows the element, hides on leave
 *  - keyboard: focus shows it
 *  - touch: tap a `.tip-label` inside a tipped control, or long-press any tipped element
 * One bubble element, positioned above the control and clamped to the viewport.
 */
let bubble: HTMLDivElement | null = null;
let owner: Element | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let pressTimer: ReturnType<typeof setTimeout> | null = null;
/** Set after a long-press shows a tip, so the click that follows doesn't also trigger the control. */
let swallowClick = false;

const tipped = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? (t.closest('[data-tip]') as HTMLElement | null) : null);

export function showTip(el: Element, sticky = false): void {
  const text = el.getAttribute('data-tip');
  if (!text) return;
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.className = 'tipbox';
    bubble.setAttribute('role', 'tooltip');
    bubble.id = 'tipbox';
    document.body.append(bubble);
  }
  if (hideTimer) clearTimeout(hideTimer);
  owner = el;
  bubble.textContent = text;
  bubble.hidden = false;
  el.setAttribute('aria-describedby', 'tipbox');
  // position: above the element, or below when there is no room
  const r = el.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  const m = 8;
  let x = r.left + r.width / 2 - b.width / 2;
  x = Math.max(m, Math.min(window.innerWidth - b.width - m, x));
  let y = r.top - b.height - 8;
  const below = y < m;
  if (below) y = r.bottom + 8;
  bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  bubble.dataset.side = below ? 'below' : 'above';
  if (sticky) hideTimer = setTimeout(hideTip, 4000);
}

export function hideTip(): void {
  if (hoverTimer) clearTimeout(hoverTimer);
  if (hideTimer) clearTimeout(hideTimer);
  owner?.removeAttribute('aria-describedby');
  owner = null;
  if (bubble) bubble.hidden = true;
}

export function installTips(root: Document = document): void {
  root.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = tipped(e.target);
    if (!el || el === owner) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    // while one tip is open, moving to the next control switches at once
    hoverTimer = setTimeout(() => showTip(el), owner ? 0 : 450);
  });
  root.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = tipped(e.target);
    if (!el || (e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    hideTimer = setTimeout(hideTip, 80);
  });
  // a press (drag) on a control hides its tip so it never covers the value
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') {
      hideTip();
      return;
    }
    const el = tipped(e.target);
    if (pressTimer) clearTimeout(pressTimer);
    if (!el) return hideTip();
    const onLabel = e.target instanceof Element && !!e.target.closest('.tip-label');
    if (onLabel) return; // handled on click
    pressTimer = setTimeout(() => {
      swallowClick = true;
      showTip(el, true);
    }, 480);
  });
  const cancelPress = () => pressTimer && clearTimeout(pressTimer);
  root.addEventListener('pointerup', cancelPress);
  root.addEventListener('pointercancel', cancelPress);
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' && pressTimer && (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3)) cancelPress();
  });
  // capture phase: a tap on a label explains instead of acting; a long-press swallows its click
  root.addEventListener(
    'click',
    (e) => {
      if (swallowClick) {
        swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const t = e.target instanceof Element ? e.target : null;
      const label = t?.closest('.tip-label');
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      if (label && coarse) {
        const el = tipped(label);
        if (el) {
          e.preventDefault();
          e.stopPropagation();
          if (owner === el) hideTip();
          else showTip(el, true);
        }
      }
    },
    true,
  );
  root.addEventListener('contextmenu', (e) => {
    if (tipped(e.target) && window.matchMedia('(pointer: coarse)').matches) e.preventDefault();
  });
  root.addEventListener('focusin', (e) => {
    const el = tipped(e.target);
    if (el && (e.target as HTMLElement).matches(':focus-visible')) showTip(el);
  });
  root.addEventListener('focusout', () => hideTip());
  root.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Escape' && hideTip());
  window.addEventListener('scroll', hideTip, { passive: true, capture: true });
  window.addEventListener('resize', hideTip);
}
