// Geometry for text fields INSIDE a card/section/note, on the same gesture
// layer as page objects. A field belongs to its parent: offsets and optional
// dimensions live only in item.textFrames[field] = {x,y,w,h} (mm, relative to
// the field's ordinary position). Tiptap owns the text; this module owns the
// frame, its drag bands and handles, and the Alt+marquee inside a card.
import { bbox, resizeBox, scaleBoxes, marqueeHits, rectFromPoints } from './geometry.js';
import { boxLines, snapAxis, snapMove } from './snapping.js';
import { target } from './dom.js';

/** @typedef {import('../types/geometry').Box} Box */
/** @typedef {import('../types/geometry').Dir} Dir */
/** @typedef {import('../types/layout').Item} Item */
/** @typedef {import('../types/layout').Frame} Frame */
/** @typedef {ReturnType<typeof import('./snapping.js').createSnapSettings>} Snapping */
/** One dragged text frame: its stored offsets, their value at the start and its box on the page. */
/** @typedef {{node: HTMLElement, position: Frame, x: number, y: number, abs: Box}} FrameRecord */
/** @typedef {{records: FrameRecord[], frame: Box, scale: number, lines: import('../types/geometry').Lines | null, card: Box, threshold: number}} Gesture */

/** @type {Record<string, Dir>} */
const DIRECTIONS = {nw: [-1, -1], n: [0, -1], ne: [1, -1], w: [-1, 0], e: [1, 0], sw: [-1, 1], s: [0, 1], se: [1, 1]};
const EDGES = ['top', 'right', 'bottom', 'left'];
const CLICK_SLOP = 3;
const NO_LIMIT = {w: Infinity, h: Infinity};

/**
 * @param {import('../types/layout').Deps<'pages' | 'mm'> & {selectParent: (id: string) => void, snapping?: Snapping}} deps
 */
