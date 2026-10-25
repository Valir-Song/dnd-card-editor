// Sheet zoom (ROADMAP 4.1): 50–200 %, buttons in the top bar, Ctrl+wheel and
// Ctrl+plus/minus/0, «по ширине». The zoom is CSS `zoom` on the stage, so every
// gesture keeps working: they all measure millimetres through the page's real
// on-screen width. The zoom is remembered per browser, never in the layout.

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEPS = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200];
const STORE = 'dnd-card-editor-zoom';
const PAGE_PX = 210 / 25.4 * 96; // an A4 page at 100 %, CSS pixels

/** A whole percent within 50–200; anything unreadable is 100. @param {unknown} value */
export function clampZoom(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n)));
}

/** The next step up (dir 1) or down (dir -1) from any zoom. @param {number} zoom @param {1 | -1} dir */
export function stepZoom(zoom, dir) {
  const next = dir > 0 ? ZOOM_STEPS.find(step => step > zoom) : [...ZOOM_STEPS].reverse().find(step => step < zoom);
  return next ?? (dir > 0 ? ZOOM_MAX : ZOOM_MIN);
}

/** Ctrl+wheel and touchpad pinch: smooth, proportional to the wheel delta. @param {number} zoom @param {number} deltaY pixels */
export function wheelZoom(zoom, deltaY) {
  const delta = Math.max(-100, Math.min(100, deltaY)); // one mouse notch ≈ 100 px ≈ 18 %
  return clampZoom(zoom * Math.exp(-delta * 0.002));
}

/** The zoom at which one page fills `available` CSS pixels of width. @param {number} available @param {number} padding the stage's side padding at 100 % */
export function fitWidthZoom(available, padding = 24) {
  return clampZoom(Math.floor(available / (PAGE_PX + 2 * padding) * 100));
}

/** @param {{stage: HTMLElement, pages: () => HTMLElement[], onChange?: (zoom: number) => void}} deps */
export function createZoom({stage, pages, onChange}) {
  const out = /** @type {HTMLButtonElement} */ (document.getElementById('zoomOut'));
  const inn = /** @type {HTMLButtonElement} */ (document.getElementById('zoomIn'));
  const value = /** @type {HTMLButtonElement} */ (document.getElementById('zoomValue'));
  const fit = /** @type {HTMLButtonElement} */ (document.getElementById('zoomFit'));
  let zoom = 100;
  try { zoom = clampZoom(localStorage.getItem(STORE) ?? 100); } catch (error) { /* storage blocked: start at 100 % */ }

  // The page under a screen point (or the nearest one) and the point in its millimetres.
  /** @param {number} x @param {number} y */
  function anchorAt(x, y) {
    const list = pages();
    let best = list[0], distance = Infinity;
    for (const page of list) {
      const r = page.getBoundingClientRect();
      const d = Math.max(r.top - y, 0, y - r.bottom) + Math.max(r.left - x, 0, x - r.right);
      if (d < distance) { distance = d; best = page; }
    }
    if (!best) return null;
    const r = best.getBoundingClientRect(), k = 210 / r.width;
    return {page: best, mm: [(x - r.left) * k, (y - r.top) * k]};
  }

  // Scroll whatever scrolls the stage: the window, or the stage itself on narrow screens.
  /** @param {number} dx @param {number} dy */
  function scrollBy(dx, dy) {
    if (stage.scrollWidth > stage.clientWidth + 1 && getComputedStyle(stage).overflowX !== 'visible') {
      stage.scrollLeft += dx;
      dx = 0;
    }
    window.scrollBy(dx, dy);
  }

  function apply() {
    stage.style.setProperty('zoom', String(zoom / 100));
    stage.style.setProperty('--zoom', String(zoom / 100));
    document.documentElement.dataset.zoom = String(zoom);
    value.textContent = zoom + ' %';
    out.disabled = zoom <= ZOOM_MIN;
    inn.disabled = zoom >= ZOOM_MAX;
  }

  /** Change the zoom keeping the sheet point under (x, y) where it was. @param {number} next @param {number} [x] @param {number} [y] */
  function set(next, x = innerWidth / 2, y = innerHeight / 2) {
    next = clampZoom(next);
    if (next === zoom) return;
    const anchor = anchorAt(x, y);
    zoom = next;
    apply();
    try { localStorage.setItem(STORE, String(zoom)); } catch (error) { /* not remembered, still zoomed */ }
    if (anchor) {
      const r = anchor.page.getBoundingClientRect(), k = r.width / 210;
      scrollBy(r.left + anchor.mm[0] * k - x, r.top + anchor.mm[1] * k - y);
    }
    onChange?.(zoom);
  }

  function fitWidth() {
    const padding = parseFloat(getComputedStyle(stage).paddingLeft) || 24;
    set(fitWidthZoom(document.documentElement.clientWidth, padding));
  }

  out.addEventListener('click', () => set(stepZoom(zoom, -1)));
  inn.addEventListener('click', () => set(stepZoom(zoom, 1)));
  value.addEventListener('click', () => set(100));
  fit.addEventListener('click', fitWidth);

  // Ctrl+wheel zooms the sheets, not the whole browser tab with the toolbar
  // (a touchpad pinch arrives as Ctrl+wheel too).
  window.addEventListener('wheel', event => {
    if (!event.ctrlKey || (event.target instanceof Element && event.target.closest('dialog'))) return;
    event.preventDefault();
    const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
    set(wheelZoom(zoom, pixels), event.clientX, event.clientY);
  }, {passive: false});

  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const dir = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd' ? 1
      : event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract' ? -1
      : event.key === '0' || event.code === 'Numpad0' ? 0 : null;
    if (dir === null) return;
    event.preventDefault();
    set(dir === 0 ? 100 : stepZoom(zoom, dir));
  });

  apply();
  return {get: () => zoom, set, fitWidth};
}
