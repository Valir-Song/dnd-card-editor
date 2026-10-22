// Canvas-level selection and geometry for page objects: one pointer-events
// gesture layer (drag, 8-handle resize, marquee) that works in layout
// millimetres. Rich text stays Tiptap-owned: a press on editable text is never
// a gesture. Text frames inside cards are handled by inner-canvas.js.
import { collectLines, snapAxis, snapMove } from './snapping.js';
import { bbox, resizeBox, scaleBoxes, marqueeHits, rectFromPoints } from './geometry.js';

const DIRECTIONS = {nw: [-1, -1], n: [0, -1], ne: [1, -1], w: [-1, 0], e: [1, 0], sw: [-1, 1], s: [0, 1], se: [1, 1]};
const EDGES = ['top', 'right', 'bottom', 'left'];
const CLICK_SLOP = 3; // px a press may wander and still count as a click
const NATIVE = '.editable, [contenteditable], input, textarea, select, .level, .textbox-move';

/** @param {import('../types/layout').Deps} deps */
export function createCanvasControls({pages, store, onSelection, mm, snapping}) {
  let ids = [];
  let primary = null;
  let gesture = null;
  let inner = null;
  const nodeFor = id => pages.flatMap(page => [...page.querySelectorAll('.el')]).find(node => node.dataset.id === id);
  const elements = () => ids.map(nodeFor).filter(Boolean);
  const mmPerPx = page => 210 / page.getBoundingClientRect().width;
  const itemFor = id => store.find(id);
  const clip = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  const toMm = (page, ev) => {
    const r = page.getBoundingClientRect(), k = 210 / r.width;
    return [(ev.clientX - r.left) * k, (ev.clientY - r.top) * k];
  };
  // Current geometry in mm; an auto-height text box is as tall as it renders.
  function boxOf(item, node = nodeFor(item.id)) {
    const h = item.kind === 'textbox' && item.autoHeight && node
      ? node.getBoundingClientRect().height * mmPerPx(node.closest('.page')) : item.h;
    return {x: item.x, y: item.y, w: item.w, h};
  }

  // ---- overlay: one layer per page, positioned over it inside the stage ----
  const stage = pages[0].closest('.stage') || document.body;
  const layers = pages.map(page => {
    const layer = document.createElement('div');
    layer.className = 'gesture-layer';
    layer.dataset.page = page.dataset.page;
    const frame = document.createElement('div');
    frame.className = 'gesture-frame';
    frame.hidden = true;
    for (const edge of EDGES) {
      const band = document.createElement('div');
      band.className = 'gesture-edge ' + edge;
      band.title = 'Перетащить';
      band.addEventListener('pointerdown', ev => startMove(ev, page));
      frame.append(band);
    }
    for (const [name, dir] of Object.entries(DIRECTIONS)) {
      const handle = document.createElement('div');
      handle.className = 'gesture-handle';
      handle.dataset.dir = name;
      handle.addEventListener('pointerdown', ev => startResize(ev, page, dir));
      frame.append(handle);
    }
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
    const targets = inner?.hasSelection() ? [] : ids.map(itemFor).filter(Boolean);
    const page = targets.length ? (targets[0].page || 1) : null;
    for (const {layer, frame} of layers) {
      const show = page !== null && Number(layer.dataset.page) === page;
      frame.hidden = !show;
      if (!show) continue;
      const b = bbox(targets.map(item => boxOf(item)));
      Object.assign(frame.style, {left: mm(b.x), top: mm(b.y), width: mm(b.w), height: mm(b.h)});
      frame.classList.toggle('group', targets.length > 1);
    }
  }

  // ---- selection ----
  function setSelection(next, preferred = null, {keepInner = false} = {}) {
    if (!keepInner) inner?.clear();
    const unique = [...new Set(next)].filter(id => !!itemFor(id));
    const first = unique[0], page = first ? (itemFor(first).page || 1) : null;
    ids = unique.filter(id => (itemFor(id).page || 1) === page);
    primary = ids.includes(preferred) ? preferred : (ids.length === 1 ? ids[0] : null);
    sync();
    onSelection(ids.slice(), primary);
  }
  function sync() {
    const chosen = new Set(ids);
    for (const page of pages) for (const node of page.querySelectorAll('.el')) {
      node.classList.toggle('selected', chosen.has(node.dataset.id));
    }
    renderFrame();
    const status = document.getElementById('selectionCount');
    if (status) status.textContent = inner?.hasSelection()
      ? (inner.count() > 1 ? 'Текстовых блоков: ' + inner.count() : 'Выбран текстовый блок')
      : ids.length > 1 ? 'Выбрано: ' + ids.length : '';
  }

  // ---- gestures ----
  function begin() {
    const chosen = ids.map(id => ({id, item: itemFor(id), node: nodeFor(id)}))
      .filter(record => record.item && record.node);
    if (!chosen.length) { gesture = null; return; }
    const page = chosen[0].node.closest('.page');
    const scale = mmPerPx(page);
    const settings = snapping?.get();
    const records = chosen.map(record => ({...record, ...boxOf(record.item, record.node)}));
    gesture = {
      scale, page, records, frame: bbox(records),
      // Snap lines are fixed for the gesture: everything that is not moving.
      lines: settings?.enabled ? collectLines(store.items, chosen[0].item.page || 1, new Set(chosen.map(r => r.id))) : null,
      grid: settings?.enabled ? settings.gridMm : 0,
      threshold: 6 * scale // 6 screen pixels, whatever the zoom
    };
    document.body.classList.add('gesture-active');
  }
  function applyDrag(dist, free = false) {
    if (!gesture || !dist) return;
    const {records, scale} = gesture;
    let rawX = dist[0] * scale, rawY = dist[1] * scale, guides = {x: null, y: null};
    if (gesture.lines && !free) ({dx: rawX, dy: rawY, guides} = snapMove(gesture.frame, rawX, rawY, gesture.lines, gesture));
    showGuides(guides);
    const dx = clip(rawX, Math.max(...records.map(r => -r.x)), Math.min(...records.map(r => 210 - r.x - r.w)));
    const dy = clip(rawY, Math.max(...records.map(r => -r.y)), Math.min(...records.map(r => 297 - r.y - r.h)));
    for (const r of records) place(r, {x: r.x + dx, y: r.y + dy});
    renderFrame();
  }
  function applyResize(dist, dir, {free = false, keepRatio = false} = {}) {
    if (!gesture) return;
    const {records, scale} = gesture;
    let dx = dist[0] * scale, dy = dist[1] * scale;
    const single = records.length === 1;
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
  function place(record, box) {
    Object.assign(record.item, box);
    for (const key of Object.keys(box)) record.node.style[{x: 'left', y: 'top', w: 'width', h: 'height'}[key]] = mm(box[key]);
  }
  // Thin guide lines on the page of the gesture; hidden in print.
  function showGuides({x, y}) {
    const page = gesture?.page;
    for (const p of pages) for (const [axis, value] of [['x', x], ['y', y]]) {
      let line = p.querySelector(':scope > .snap-guide.' + axis);
      if (p !== page || value === null) { line?.remove(); continue; }
      if (!line) { line = document.createElement('div'); line.className = 'snap-guide ' + axis; p.append(line); }
      line.style[axis === 'x' ? 'left' : 'top'] = mm(value);
    }
  }
  function endGesture() {
    document.body.classList.remove('gesture-active');
    if (!gesture) return;
    showGuides({x: null, y: null});
    gesture = null;
    // One history checkpoint per drag or resize, regardless of the number of targets.
    store.commit();
    renderFrame();
  }
  // Follow one pointer until it is released. Listeners attach synchronously in
  // the pointerdown, so no movement is lost however fast the input is. For a
  // mouse, mousemove/mouseup back up the pointer events: with Shift held,
  // Firefox can swallow pointerup while it runs its own selection.
  function follow(ev, {move, end}) {
    const id = ev.pointerId, mouse = ev.pointerType === 'mouse';
    const mine = e => e.pointerId === undefined ? mouse : e.pointerId === id;
    const onMove = e => { if (mine(e)) move(e); };
    const onEnd = e => {
      if (!mine(e)) return;
      for (const [type, fn] of listeners) window.removeEventListener(type, fn, true);
      end(e, e.type === 'pointercancel');
    };
    /** @type {[string, EventListener][]} */
    const listeners = [['pointermove', onMove], ['pointerup', onEnd], ['pointercancel', onEnd]];
    if (mouse) listeners.push(['mousemove', onMove], ['mouseup', onEnd]);
    for (const [type, fn] of listeners) window.addEventListener(type, fn, true);
  }
  function track(ev, {onStart, onMove}) {
    const start = [ev.clientX, ev.clientY];
    let started = false, failed = false;
    follow(ev, {
      move: e => {
        if (failed) return;
        const dist = [e.clientX - start[0], e.clientY - start[1]];
        if (!started) {
          if (Math.hypot(...dist) < CLICK_SLOP) return;
          started = onStart() !== false;
          if (!started) { failed = true; return; }
        }
        onMove(dist, e);
      },
      end: () => { if (started) endGesture(); }
    });
  }
  function startMove(ev, page) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    track(ev, {onStart: () => { begin(); return !!gesture; }, onMove: (dist, e) => applyDrag(dist, e.altKey)});
  }
  function startResize(ev, page, dir) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    track(ev, {
      onStart: () => { begin(); return !!gesture; },
      onMove: (dist, e) => applyResize(dist, dir, {free: e.altKey, keepRatio: e.shiftKey && gesture?.records.length === 1})
    });
  }
  function startMarquee(ev, entry) {
    // Text selection on the blank sheet is cancelled on mousedown (below), not
    // here: cancelling pointerdown would also suppress the mouseup fallback.
    if (document.activeElement?.closest?.('.page')) /** @type {HTMLElement} */ (document.activeElement).blur();
    // Capture so the release always comes back here, whatever the browser starts.
    try { entry.page.setPointerCapture(ev.pointerId); } catch (error) { /* synthetic or already released */ }
    const from = toMm(entry.page, ev), additive = ev.shiftKey, before = ids.slice();
    const pageNumber = Number(entry.page.dataset.page);
    let moved = false;
    const box = e => rectFromPoints(from, toMm(entry.page, e));
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
        if (!moved) { if (!additive) setSelection([]); return; }
        const candidates = store.items.filter(item => (item.page || 1) === pageNumber).map(item => ({id: item.id, ...boxOf(item)}));
        const hits = marqueeHits(box(e), candidates).map(b => b.id);
        setSelection(additive ? [...before, ...hits] : hits);
      }
    });
  }

  // Firefox starts its own (Shift-)selection on the compatibility mousedown,
  // which pointerdown's preventDefault does not stop: cancel it on blank sheet.
  layers.forEach(({page}) => page.addEventListener('mousedown', e => {
    if (e.button === 0 && !e.target.closest?.('.el')) e.preventDefault();
  }, true));
  // Capture phase: decide before Tiptap's own pointerdown handlers run.
  layers.forEach(entry => entry.page.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const page = entry.page;
    const element = e.target.closest?.('.el');
    if (!element || element.closest('.page') !== page) {
      if (!e.target.closest?.('.el')) startMarquee(e, entry);
      return;
    }
    const id = element.dataset.id;
    const wrap = e.target.closest('.text-wrap');
    if (wrap && inner) {
      if (e.shiftKey) {
        e.preventDefault(); e.stopPropagation();
        inner.toggleField(id, wrap.dataset.field);
      } else inner.selectField(id, wrap.dataset.field);
      return; // Tiptap receives normal clicks; no parent drag starts.
    }
    if (e.altKey) return; // Alt+drag within a card is the nested text-frame marquee.
    if (e.shiftKey) {
      e.preventDefault();
      setSelection(ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
      return;
    }
    if (inner?.hasSelection() || !ids.includes(id)) setSelection([id], id);
    if (e.target.closest(NATIVE)) return; // editors, inputs, badge and grip keep their own behaviour
    track(e, {onStart: () => { begin(); return !!gesture; }, onMove: (dist, ev) => applyDrag(dist, ev.altKey)});
  }, true));

  // The text box grip (⠿) moves its box even when the click starts on it.
  function startDrag(e, id) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (!ids.includes(id)) setSelection([id], id);
    track(e, {onStart: () => { begin(); return !!gesture; }, onMove: (dist, ev) => applyDrag(dist, ev.altKey)});
  }
  function afterDraw() {
    for (const id of ids.slice()) if (!itemFor(id)) ids = ids.filter(value => value !== id);
    if (primary && !ids.includes(primary)) primary = null;
    placeLayers();
    sync();
  }
  function attachInner(controller) { inner = controller; sync(); }
  // Pages are centred in the stage; a window resize or zoom moves them.
  window.addEventListener('resize', () => { placeLayers(); renderFrame(); });
  placeLayers();
  return {
    setSelection, afterDraw, startDrag, attachInner,
    getIds: () => ids.slice(),
    getPrimary: () => primary,
    clear: () => setSelection([])
  };
}
