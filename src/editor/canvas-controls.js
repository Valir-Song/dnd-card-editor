// Canvas-level selection and geometry for page objects: one pointer-events
// gesture layer (drag, 8-handle resize, marquee) that works in layout
// millimetres. Rich text stays Tiptap-owned: a press on editable text is never
// a gesture. Text frames inside cards are handled by inner-canvas.js.
import { collectLines, snapAxis, snapMove } from './snapping.js';
import { isSheet } from './sheet.js';
import { bbox, resizeBox, scaleBoxes, marqueeHits, rectFromPoints, clampMove, gridStep, PAGE_FRAME } from './geometry.js';
import { target } from './dom.js';

/** @typedef {import('../types/geometry').Box} Box */
/** @typedef {import('../types/geometry').Dir} Dir */
/** @typedef {import('../types/geometry').Point} Point */
/** @typedef {import('../types/geometry').GapMark} GapMark */
/** @typedef {import('../types/layout').Item} Item */
/** @typedef {ReturnType<typeof import('./snapping.js').createSnapSettings>} Snapping */
/** @typedef {ReturnType<typeof import('./inner-canvas.js').createInnerCanvas>} InnerCanvas */
/** @typedef {{x: number | null, y: number | null}} Guides */
/** One moving object: its data, its node and its box at the start. @typedef {Box & {id: string, item: Item, node: HTMLElement}} MoveRecord */
/**
 * @typedef {{scale: number, page: HTMLElement, records: MoveRecord[], frame: Box,
 *   lines: import('../types/geometry').Lines | null, others: Box[] | null, grid: number, threshold: number}} Gesture
 */
/** One page's overlay. @typedef {{page: HTMLElement, layer: HTMLElement, frame: HTMLElement, marquee: HTMLElement}} Overlay */

/** @type {Record<string, Dir>} */
const DIRECTIONS = {nw: [-1, -1], n: [0, -1], ne: [1, -1], w: [-1, 0], e: [1, 0], sw: [-1, 1], s: [0, 1], se: [1, 1]};
const EDGES = ['top', 'right', 'bottom', 'left'];
// Where each side of a box goes in a node's style.
const SIDES = /** @type {const} */ ([['x', 'left'], ['y', 'top'], ['w', 'width'], ['h', 'height']]);
const CLICK_SLOP = 3; // px a press may wander and still count as a click
const NATIVE = '.editable, [contenteditable], input, textarea, select, .level, .textbox-move, .pools button';
const LOCK_ICON = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor"/></svg>';

/**
 * @param {import('../types/layout').Deps<'pages' | 'mm'> & {snapping?: Snapping,
 *   onSelection: (ids: string[], primary: string | null) => void}} deps
 */