export function createInnerCanvas({pages, store, mm, selectParent, snapping}) {
  /** @type {string | null} */
  let parentId = null;
  /** @type {string[]} */
  let fields = [];
  /** @type {Gesture | null} */
  let gesture = null;
  const unique = (/** @type {string[]} */ values) => [...new Set(values)];
  const parentFor = (/** @type {string | null} */ id) => id === null ? undefined : store.find(id);
  const parentNode = (/** @type {string | null} */ id) => pages.flatMap(p => [...p.querySelectorAll('.el')]).find(el => el.dataset.id === id);
  const wraps = (/** @type {string | null} */ id) => [...(parentNode(id)?.querySelectorAll('.text-wrap') || [])];
  const nodeFor = (/** @type {string | null} */ id, /** @type {string} */ field) => wraps(id).find(el => el.dataset.field === field);
  const currentTargets = () => fields.map(field => nodeFor(parentId, field)).filter(/** @returns {node is HTMLElement} */ node => !!node);
  /** The stored offsets of a text, created on first use. @param {Item} item @param {string | undefined} field @returns {Frame} */
  const frameData = (item, field = '') => { const frames = item.textFrames ||= {}; return frames[field] ||= {}; };
  const selected = () => fields.length > 0;
  /** @param {HTMLElement} node */
  const pageOf = node => {
    const page = node.closest('.page');
    if (!page) throw Error('A text frame outside the pages');
    return page;
  };
  // Rendered rectangle of a node in page millimetres.
  /** @param {HTMLElement} node @returns {Box} */
  function rectMm(node) {
    const p = pageOf(node).getBoundingClientRect(), r = node.getBoundingClientRect(), k = 210 / p.width;
    return {x: (r.left - p.left) * k, y: (r.top - p.top) * k, w: r.width * k, h: r.height * k};
  }
  // The card's area inside its padding, where its texts normally sit.
  /** @param {HTMLElement} card @returns {Box} */
  function innerArea(card) {
    const outer = rectMm(card), style = getComputedStyle(card);
    const k = 210 / pageOf(card).getBoundingClientRect().width;
    const pad = (/** @type {'left' | 'top' | 'right' | 'bottom'} */ side) => (parseFloat(style.getPropertyValue('padding-' + side)) || 0) * k;
    return {x: outer.x + pad('left'), y: outer.y + pad('top'), w: outer.w - pad('left') - pad('right'), h: outer.h - pad('top') - pad('bottom')};
  }

  // ---- overlay inside the page-level gesture layers ----
  // One per page; pages come and go (4.2), see syncOverlays.
  /** @type {{page: HTMLElement, frame: HTMLElement, marquee: HTMLElement}[]} */
  let overlays = [];
  /** @param {HTMLElement} page */
  function makeOverlay(page) {
    // The sheet's gesture layers (canvas-controls.js) exist already.
    const layer = page.closest('.stage')?.querySelector('.gesture-layer[data-page="' + page.dataset.page + '"]');
    if (!layer) throw Error('No gesture layer for page ' + page.dataset.page);
    const frame = document.createElement('div');
    frame.className = 'gesture-frame inner';
    frame.hidden = true;
    for (const edge of EDGES) {
      const band = document.createElement('div');
      band.className = 'gesture-edge ' + edge;
      band.title = 'Перетащить текстовый блок';
      band.addEventListener('pointerdown', ev => press(ev, null));
      frame.append(band);
    }
    for (const [name, dir] of Object.entries(DIRECTIONS)) {
      const handle = document.createElement('div');
      handle.className = 'gesture-handle';
      handle.dataset.dir = name;
      handle.addEventListener('pointerdown', ev => press(ev, dir));
      frame.append(handle);
    }
    const marquee = document.createElement('div');
    marquee.className = 'gesture-marquee inner';
    marquee.hidden = true;
    layer.append(frame, marquee);
    const entry = {page, frame, marquee};
    page.addEventListener('pointerdown', ev => altMarquee(ev, entry), true);
    return entry;
  }
  function syncOverlays() {
    overlays = overlays.filter(entry => pages.includes(entry.page));
    for (const page of pages) if (!overlays.some(entry => entry.page === page)) overlays.push(makeOverlay(page));
  }
  syncOverlays();
  function render() {
    const targets = currentTargets();
    const page = targets[0]?.closest('.page');
    for (const {page: p, frame} of overlays) {
      frame.hidden = !targets.length || p !== page;
      if (frame.hidden) continue;
      const b = bbox(targets.map(rectMm));
      Object.assign(frame.style, {left: mm(b.x), top: mm(b.y), width: mm(b.w), height: mm(b.h)});
      frame.classList.toggle('group', targets.length > 1);
      // Text in a locked card is still edited, but its frames stay put.
      frame.classList.toggle('locked', !!parentFor(parentId)?.locked);
    }
  }
  // Text is live DOM: formatting can change a frame's natural size without a
  // redraw, so follow the selected frames' size and the window.
  let pending = 0;
  const schedule = () => { if (!pending && !gesture) pending = requestAnimationFrame(() => { pending = 0; render(); }); };
  const sizeObserver = new ResizeObserver(schedule);
  window.addEventListener('resize', schedule);

  function sync() {
    const chosen = new Set(fields);
    for (const page of pages) for (const wrap of page.querySelectorAll('.text-wrap')) {
      wrap.classList.toggle('inner-selected', wrap.closest('.el')?.dataset.id === parentId && chosen.has(wrap.dataset.field || ''));
    }
    const targets = currentTargets();
    sizeObserver.disconnect();
    targets.forEach(node => sizeObserver.observe(node));
    render();
    const status = document.getElementById('selectionCount');
    if (selected() && status) status.textContent = fields.length > 1 ? 'Текстовых блоков: ' + fields.length : 'Выбран текстовый блок';
  }
  function clear() {
    if (!selected()) return;
    parentId = null; fields = []; sync();
  }
  /** @param {string} id @param {string[]} next */
  function setFields(id, next) {
    const valid = wraps(id).map(el => el.dataset.field || '');
    if (!parentFor(id) || !valid.length) return;
    const names = unique(next).filter(field => valid.includes(field));
    if (!names.length) { clear(); selectParent(id); return; }
    parentId = id; fields = names;
    // The parent stays the selected record; its page frame hides while a child owns the handles.
    selectParent(id);
    sync();
  }
  const selectField = (/** @type {string} */ id, /** @type {string} */ field) => setFields(id, [field]);
  /** @param {string} id @param {string} field */
  function toggleField(id, field) {
    setFields(id, id === parentId
      ? (fields.includes(field) ? fields.filter(f => f !== field) : [...fields, field])
      : [field]);
  }

  // ---- gestures: drag (dir === null) or resize from a handle ----
  function begin() {
    const owner = parentFor(parentId), chosen = currentTargets();
    if (!owner || owner.locked || !chosen.length) return false;
    const records = chosen.map(node => {
      const position = frameData(owner, node.dataset.field), abs = rectMm(node);
      const x = position.x || 0, y = position.y || 0;
      return {node, position, x, y, abs};
    });
    const scale = 210 / pageOf(chosen[0]).getBoundingClientRect().width, card = parentNode(parentId);
    if (!card) return false;
    // Texts snap to their own card only — its edges, its inner area, its centre
    // lines and its other texts — never to the sheet, the grid or other cards.
    const still = wraps(parentId).filter(node => !chosen.includes(node)).map(rectMm);
    const lines = snapping?.get().enabled ? boxLines([rectMm(card), innerArea(card), ...still]) : null;
    gesture = {records, frame: bbox(records.map(r => r.abs)), scale, lines, card: rectMm(card), threshold: 6 * scale};
    document.body.classList.add('gesture-active');
    return true;
  }
  /** @param {number[]} dist @param {boolean} [free] */
  function drag(dist, free = false) {
    if (!gesture) return;
    const scale = gesture.scale;
    /** @type {{x: number | null, y: number | null}} */
    let guides = {x: null, y: null};
    let [dx, dy] = dist.map(v => v * scale);
    if (gesture.lines && !free) ({dx, dy, guides} = snapMove(gesture.frame, dx, dy, gesture.lines, {threshold: gesture.threshold}));
    showGuides(guides);
    for (const r of gesture.records) setFrame(r, {x: r.x + dx, y: r.y + dy});
    render();
  }
  /** @param {number[]} dist @param {Dir} dir @param {boolean} [free] */
  function resize(dist, dir, free = false) {
    if (!gesture) return;
    const scale = gesture.scale;
    let [dx, dy] = dist.map(v => v * scale);
    /** @type {{x: number | null, y: number | null}} */
    const guides = {x: null, y: null};
    const {records} = gesture, single = records.length === 1;
    // Only the dragged edges of a single frame snap, as on the sheet.
    if (single && gesture.lines && !free) {
      const f = gesture.frame;
      if (dir[0]) {
        const snap = snapAxis([dir[0] > 0 ? f.x + f.w + dx : f.x + dx], gesture.lines.x, gesture.threshold);
        dx += snap.offset; guides.x = snap.line;
      }
      if (dir[1]) {
        const snap = snapAxis([dir[1] > 0 ? f.y + f.h + dy : f.y + dy], gesture.lines.y, gesture.threshold);
        dy += snap.offset; guides.y = snap.line;
      }
    }
    showGuides(guides);
    const to = resizeBox(gesture.frame, dir, dx, dy, {min: single ? {w: 8, h: 3} : {w: 1, h: 1}, page: NO_LIMIT});
    const boxes = single ? [to] : scaleBoxes(records.map(r => r.abs), gesture.frame, to);
    // Offsets change by exactly how far the box moved, so a fixed edge stays exact.
    records.forEach((r, i) => setFrame(r, {
      x: r.x + (boxes[i].x - r.abs.x), y: r.y + (boxes[i].y - r.abs.y),
      w: Math.max(8, boxes[i].w), h: Math.max(3, boxes[i].h)
    }));
    render();
  }
  // Guide lines across the card only (the sheet's guides span the page).
  /** @param {{x: number | null, y: number | null}} guides */
  function showGuides({x, y}) {
    const page = gesture?.records[0].node.closest('.page'), card = gesture?.card;
    /** @type {Array<['x' | 'y', number | null]>} */
    const axes = [['x', x], ['y', y]];
    for (const p of pages) for (const [axis, value] of axes) {
      let line = p.querySelector(':scope > .snap-guide.inner-guide.' + axis);
      if (p !== page || value === null || !card) { line?.remove(); continue; }
      if (!line) { line = document.createElement('div'); line.className = 'snap-guide inner-guide ' + axis; p.append(line); }
      Object.assign(line.style, axis === 'x' ? {left: mm(value), top: mm(card.y), height: mm(card.h)} : {top: mm(value), left: mm(card.x), width: mm(card.w)});
    }
  }
  /** @param {FrameRecord} record @param {Frame} values */
  function setFrame(record, values) {
    Object.assign(record.position, values);
    const p = record.position;
    record.node.style.transform = 'translate(' + mm(p.x || 0) + ', ' + mm(p.y || 0) + ')';
    if (values.w !== undefined) record.node.style.width = mm(values.w);
    if (values.h !== undefined) { record.node.style.height = mm(values.h); record.node.classList.add('sized'); }
  }
  /** @param {PointerEvent} ev @param {Dir | null} dir */
  function press(ev, dir) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    const id = ev.pointerId, start = [ev.clientX, ev.clientY];
    let started = false;
    const move = (/** @type {PointerEvent} */ e) => {
      if (e.pointerId !== id) return;
      const dist = [e.clientX - start[0], e.clientY - start[1]];
      if (!started) {
        if (Math.hypot(...dist) < CLICK_SLOP) return;
        if (!(started = begin())) return done();
      }
      dir ? resize(dist, dir, e.altKey) : drag(dist, e.altKey);
    };
    const done = (/** @type {PointerEvent | undefined} */ e) => {
      if (e && e.pointerId !== id) return;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', done, true);
      window.removeEventListener('pointercancel', done, true);
      document.body.classList.remove('gesture-active');
      if (!started) return;
      showGuides({x: null, y: null});
      gesture = null;
      store.commit(); // the whole gesture is one undo checkpoint
      render();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', done, true);
    window.addEventListener('pointercancel', done, true);
  }

  // ---- Alt+marquee from a blank area inside a card picks its text fields ----
  /** @param {PointerEvent} ev @param {{page: HTMLElement, marquee: HTMLElement}} entry */
  function altMarquee(ev, entry) {
    if (ev.button !== 0 || !ev.altKey) return;
    const card = target(ev).closest?.('.el');
    if (!card || target(ev).closest('.text-wrap, .editable, [contenteditable], .level, .pools button, .spell-info')) return;
    ev.preventDefault();
    /** @type {(e: PointerEvent) => import('../types/geometry').Point} */
    const toMm = e => { const p = entry.page.getBoundingClientRect(), k = 210 / p.width; return [(e.clientX - p.left) * k, (e.clientY - p.top) * k]; };
    const from = toMm(ev);
    let moved = false;
    const move = (/** @type {PointerEvent} */ e) => {
      if (e.pointerId !== ev.pointerId) return;
      if (!moved && Math.hypot(e.clientX - ev.clientX, e.clientY - ev.clientY) < CLICK_SLOP) return;
      moved = true;
      const r = rectFromPoints(from, toMm(e));
      entry.marquee.hidden = false;
      Object.assign(entry.marquee.style, {left: mm(r.x), top: mm(r.y), width: mm(r.w), height: mm(r.h)});
    };
    const up = (/** @type {PointerEvent} */ e) => {
      if (e.pointerId !== ev.pointerId) return;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      entry.marquee.hidden = true;
      if (!moved) return;
      const id = card.dataset.id || '';
      const boxes = wraps(id).map(node => ({field: node.dataset.field || '', ...rectMm(node)}));
      const found = marqueeHits(rectFromPoints(from, toMm(e)), boxes, 0.08).map(b => b.field);
      if (found.length) setFields(id, found);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }

  // The selected text frames for the «Выравнивание» tab, in page millimetres. A
  // single frame aligns to the card's inner area (inside its padding); frames
  // of a locked card stay. `commit` turns new boxes into offsets and sizes.
  function arrangeTargets() {
    const owner = parentFor(parentId), nodes = currentTargets(), card = parentNode(parentId);
    if (!owner || !nodes.length || !card) return null;
    const area = innerArea(card), boxes = nodes.map(rectMm);
    return {
      boxes, area,
      fixed: nodes.map(() => !!owner.locked),
      /** @param {Box[]} next */
      commit(next) {
        if (owner.locked) return;
        nodes.forEach((node, i) => {
          const position = frameData(owner, node.dataset.field), from = boxes[i], to = next[i];
          position.x = (position.x || 0) + to.x - from.x;
          position.y = (position.y || 0) + to.y - from.y;
          if (Math.abs(to.w - from.w) > 1e-9) position.w = Math.max(8, to.w);
          if (Math.abs(to.h - from.h) > 1e-9) position.h = Math.max(3, to.h);
        });
        store.commit();
      }
    };
  }
  // Arrow keys: the selected frames move by (dx, dy) mm inside their card
  // (not in a locked one). A series of presses is one undo step.
  /** @param {number} dx @param {number} dy */
  function nudge(dx, dy) {
    const owner = parentFor(parentId);
    if (!selected() || !owner) return false;
    if (owner.locked) return true;
    for (const field of fields) {
      const position = frameData(owner, field);
      position.x = (position.x || 0) + dx; position.y = (position.y || 0) + dy;
    }
    store.commit({group: 'nudge:' + parentId + ':' + fields.join(','), windowMs: 1000});
    return true;
  }
  function afterDraw() {
    syncOverlays();
    if (parentId) {
      const valid = wraps(parentId).map(el => el.dataset.field || '');
      fields = fields.filter(f => valid.includes(f));
      if (!fields.length) parentId = null;
    }
    sync();
  }
  return {
    clear, setFields, selectField, toggleField, afterDraw, nudge, arrangeTargets,
    hasSelection: selected,
    belongsTo: (/** @type {string} */ id) => selected() && parentId === id,
    count: () => fields.length,
    getFields: () => fields.slice(),
    getParentId: () => parentId
  };
}
