// Canvas-level geometry and marquee selection. Rich text remains exclusively Tiptap-owned.
// Coordinates are persisted in millimetres; Moveable only supplies pixel gesture deltas.
import Moveable from 'moveable';
import Selecto from 'selecto';

export function createCanvasControls({pages, getItems, onSelection, persist, mm}) {
  let ids = [];
  let primary = null;
  let gesture = null;
  let moveable;
  const selectos = [];
  const elements = () => ids.map(id => [...pages].flatMap(page =>
    [...page.querySelectorAll('.el')]).find(node => node.dataset.id === id)).filter(Boolean);
  const mmPerPx = page => 210 / page.getBoundingClientRect().width;
  const itemFor = id => getItems().find(item => item.id === id);
  const clip = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  const pageFor = id => pages.find(page => page.querySelector('.el[data-id="' + CSS.escape(id) + '"]'));
  function setSelection(next, preferred = null) {
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
    const targets = elements();
    if (moveable) {
      moveable.target = targets.length === 1 ? targets[0] : targets;
      moveable.updateRect();
    }
    for (let i = 0; i < selectos.length; i++) {
      selectos[i].setSelectedTargets(targets.filter(node => node.closest('.page') === pages[i]));
    }
    const status = document.getElementById('selectionCount');
    if (status) status.textContent = ids.length > 1 ? 'Выбрано: ' + ids.length : '';
  }
  function begin() {
    const chosen = ids.map(id => ({id, item: itemFor(id), node: elements().find(node => node.dataset.id === id)}))
      .filter(record => record.item && record.node);
    if (!chosen.length) { gesture = null; return; }
    const page = chosen[0].node.closest('.page');
    const scale = mmPerPx(page);
    gesture = {
      scale,
      records: chosen.map(record => ({
        ...record, x: record.item.x, y: record.item.y, w: record.item.w,
        h: record.item.kind === 'textbox' && record.item.autoHeight
          ? record.node.getBoundingClientRect().height * scale : record.item.h,
        pixelW: record.node.getBoundingClientRect().width,
        pixelH: record.node.getBoundingClientRect().height
      }))
    };
  }
  function applyDrag(dist) {
    if (!gesture || !dist) return;
    const {records, scale} = gesture;
    const dx = clip(dist[0] * scale, Math.max(...records.map(r => -r.x)), Math.min(...records.map(r => 210 - r.x - r.w)));
    const dy = clip(dist[1] * scale, Math.max(...records.map(r => -r.y)), Math.min(...records.map(r => 297 - r.y - r.h)));
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
    const width = record.w + (e.width - record.pixelW) * scale;
    const height = record.h + (e.height - record.pixelH) * scale;
    const right = record.x + record.w, bottom = record.y + record.h;
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
  function endGesture() {
    if (!gesture) return;
    gesture = null;
    // One history checkpoint per drag or resize, regardless of the number of targets.
    persist();
    // Recalculate handles from final millimetre geometry.
    requestAnimationFrame(() => moveable.updateRect());
  }
  moveable = new Moveable(document.body, {
    target: [], draggable: true, resizable: true, origin: false,
    keepRatio: false, throttleDrag: 0, throttleResize: 0,
    edge: true, edgeDraggable: true, snappable: false,
    renderDirections: ['nw','n','ne','w','e','sw','s','se'],
    className: 'dnd-canvas-moveable'
  });
  moveable.on('dragStart', begin)
    .on('drag', e => applyDrag(e.beforeDist || e.dist))
    .on('dragEnd', endGesture)
    .on('dragGroupStart', begin)
    .on('dragGroup', e => applyDrag(e.events?.[0]?.beforeDist || e.events?.[0]?.dist))
    .on('dragGroupEnd', endGesture)
    .on('resizeStart', begin)
    .on('resize', applyResize)
    .on('resizeEnd', endGesture)
    .on('resizeGroupStart', begin)
    .on('resizeGroup', e => { for (const ev of e.events || []) applyResize(ev); })
    .on('resizeGroupEnd', endGesture);

  pages.forEach((page, pageIndex) => {
    const selecto = new Selecto({
      container: document.body, dragContainer: page,
      selectableTargets: [page.querySelectorAll('.el')],
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
    page.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const element = e.target.closest?.('.el');
      if (!element || element.closest('.page') !== page) {
        if (e.target === page && !e.shiftKey) setSelection([]);
        return;
      }
      const id = element.dataset.id;
      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        setSelection(ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
        return;
      }
      if (!ids.includes(id)) setSelection([id], id);
      const nativeEditor = e.target.closest('.editable, [contenteditable], input, textarea, select, .text-grip, .text-resize, .level');
      if (nativeEditor) return;
      // The gesture begins on the same click that selects the object.
      // Do not manually initiate a second drag if Moveable owns the border.
      if (!e.target.closest('.moveable-control-box')) moveable.dragStart(e);
    });
  });
  function startDrag(e, id) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!ids.includes(id)) setSelection([id], id);
    moveable.dragStart(e);
  }
  function afterDraw() {
    for (const id of ids.slice()) if (!itemFor(id)) ids = ids.filter(value => value !== id);
    if (primary && !ids.includes(primary)) primary = null;
    for (const [i, selecto] of selectos.entries()) {
      selecto.selectableTargets = [pages[i].querySelectorAll('.el')];
    }
    sync();
  }
  return {
    setSelection, afterDraw, startDrag,
    getIds: () => ids.slice(),
    getPrimary: () => primary,
    clear: () => setSelection([])
  };
}