export function createCanvasControls({pages, store, onSelection, mm, snapping}) {
  /** @type {string[]} */
  let ids = [];
  /** @type {string | null} */
  let primary = null;
  /** @type {Gesture | null} */
  let gesture = null;
  /** @type {InnerCanvas | null} */
  let inner = null;
  const nodeFor = (/** @type {string} */ id) => pages.flatMap(page => [...page.querySelectorAll('.el')]).find(node => node.dataset.id === id);
  const mmPerPx = (/** @type {HTMLElement} */ page) => 210 / page.getBoundingClientRect().width;
  const itemFor = (/** @type {string} */ id) => store.find(id);
  /** The selected objects that still exist. @param {string[]} list */
  const itemsOf = list => list.map(itemFor).filter(/** @returns {item is Item} */ item => !!item);
  // Objects of the layout, without the page backgrounds.
  const objects = () => store.items.filter(item => !isSheet(item));
  const locked = (/** @type {string} */ id) => !!itemFor(id)?.locked;
  const clip = (/** @type {number} */ value, /** @type {number} */ min, /** @type {number} */ max) => Math.max(min, Math.min(value, Math.max(min, max)));
  /** @param {HTMLElement} page @param {{clientX: number, clientY: number}} ev @returns {Point} */
  const toMm = (page, ev) => {
    const r = page.getBoundingClientRect(), k = 210 / r.width;
    return [(ev.clientX - r.left) * k, (ev.clientY - r.top) * k];
  };
  // Current geometry in mm; an auto-height text box is as tall as it renders.
  /** @param {Item} item @param {HTMLElement | undefined} [node] @returns {Box} */
  function boxOf(item, node = nodeFor(item.id)) {
    const page = node?.closest('.page');
    const h = item.kind === 'textbox' && item.autoHeight && node && page
      ? node.getBoundingClientRect().height * mmPerPx(page) : item.h;
    return {x: item.x, y: item.y, w: item.w, h};
  }

  // ---- overlay: one layer per page, positioned over it inside the stage ----
  const stage = pages[0].closest('.stage') || document.body;
  /** @type {Overlay[]} */
  const layers = pages.map(page => {
    const layer = document.createElement('div');
    layer.className = 'gesture-layer';
    layer.dataset.page = page.dataset.page || '';
    const frame = document.createElement('div');
    frame.className = 'gesture-frame';
    frame.hidden = true;
    for (const edge of EDGES) {
      const band = document.createElement('div');
      band.className = 'gesture-edge ' + edge;
      band.title = 'Перетащить';
      band.addEventListener('pointerdown', ev => startMove(ev));
      frame.append(band);
    }
    for (const [name, dir] of Object.entries(DIRECTIONS)) {
      const handle = document.createElement('div');
      handle.className = 'gesture-handle';
      handle.dataset.dir = name;
      handle.addEventListener('pointerdown', ev => startResize(ev, dir));
      frame.append(handle);
    }
    const lock = document.createElement('div');
    lock.className = 'gesture-lock';
    lock.title = 'Закреплено: не двигается и не удаляется';
    lock.innerHTML = LOCK_ICON;
    frame.append(lock);
    const marquee = document.createElement('div');
    marquee.className = 'gesture-marquee';
    marquee.hidden = true;
    layer.append(frame, marquee);
    stage.append(layer);
    return {page, layer, frame, marquee};
  });
  function placeLayers() {
    for (const {page, layer} of layers) {
      layer.style.left = page.offsetLeft + 'px';
      layer.style.top = page.offsetTop + 'px';
    }
  }
  function renderFrame() {
    const targets = inner?.hasSelection() ? [] : itemsOf(ids);
    const page = targets.length ? (targets[0].page || 1) : null;
    for (const {layer, frame} of layers) {
      const show = page !== null && Number(layer.dataset.page) === page;
      frame.hidden = !show;
      if (!show) continue;
      const b = bbox(targets.map(item => boxOf(item)));
      Object.assign(frame.style, {left: mm(b.x), top: mm(b.y), width: mm(b.w), height: mm(b.h)});
      frame.classList.toggle('group', targets.length > 1);
      // Locked objects have no handles; with nothing movable the bands go too.
      const lockedCount = targets.filter(item => item.locked).length;
      frame.classList.toggle('has-locked', lockedCount > 0);
      frame.classList.toggle('locked', lockedCount === targets.length);
    }
  }

  // ---- selection ----
  /** @param {string[]} next @param {string | null} [preferred] @param {{keepInner?: boolean}} [options] */
  function setSelection(next, preferred = null, {keepInner = false} = {}) {
    if (!keepInner) inner?.clear();
    const unique = itemsOf([...new Set(next)]);
    const page = unique.length ? (unique[0].page || 1) : null;
    ids = unique.filter(item => (item.page || 1) === page).map(item => item.id);
    primary = preferred !== null && ids.includes(preferred) ? preferred : (ids.length === 1 ? ids[0] : null);
    sync();
    onSelection(ids.slice(), primary);
  }
  function sync() {
    const chosen = new Set(ids);
    for (const page of pages) for (const node of page.querySelectorAll('.el')) {
      node.classList.toggle('selected', chosen.has(node.dataset.id || ''));
    }
    renderFrame();
    const status = document.getElementById('selectionCount');
    if (!status) return;
    if (inner?.hasSelection()) {
      status.textContent = inner.count() > 1 ? 'Текстовых блоков: ' + inner.count() : 'Выбран текстовый блок';
      return;
    }
    const count = ids.length > 1 ? 'Выбрано: ' + ids.length : '';
    const fixed = ids.filter(locked).length;
    const note = !fixed ? '' : ids.length === 1 ? 'закреплён' : 'закреплено: ' + fixed;
    status.textContent = count && note ? count + ' · ' + note : count || (note && note[0].toUpperCase() + note.slice(1));
  }

  // ---- gestures ----
  function begin() {
    // Locked objects stay put (and count as snap lines) when their group moves.
    /** @type {Array<{id: string, item: Item, node: HTMLElement}>} */
    const chosen = [];
    for (const id of ids) {
      const item = itemFor(id), node = nodeFor(id);
      if (item && node && !item.locked) chosen.push({id, item, node});
    }
    const page = chosen[0]?.node.closest('.page');
    if (!page) { gesture = null; return; }
    const scale = mmPerPx(page);
    const settings = snapping?.get();
    const records = chosen.map(record => ({...record, ...boxOf(record.item, record.node)}));
    const pageNumber = chosen[0].item.page || 1, moving = new Set(chosen.map(r => r.id));
    gesture = {
      scale, page, records, frame: bbox(records),
      // Snap lines are fixed for the gesture: everything that is not moving.
      // (A page background is not an object: nothing snaps to it.)
      lines: settings?.enabled ? collectLines(objects(), pageNumber, moving) : null,
      // The objects that stay, for equal gaps in a row or column (rendered sizes).
      others: settings?.enabled ? objects().filter(item => (item.page || 1) === pageNumber && !moving.has(item.id)).map(item => boxOf(item)) : null,
      grid: settings?.enabled ? settings.gridMm : 0,
      threshold: 6 * scale // 6 screen pixels, whatever the zoom
    };
    document.body.classList.add('gesture-active');
  }
  /** @param {number[]} dist @param {boolean} [free] */
  function applyDrag(dist, free = false) {
    if (!gesture || !dist) return;
    const {records, scale} = gesture;
    let rawX = dist[0] * scale, rawY = dist[1] * scale;
    /** @type {Guides} */
    let guides = {x: null, y: null};
    /** @type {GapMark[]} */
    let gaps = [];
    if (gesture.lines && !free) ({dx: rawX, dy: rawY, guides, gaps} = snapMove(gesture.frame, rawX, rawY, gesture.lines, gesture));
    showGuides(guides);
    showGaps(gaps);
    const dx = clip(rawX, Math.max(...records.map(r => -r.x)), Math.min(...records.map(r => 210 - r.x - r.w)));
    const dy = clip(rawY, Math.max(...records.map(r => -r.y)), Math.min(...records.map(r => 297 - r.y - r.h)));
    for (const r of records) place(r, {x: r.x + dx, y: r.y + dy});
    renderFrame();
  }
  /** @param {number[]} dist @param {Dir} dir @param {{free?: boolean, keepRatio?: boolean}} [options] */
  function applyResize(dist, dir, {free = false, keepRatio = false} = {}) {
    if (!gesture) return;
    const {records, scale} = gesture;
    let dx = dist[0] * scale, dy = dist[1] * scale;
    const single = records.length === 1;
    /** @type {Guides} */
    const guides = {x: null, y: null};
    // Snap only the edges being dragged, and only for a single object.
    if (single && gesture.lines && !free) {
      const f = gesture.frame;
      if (dir[0]) {
        const edge = dir[0] > 0 ? f.x + f.w + dx : f.x + dx;
        const snap = snapAxis([edge], gesture.lines.x, gesture.threshold, gesture.grid);
        dx += snap.offset; guides.x = snap.line;
      }
      if (dir[1]) {
        const edge = dir[1] > 0 ? f.y + f.h + dy : f.y + dy;
        const snap = snapAxis([edge], gesture.lines.y, gesture.threshold, gesture.grid);
        dy += snap.offset; guides.y = snap.line;
      }
    }
    showGuides(guides);
    const min = single ? {w: 12, h: 6}
      : {w: gesture.frame.w * 0.05, h: gesture.frame.h * 0.05}; // a group may shrink to 5 %
    const to = resizeBox(gesture.frame, dir, dx, dy, {min, keepRatio});
    const boxes = single ? [to] : scaleBoxes(records, gesture.frame, to);
    records.forEach((r, i) => {
      if (r.item.kind === 'textbox' && r.item.autoHeight) {
        r.item.autoHeight = false;
        r.node.classList.remove('auto-height');
        r.node.style.maxHeight = '';
      }
      place(r, boxes[i]);
    });
    renderFrame();
  }
  /** @param {MoveRecord} record @param {Partial<Box>} box */
  function place(record, box) {
    Object.assign(record.item, box);
    for (const [key, side] of SIDES) {
      const value = box[key];
      if (value !== undefined) record.node.style[side] = mm(value);
    }
  }
  // Thin guide lines on the page of the gesture; hidden in print.
  /** @param {Guides} guides */
  function showGuides({x, y}) {
    const page = gesture?.page;
    /** @type {Array<['x' | 'y', number | null]>} */
    const axes = [['x', x], ['y', y]];
    for (const p of pages) for (const [axis, value] of axes) {
      let line = p.querySelector(':scope > .snap-guide:not(.inner-guide).' + axis);
      if (p !== page || value === null) { line?.remove(); continue; }
      if (!line) { line = document.createElement('div'); line.className = 'snap-guide ' + axis; p.append(line); }
      line.style[axis === 'x' ? 'left' : 'top'] = mm(value);
    }
  }
  // Equal gaps of a row or column, while a drag keeps them: pink bars with the gap in mm.
  /** @param {GapMark[]} marks */
  function showGaps(marks) {
    for (const p of pages) for (const node of p.querySelectorAll(':scope > .gap-guide')) node.remove();
    for (const m of marks) {
      const node = document.createElement('div');
      node.className = 'gap-guide ' + m.axis;
      node.dataset.gap = String(Math.round((m.to - m.from) * 10) / 10).replace('.', ',');
      const [along, across, size] = m.axis === 'x' ? ['left', 'top', 'width'] : ['top', 'left', 'height'];
      Object.assign(node.style, {[along]: mm(m.from), [across]: mm(m.at), [size]: mm(m.to - m.from)});
      gesture?.page.append(node);
    }
  }
  function endGesture() {
    document.body.classList.remove('gesture-active');
    if (!gesture) return;
    showGuides({x: null, y: null});
    showGaps([]);
    gesture = null;
    // One history checkpoint per drag or resize, regardless of the number of targets.
    store.commit();
    renderFrame();
  }
  // Follow one pointer until it is released. Listeners attach synchronously in
  // the pointerdown, so no movement is lost however fast the input is. For a
  // mouse, mousemove/mouseup back up the pointer events: with Shift held,
  // Firefox can swallow pointerup while it runs its own selection.
  /**
   * @param {PointerEvent} ev
   * @param {{move: (e: PointerEvent) => void, end: (e: PointerEvent, cancelled: boolean) => void}} handlers
   */
  function follow(ev, {move, end}) {
    const id = ev.pointerId, mouse = ev.pointerType === 'mouse';
    // A mouse event (the fallback) has no pointerId; it stands in for the pointer event.
    const mine = (/** @type {Event & {pointerId?: number}} */ e) => e.pointerId === undefined ? mouse : e.pointerId === id;
    /** @type {EventListener} */
    const onMove = e => { if (mine(e)) move(/** @type {PointerEvent} */ (e)); };
    /** @type {EventListener} */
    const onEnd = e => {
      if (!mine(e)) return;
      for (const [type, fn] of listeners) window.removeEventListener(type, fn, true);
      end(/** @type {PointerEvent} */ (e), e.type === 'pointercancel');
    };
    /** @type {[string, EventListener][]} */
    const listeners = [['pointermove', onMove], ['pointerup', onEnd], ['pointercancel', onEnd]];
    if (mouse) listeners.push(['mousemove', onMove], ['mouseup', onEnd]);
    for (const [type, fn] of listeners) window.addEventListener(type, fn, true);
  }
  /** @param {PointerEvent} ev @param {{onStart: () => boolean, onMove: (dist: number[], e: PointerEvent) => void}} handlers */
  function track(ev, {onStart, onMove}) {
    const start = [ev.clientX, ev.clientY];
    let started = false, failed = false;
    follow(ev, {
      move: e => {
        if (failed) return;
        const dist = [e.clientX - start[0], e.clientY - start[1]];
        if (!started) {
          if (Math.hypot(...dist) < CLICK_SLOP) return;
          started = onStart();
          if (!started) { failed = true; return; }
        }
        onMove(dist, e);
      },
      end: () => { if (started) endGesture(); }
    });
  }
  /** @param {PointerEvent} ev */
  function startMove(ev) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    track(ev, {onStart: () => { begin(); return !!gesture; }, onMove: (dist, e) => applyDrag(dist, e.altKey)});
  }
  /** @param {PointerEvent} ev @param {Dir} dir */
  function startResize(ev, dir) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    track(ev, {
      onStart: () => { begin(); return !!gesture; },
      onMove: (dist, e) => applyResize(dist, dir, {free: e.altKey, keepRatio: e.shiftKey && gesture?.records.length === 1})
    });
  }
  // `clicked`: the locked object the press started on; a click without
  // dragging selects it (to unlock it or change its colour), Shift+click toggles it.
  /** @param {PointerEvent} ev @param {Overlay} entry @param {string | null} [clicked] */
  function startMarquee(ev, entry, clicked = null) {
    // Text selection on the blank sheet is cancelled on mousedown (below), not
    // here: cancelling pointerdown would also suppress the mouseup fallback.
    const focus = document.activeElement;
    if (focus instanceof HTMLElement && focus.closest('.page')) focus.blur();
    // Capture so the release always comes back here, whatever the browser starts.
    try { entry.page.setPointerCapture(ev.pointerId); } catch (error) { /* synthetic or already released */ }
    const from = toMm(entry.page, ev), additive = ev.shiftKey, before = ids.slice();
    const pageNumber = Number(entry.page.dataset.page);
    let moved = false;
    const box = (/** @type {PointerEvent} */ e) => rectFromPoints(from, toMm(entry.page, e));
    follow(ev, {
      move: e => {
        if (!moved && Math.hypot(e.clientX - ev.clientX, e.clientY - ev.clientY) < CLICK_SLOP) return;
        moved = true;
        const r = box(e);
        entry.marquee.hidden = false;
        Object.assign(entry.marquee.style, {left: mm(r.x), top: mm(r.y), width: mm(r.w), height: mm(r.h)});
      },
      end: (e, cancelled) => {
        entry.marquee.hidden = true;
        if (cancelled) return; // interrupted: keep the selection as it was
        if (!moved) {
          if (clicked) setSelection(!additive ? [clicked] : before.includes(clicked) ? before.filter(id => id !== clicked) : [...before, clicked], clicked);
          else if (!additive) setSelection([]);
          return;
        }
        // The marquee passes over locked objects (a background, a section frame).
        const candidates = objects().filter(item => (item.page || 1) === pageNumber && !item.locked).map(item => ({id: item.id, ...boxOf(item)}));
        // Top-left first: «one width/height» takes the first selected one as its model.
        const hits = marqueeHits(box(e), candidates).sort((a, b) => a.y - b.y || a.x - b.x).map(b => b.id);
        setSelection(additive ? [...before, ...hits] : hits);
      }
    });
  }

  // A press on a locked object (not on its text) behaves like one on the blank sheet.
  const pressesLocked = (/** @type {Event} */ e) => {
    const element = target(e).closest?.('.el');
    return !!element && locked(element.dataset.id || '') && !target(e).closest('.text-wrap, ' + NATIVE);
  };
  // Firefox starts its own (Shift-)selection on the compatibility mousedown,
  // which pointerdown's preventDefault does not stop: cancel it on blank sheet.
  layers.forEach(({page}) => page.addEventListener('mousedown', e => {
    if (e.button === 0 && (!target(e).closest?.('.el') || pressesLocked(e))) e.preventDefault();
  }, true));
  // Capture phase: decide before Tiptap's own pointerdown handlers run.
  layers.forEach(entry => entry.page.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const page = entry.page;
    const element = target(e).closest?.('.el');
    if (!element || element.closest('.page') !== page) {
      if (!target(e).closest?.('.el')) startMarquee(e, entry);
      return;
    }
    const id = element.dataset.id || '';
    const wrap = target(e).closest('.text-wrap');
    if (wrap && inner) {
      if (e.shiftKey) {
        e.preventDefault(); e.stopPropagation();
        inner.toggleField(id, wrap.dataset.field || '');
      } else inner.selectField(id, wrap.dataset.field || '');
      return; // Tiptap receives normal clicks; no parent drag starts.
    }
    if (e.altKey) return; // Alt+drag within a card is the nested text-frame marquee.
    if (pressesLocked(e)) { startMarquee(e, entry, id); return; }
    if (e.shiftKey) {
      e.preventDefault();
      setSelection(ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
      return;
    }
    if (inner?.hasSelection() || !ids.includes(id)) setSelection([id], id);
    if (target(e).closest(NATIVE)) return; // editors, inputs, badge and grip keep their own behaviour
    track(e, {onStart: () => { begin(); return !!gesture; }, onMove: (dist, ev) => applyDrag(dist, ev.altKey)});
  }, true));

  // The text box grip (⠿) moves its box even when the click starts on it.
  /** @param {PointerEvent} e @param {string} id */
  function startDrag(e, id) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (!ids.includes(id)) setSelection([id], id);
    if (locked(id)) return;
    track(e, {onStart: () => { begin(); return !!gesture; }, onMove: (dist, ev) => applyDrag(dist, ev.altKey)});
  }
  // Arrow keys: move the unlocked selected objects by (dx, dy) mm, as a group
  // that stays on the page. With `grid`, the group's left/top edge goes to the
  // next grid line instead. A series of presses is one undo step.
  /** @param {number} dx @param {number} dy @param {{grid?: number}} [options] */
  function nudge(dx, dy, {grid = 0} = {}) {
    if (!ids.length) return false;
    const records = itemsOf(ids).filter(item => !item.locked).map(item => ({item, ...boxOf(item)}));
    if (!records.length) return true;
    const frame = bbox(records);
    if (grid) {
      if (dx) dx = gridStep(frame.x, Math.sign(dx), grid);
      if (dy) dy = gridStep(frame.y, Math.sign(dy), grid);
    }
    ({dx, dy} = clampMove(records, dx, dy));
    if (!dx && !dy) return true;
    for (const {item} of records) { item.x += dx; item.y += dy; }
    store.commit({group: 'nudge:' + ids.join(','), windowMs: 1000});
    return true;
  }
  // The selection for the «Выравнивание» tab: rendered boxes in selection order;
  // `commit` writes the changed sides back as one undo step. Locked objects
  // count (others align to them) but never change.
  function arrangeTargets() {
    const items = itemsOf(ids);
    if (!items.length) return null;
    return {
      boxes: items.map(item => boxOf(item)),
      fixed: items.map(item => !!item.locked),
      area: PAGE_FRAME,
      /** @param {Box[]} next */
      commit(next) {
        store.change(() => items.forEach((item, i) => {
          if (item.locked) return;
          const now = boxOf(item);
          for (const key of /** @type {const} */ (['x', 'y', 'w', 'h'])) {
            if (Math.abs(next[i][key] - now[key]) < 1e-9) continue;
            if (key === 'h' && item.kind === 'shape' && item.shape === 'line') continue; // a line stays 2 px
            if (key === 'h' && item.kind === 'textbox') item.autoHeight = false;
            item[key] = next[i][key];
          }
        }));
      }
    };
  }
  function afterDraw() {
    for (const id of ids.slice()) if (!itemFor(id)) ids = ids.filter(value => value !== id);
    if (primary && !ids.includes(primary)) primary = null;
    placeLayers();
    sync();
  }
  /** @param {InnerCanvas} controller */
  function attachInner(controller) { inner = controller; sync(); }
  // Pages are centred in the stage; a window resize or zoom moves them.
  window.addEventListener('resize', () => { placeLayers(); renderFrame(); });
  placeLayers();
  return {
    setSelection, afterDraw, startDrag, attachInner, nudge, arrangeTargets,
    getIds: () => ids.slice(),
    getPrimary: () => primary,
    clear: () => setSelection([])
  };
}
