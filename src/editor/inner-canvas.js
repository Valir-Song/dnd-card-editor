// Geometry for text fields INSIDE a card/section/note, on the same gesture
// layer as page objects. A field belongs to its parent: offsets and optional
// dimensions live only in item.textFrames[field] = {x,y,w,h} (mm, relative to
// the field's ordinary position). Tiptap owns the text; this module owns the
// frame, its drag bands and handles, and the Alt+marquee inside a card.
import { bbox, resizeBox, scaleBoxes, marqueeHits, rectFromPoints } from './geometry.js';

const DIRECTIONS = {nw: [-1, -1], n: [0, -1], ne: [1, -1], w: [-1, 0], e: [1, 0], sw: [-1, 1], s: [0, 1], se: [1, 1]};
const EDGES = ['top', 'right', 'bottom', 'left'];
const CLICK_SLOP = 3;
const NO_LIMIT = {w: Infinity, h: Infinity};

/** @param {import('../types/layout').Deps} deps */
export function createInnerCanvas({pages, store, mm, selectParent}) {
  let parentId = null, fields = [], gesture = null;
  const unique = values => [...new Set(values)];
  const parentFor = id => store.find(id);
  const parentNode = id => pages.flatMap(p => [...p.querySelectorAll('.el')]).find(el => el.dataset.id === id);
  const wraps = id => [...(parentNode(id)?.querySelectorAll('.text-wrap') || [])];
  const nodeFor = (id, field) => wraps(id).find(el => el.dataset.field === field);
  const currentTargets = () => fields.map(field => nodeFor(parentId, field)).filter(Boolean);
  const frameData = (item, field) => { item.textFrames ||= {}; item.textFrames[field] ||= {}; return item.textFrames[field]; };
  const selected = () => fields.length > 0;
  // Rendered rectangle of a node in page millimetres.
  function rectMm(node) {
    const page = node.closest('.page'), p = page.getBoundingClientRect(), r = node.getBoundingClientRect(), k = 210 / p.width;
    return {x: (r.left - p.left) * k, y: (r.top - p.top) * k, w: r.width * k, h: r.height * k};
  }

  // ---- overlay inside the page-level gesture layers ----
  const overlays = pages.map(page => {
    const layer = page.closest('.stage').querySelector('.gesture-layer[data-page="' + page.dataset.page + '"]');
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
    return {page, frame, marquee};
  });
  function render() {
    const targets = currentTargets();
    const page = targets[0]?.closest('.page');
    for (const {page: p, frame} of overlays) {
      frame.hidden = !targets.length || p !== page;
      if (frame.hidden) continue;
      const b = bbox(targets.map(rectMm));
      Object.assign(frame.style, {left: mm(b.x), top: mm(b.y), width: mm(b.w), height: mm(b.h)});
      frame.classList.toggle('group', targets.length > 1);
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
      wrap.classList.toggle('inner-selected', wrap.closest('.el')?.dataset.id === parentId && chosen.has(wrap.dataset.field));
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
  function setFields(id, next) {
    const valid = wraps(id).map(el => el.dataset.field);
    if (!parentFor(id) || !valid.length) return;
    const names = unique(next).filter(field => valid.includes(field));
    if (!names.length) { clear(); selectParent(id); return; }
    parentId = id; fields = names;
    // The parent stays the selected record; its page frame hides while a child owns the handles.
    selectParent(id);
    sync();
  }
  const selectField = (id, field) => setFields(id, [field]);
  function toggleField(id, field) {
    setFields(id, id === parentId
      ? (fields.includes(field) ? fields.filter(f => f !== field) : [...fields, field])
      : [field]);
  }

  // ---- gestures: drag (dir === null) or resize from a handle ----
  function begin() {
    const owner = parentFor(parentId), chosen = currentTargets();
    if (!owner || !chosen.length) return false;
    const records = chosen.map(node => {
      const position = frameData(owner, node.dataset.field), abs = rectMm(node);
      const x = position.x || 0, y = position.y || 0;
      return {node, position, x, y, abs};
    });
    gesture = {records, frame: bbox(records.map(r => r.abs)), scale: 210 / chosen[0].closest('.page').getBoundingClientRect().width};
    document.body.classList.add('gesture-active');
    return true;
  }
  function drag(dist) {
    const [dx, dy] = dist.map(v => v * gesture.scale);
    for (const r of gesture.records) setFrame(r, {x: r.x + dx, y: r.y + dy});
    render();
  }
  function resize(dist, dir) {
    const [dx, dy] = dist.map(v => v * gesture.scale);
    const {records} = gesture, single = records.length === 1;
    const to = resizeBox(gesture.frame, dir, dx, dy, {min: single ? {w: 8, h: 3} : {w: 1, h: 1}, page: NO_LIMIT});
    const boxes = single ? [to] : scaleBoxes(records.map(r => r.abs), gesture.frame, to);
    // Offsets change by exactly how far the box moved, so a fixed edge stays exact.
    records.forEach((r, i) => setFrame(r, {
      x: r.x + (boxes[i].x - r.abs.x), y: r.y + (boxes[i].y - r.abs.y),
      w: Math.max(8, boxes[i].w), h: Math.max(3, boxes[i].h)
    }));
    render();
  }
  function setFrame(record, values) {
    Object.assign(record.position, values);
    const p = record.position;
    record.node.style.transform = 'translate(' + mm(p.x || 0) + ', ' + mm(p.y || 0) + ')';
    if (values.w !== undefined) record.node.style.width = mm(p.w);
    if (values.h !== undefined) record.node.style.height = mm(p.h);
  }
  function press(ev, dir) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    const id = ev.pointerId, start = [ev.clientX, ev.clientY];
    let started = false;
    const move = e => {
      if (e.pointerId !== id) return;
      const dist = [e.clientX - start[0], e.clientY - start[1]];
      if (!started) {
        if (Math.hypot(...dist) < CLICK_SLOP) return;
        if (!(started = begin())) return done();
      }
      dir ? resize(dist, dir) : drag(dist);
    };
    const done = e => {
      if (e && e.pointerId !== id) return;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', done, true);
      window.removeEventListener('pointercancel', done, true);
      document.body.classList.remove('gesture-active');
      if (!started) return;
      gesture = null;
      store.commit(); // the whole gesture is one undo checkpoint
      render();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', done, true);
    window.addEventListener('pointercancel', done, true);
  }

  // ---- Alt+marquee from a blank area inside a card picks its text fields ----
  overlays.forEach(entry => entry.page.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 || !ev.altKey) return;
    const card = ev.target.closest?.('.el');
    if (!card || ev.target.closest('.text-wrap, .editable, [contenteditable], .level')) return;
    ev.preventDefault();
    /** @type {(e: PointerEvent) => import('../types/geometry').Point} */
    const toMm = e => { const p = entry.page.getBoundingClientRect(), k = 210 / p.width; return [(e.clientX - p.left) * k, (e.clientY - p.top) * k]; };
    const from = toMm(ev);
    let moved = false;
    const move = e => {
      if (e.pointerId !== ev.pointerId) return;
      if (!moved && Math.hypot(e.clientX - ev.clientX, e.clientY - ev.clientY) < CLICK_SLOP) return;
      moved = true;
      const r = rectFromPoints(from, toMm(e));
      entry.marquee.hidden = false;
      Object.assign(entry.marquee.style, {left: mm(r.x), top: mm(r.y), width: mm(r.w), height: mm(r.h)});
    };
    const up = e => {
      if (e.pointerId !== ev.pointerId) return;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      entry.marquee.hidden = true;
      if (!moved) return;
      const id = card.dataset.id;
      const boxes = wraps(id).map(node => ({field: node.dataset.field, ...rectMm(node)}));
      const found = marqueeHits(rectFromPoints(from, toMm(e)), boxes, 0.08).map(b => b.field);
      if (found.length) setFields(id, found);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }, true));

  function afterDraw() {
    if (parentId) {
      const valid = wraps(parentId).map(el => el.dataset.field);
      fields = fields.filter(f => valid.includes(f));
      if (!fields.length) parentId = null;
    }
    sync();
  }
  return {
    clear, setFields, selectField, toggleField, afterDraw,
    hasSelection: selected,
    belongsTo: id => selected() && parentId === id,
    count: () => fields.length,
    getFields: () => fields.slice(),
    getParentId: () => parentId
  };
}
