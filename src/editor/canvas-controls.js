// Canvas-level geometry and marquee selection. Rich text remains exclusively Tiptap-owned.
// Coordinates are persisted in millimetres; Moveable only supplies pixel gesture deltas.
import Moveable from 'moveable';
import Selecto from 'selecto';
import { collectLines, snapAxis, snapMove } from './snapping.js';

export function createCanvasControls({pages, getItems, onSelection, persist, mm, snapping}) {
  let ids = [];
  let primary = null;
  let gesture = null;
  let moveable;
  let inner=null;
  const selectos = [];
  const elements = () => ids.map(id => [...pages].flatMap(page =>
    [...page.querySelectorAll('.el')]).find(node => node.dataset.id === id)).filter(Boolean);
  const mmPerPx = page => 210 / page.getBoundingClientRect().width;
  const itemFor = id => getItems().find(item => item.id === id);
  const clip = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  function setSelection(next, preferred = null, {keepInner=false} = {}) {
    if(!keepInner)inner?.clear();
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
    const targets = inner?.hasSelection() ? [] : elements();
    if (moveable) {
      moveable.target = targets.length === 1 ? targets[0] : targets;
      moveable.updateRect();
    }
    for (let i = 0; i < selectos.length; i++) {
      selectos[i].setSelectedTargets(targets.filter(node => node.closest('.page') === pages[i]));
    }
    const status = document.getElementById('selectionCount');
    if (status) status.textContent = inner?.hasSelection()
      ? (inner.count()>1?'Текстовых блоков: '+inner.count():'Выбран текстовый блок')
      : ids.length > 1 ? 'Выбрано: ' + ids.length : '';
  }
  function begin() {
    const byId=new Map(elements().map(node => [node.dataset.id,node]));
    const chosen = ids.map(id => ({id, item: itemFor(id), node: byId.get(id)}))
      .filter(record => record.item && record.node);
    if (!chosen.length) { gesture = null; return; }
    const page = chosen[0].node.closest('.page');
    const scale = mmPerPx(page);
    const settings = snapping?.get();
    const pageNumber = chosen[0].item.page || 1;
    gesture = {
      scale, page,
      // Snap lines are fixed for the gesture: everything that is not moving.
      lines: settings?.enabled ? collectLines(getItems(), pageNumber, new Set(chosen.map(r => r.id))) : null,
      grid: settings?.enabled ? settings.gridMm : 0,
      threshold: 6 * scale, // 6 screen pixels, whatever the zoom
      records: chosen.map(record => ({
        ...record, x: record.item.x, y: record.item.y, w: record.item.w,
        h: record.item.kind === 'textbox' && record.item.autoHeight
          ? record.node.getBoundingClientRect().height * scale : record.item.h,
        pixelW: record.node.getBoundingClientRect().width,
        pixelH: record.node.getBoundingClientRect().height
      }))
    };
  }
  function applyDrag(dist, free = false) {
    if (!gesture || !dist) return;
    const {records, scale} = gesture;
    let rawX = dist[0] * scale, rawY = dist[1] * scale, guides = {x: null, y: null};
    if (gesture.lines && !free) {
      const left = Math.min(...records.map(r => r.x)), top = Math.min(...records.map(r => r.y));
      const box = {x: left, y: top,
        w: Math.max(...records.map(r => r.x + r.w)) - left, h: Math.max(...records.map(r => r.y + r.h)) - top};
      ({dx: rawX, dy: rawY, guides} = snapMove(box, rawX, rawY, gesture.lines, gesture));
    }
    showGuides(guides);
    const dx = clip(rawX, Math.max(...records.map(r => -r.x)), Math.min(...records.map(r => 210 - r.x - r.w)));
    const dy = clip(rawY, Math.max(...records.map(r => -r.y)), Math.min(...records.map(r => 297 - r.y - r.h)));
    for (const r of records) {
      r.item.x = r.x + dx;
      r.item.y = r.y + dy;
      r.node.style.left = mm(r.item.x);
      r.node.style.top = mm(r.item.y);
    }
  }
  function applyResize(e) {
    if (!gesture) return;
    const record = gesture.records.find(r => r.node === e.target);
    if (!record) return;
    const {scale} = gesture, direction = e.direction || [1, 1];
    // e.dist is the change in pixel dimensions; unlike e.width it is safe
    // when the underlying CSS width is expressed in mm instead of px.
    let width = record.w + (e.dist?.[0] ?? (e.width - record.pixelW)) * scale;
    let height = record.h + (e.dist?.[1] ?? (e.height - record.pixelH)) * scale;
    const right = record.x + record.w, bottom = record.y + record.h;
    // Snap only the edges being dragged, and only for a single object.
    const guides = {x: null, y: null};
    if (gesture.lines && gesture.records.length === 1 && !e.inputEvent?.altKey) {
      if (direction[0]) {
        const edge = direction[0] > 0 ? record.x + width : right - width;
        const snap = snapAxis([edge], gesture.lines.x, gesture.threshold, gesture.grid);
        width += direction[0] > 0 ? snap.offset : -snap.offset;
        guides.x = snap.line;
      }
      if (direction[1]) {
        const edge = direction[1] > 0 ? record.y + height : bottom - height;
        const snap = snapAxis([edge], gesture.lines.y, gesture.threshold, gesture.grid);
        height += direction[1] > 0 ? snap.offset : -snap.offset;
        guides.y = snap.line;
      }
    }
    showGuides(guides);
    const rawX = direction[0] < 0 ? right - width : record.x;
    const rawY = direction[1] < 0 ? bottom - height : record.y;
    const x = clip(rawX, 0, 210 - 12), y = clip(rawY, 0, 297 - 6);
    const w = clip(width, 12, 210 - x);
    const h = clip(height, 6, 297 - y);
    if (record.item.kind === 'textbox' && record.item.autoHeight) {
      record.item.autoHeight = false;
      record.node.classList.remove('auto-height');
      record.node.style.maxHeight = '';
    }
    Object.assign(record.item, {x, y, w, h});
    Object.assign(record.node.style, {left:mm(x), top:mm(y), width:mm(w), height:mm(h)});
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
    if (!gesture) return;
    showGuides({x: null, y: null});
    gesture = null;
    // One history checkpoint per drag or resize, regardless of the number of targets.
    persist();
    // Recalculate handles from final millimetre geometry.
    requestAnimationFrame(() => moveable.updateRect());
  }
  // Handles live inside the stage so they scroll with the pages on narrow screens.
  const stage = pages[0].closest('.stage') || document.body;
  moveable = new Moveable(stage, {
    target: [], draggable: true, resizable: true, origin: false,
    keepRatio: false, throttleDrag: 0, throttleResize: 0,
    edge: true, edgeDraggable: true, snappable: false,
    renderDirections: ['nw','n','ne','w','e','sw','s','se'],
    className: 'dnd-canvas-moveable'
  });
  moveable.on('dragStart', begin)
    .on('drag', e => applyDrag(e.beforeDist || e.dist, e.inputEvent?.altKey))
    .on('dragEnd', endGesture)
    .on('dragGroupStart', begin)
    .on('dragGroup', e => applyDrag(e.events?.[0]?.beforeDist || e.events?.[0]?.dist, e.inputEvent?.altKey))
    .on('dragGroupEnd', endGesture)
    .on('resizeStart', e => {
      begin();
      const record = gesture?.records.find(r => r.node === e.target);
      if(record) e.set([record.pixelW, record.pixelH]);
    })
    .on('resize', applyResize)
    .on('resizeEnd', endGesture)
    .on('resizeGroupStart', e => {
      begin();
      for(const ev of e.events || []){
        const record = gesture?.records.find(r => r.node === ev.target);
        if(record) ev.set([record.pixelW, record.pixelH]);
      }
    })
    .on('resizeGroup', e => { for (const ev of e.events || []) applyResize(ev); })
    .on('resizeGroupEnd', endGesture);

  pages.forEach(page => {
    const selecto = new Selecto({
      container: document.body, dragContainer: page,
      selectableTargets: ['#' + page.id + ' .el'],
      selectByClick: false, selectFromInside: false,
      continueSelect: false, hitRate: 12,
      preventDefault: false, ratio: 0
    });
    selectos.push(selecto);
    selecto.on('dragStart', e => {
      const target = e.inputEvent?.target;
      if (target?.closest?.('.el, .moveable-control-box, .text-grip, .text-resize')) e.stop();
    });
    selecto.on('selectEnd', e => {
      if (e.isDragStartEnd) return;
      const found = e.selected.filter(node => node.closest('.page') === page).map(node => node.dataset.id);
      setSelection(found);
    });
    page.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const element = e.target.closest?.('.el');
      if (!element || element.closest('.page') !== page) {
        if (e.target === page && !e.shiftKey) setSelection([]);
        return;
      }
      const id = element.dataset.id;
      const wrap = e.target.closest?.('.text-wrap');
      if(wrap && inner){
        if(e.shiftKey){
          e.preventDefault();e.stopPropagation();
          inner.toggleField(id,wrap.dataset.field);
        } else inner.selectField(id,wrap.dataset.field);
        return; // Tiptap receives normal clicks; no parent drag starts.
      }
      if(e.altKey)return; // Alt+drag within parent is nested Selecto marquee.
      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        setSelection(ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
        return;
      }
      const retarget = inner?.hasSelection() || !ids.includes(id);
      if (retarget) setSelection([id], id);
      const nativeEditor = e.target.closest('.editable, [contenteditable], input, textarea, select, .text-grip, .text-resize, .level');
      if (nativeEditor) return;
      // The gesture begins on the same click that selects the object.
      // Do not manually initiate a second drag if Moveable owns the border.
      if (!e.target.closest('.moveable-control-box')) beginDrag(e, retarget);
    });
  });
  function startDrag(e, id) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const retarget = !ids.includes(id);
    if (retarget) setSelection([id], id);
    beginDrag(e, retarget);
  }
  // Moveable renders a new target asynchronously; starting the drag in the same
  // tick binds it to the old state and the gesture dies after the first move.
  // Its documented pattern is to start the drag once the new target rendered.
  // A plain click releases the button before the timer fires: then no drag starts.
  let pressed = false;
  window.addEventListener('mouseup', () => { pressed = false; }, true);
  function beginDrag(e, retarget) {
    if (!retarget) { moveable.dragStart(e); return; }
    pressed = true;
    setTimeout(() => { if (pressed) moveable.dragStart(e); });
  }
  function afterDraw() {
    for (const id of ids.slice()) if (!itemFor(id)) ids = ids.filter(value => value !== id);
    if (primary && !ids.includes(primary)) primary = null;
    for (const [i, selecto] of selectos.entries()) {
      selecto.selectableTargets = ['#' + pages[i].id + ' .el'];
    }
    sync();
  }
  function attachInner(controller){inner=controller;sync()}
  // Handles are positioned against the stage, so any layout shift that moves the pages (window
  // resize, browser zoom, horizontal scrolling of a narrow stage) must re-measure them.
  let pendingRect = 0;
  const refreshRect = () => {
    if (pendingRect || gesture) return;
    pendingRect = requestAnimationFrame(() => { pendingRect = 0; moveable.updateRect(); });
  };
  window.addEventListener('resize', refreshRect);
  stage.addEventListener('scroll', refreshRect, {passive: true});
  return {
    setSelection, afterDraw, startDrag, attachInner,
    getIds: () => ids.slice(),
    getPrimary: () => primary,
    clear: () => setSelection([])
  };
}
