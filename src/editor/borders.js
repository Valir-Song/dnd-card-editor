// Borders: a frame around a card, box, picture or shape — style, colour and
// width, three optional fields (item.outline, outlineColor, outlineWidth). The
// frame is drawn over the element's edge (styles.css, `.el.outline-<id>::after`),
// so the text inside does not move when it appears or gets thicker. Without a
// colour the frame takes the theme's border colour.

/** @typedef {import('../types/layout').Item} Item */

export const OUTLINES = [
  {id: '', name: 'Без рамки'},
  {id: 'solid', name: 'Сплошная'},
  {id: 'double', name: 'Двойная'},
  {id: 'dashed', name: 'Пунктир'},
  {id: 'dotted', name: 'Точки'},
  {id: 'ornate', name: 'С внутренней линией'},
  {id: 'corners', name: 'Уголки'}
];
// Width in mm. Cards have ~1.5–2.5 mm of padding, so no style goes much deeper
// than 2 mm: the frame never covers the text.
export const OUTLINE_WIDTHS = [0.2, 0.35, 0.5, 0.8, 1.2];
export const DEFAULT_WIDTH = 0.5;
export const DEFAULT_COLOR = '#745193';
const KINDS = ['card', 'note', 'resources', 'section', 'header', 'image', 'shape'];
// «Рамку на весь лист» frames the boxes with text, not headings, pictures or shapes.
const PAGE_KINDS = ['card', 'note', 'resources'];
const COLOR = /^#[0-9a-f]{6}$/i;

/** @param {Item} item */
export const outlinable = item => KINDS.includes(item.kind) && !(item.kind === 'shape' && item.shape === 'line');
/** @param {Item} item */
export const pageOutlinable = item => PAGE_KINDS.includes(item.kind);

/**
 * How to draw the frame of an object: a class and two CSS variables, or null.
 * Unknown or broken values (a hand-edited file) give the defaults.
 * @param {Item} item
 * @returns {{className: string, color: string, width: string} | null}
 */
export function outlineLook(item) {
  if (!outlinable(item) || !item.outline || !OUTLINES.some(o => o.id && o.id === item.outline)) return null;
  const width = Number(item.outlineWidth);
  return {
    className: 'outline-' + item.outline,
    color: typeof item.outlineColor === 'string' && COLOR.test(item.outlineColor) ? item.outlineColor : '',
    width: (Number.isFinite(width) && width > 0 ? Math.min(width, 3) : DEFAULT_WIDTH) + 'mm'
  };
}

/**
 * Change the frame of the outlinable objects, in place. `style` '' takes the
 * frame away with its colour and width; a colour or width with no frame yet
 * also puts a solid frame on; colour '' or width 0 go back to the defaults.
 * @param {Item[]} items
 * @param {{style?: string, color?: string, width?: number}} change
 * @returns {number} how many objects changed
 */
export function applyOutline(items, {style, color, width}) {
  let count = 0;
  for (const item of items.filter(outlinable)) {
    if (style === '') { delete item.outline; delete item.outlineColor; delete item.outlineWidth; count++; continue; }
    if (style) item.outline = style;
    else if (!item.outline) item.outline = 'solid';
    if (color) item.outlineColor = color; else if (color === '') delete item.outlineColor;
    if (width) item.outlineWidth = width; else if (width === 0) delete item.outlineWidth;
    count++;
  }
  return count;
}

/**
 * The «Рамка» tools on the «Оформление» tab: style, width and colour go to the
 * selection, or to the cards and boxes of the page when nothing is selected;
 * «Рамку на весь лист» copies the shown frame to the whole page.
 * @param {{store: import('../types/layout').Store, getSelectionIds: () => string[],
 *   current: () => Item | undefined, getPage: () => number}} deps
 */
export function setupBorders({store, getSelectionIds, current, getPage}) {
  const $ = /** @param {string} id */ id => /** @type {HTMLInputElement} */ (/** @type {unknown} */ (document.getElementById(id)));
  const style = $('outlineStyle'), width = $('outlineWidth'), color = $('outlineColor');
  /** @type {HTMLSelectElement} */ (/** @type {unknown} */ (style)).replaceChildren(...OUTLINES.map(o => new Option(o.name, o.id)));
  /** @type {HTMLSelectElement} */ (/** @type {unknown} */ (width)).replaceChildren(...OUTLINE_WIDTHS.map(w => new Option(String(w).replace('.', ',') + ' мм', String(w))));
  const selected = () => {
    const ids = getSelectionIds();
    return /** @type {Item[]} */ ((ids.length ? ids.map(id => store.find(id)) : [current()]).filter(Boolean));
  };
  const page = () => store.items.filter(item => (item.page || 1) === getPage() && pageOutlinable(item));
  const targets = () => { const items = selected(); return items.length ? items.filter(outlinable) : page(); };
  /** @param {Item[]} items @param {{style?: string, color?: string, width?: number}} change @param {import('../types/layout').CommitOptions} [options] */
  function apply(items, change, options) {
    if (!items.length) return;
    store.change(() => { applyOutline(items, change); }, options);
  }
  style.addEventListener('change', () => apply(targets(), {style: style.value}));
  width.addEventListener('change', () => apply(targets(), {width: Number(width.value)}));
  // Dragging in the colour picker: framed objects are recoloured on screen
  // (no rebuild, so typing focus and speed stay); unframed ones get a frame first.
  color.addEventListener('input', () => {
    const items = targets(), value = color.value, options = {group: 'outline:' + items.map(i => i.id).join(','), windowMs: 1200};
    if (!items.length) return;
    if (items.some(item => !outlineLook(item))) { apply(items, {color: value}, options); return; }
    for (const item of items) {
      item.outlineColor = value;
      const node = document.querySelector('.el[data-id="' + CSS.escape(item.id) + '"]');
      if (node instanceof HTMLElement) node.style.setProperty('--o-color', value);
    }
    store.shown(items, options);
  });
  /** @type {HTMLButtonElement} */ (document.getElementById('outlinePage')).addEventListener('click', () => {
    const shown = selected().find(item => outlineLook(item));
    apply(page(), shown ? {style: shown.outline, color: shown.outlineColor || '', width: shown.outlineWidth || 0} : {style: style.value || 'solid', width: Number(width.value)});
  });
  // The tools show the frame of the selection (its first framed object).
  function sync() {
    const item = selected().filter(outlinable).find(i => outlineLook(i));
    style.value = item?.outline ?? '';
    width.value = String(item && OUTLINE_WIDTHS.includes(Number(item.outlineWidth)) ? item.outlineWidth : DEFAULT_WIDTH);
    color.value = item?.outlineColor && COLOR.test(item.outlineColor) ? item.outlineColor : DEFAULT_COLOR;
  }
  sync();
  return {sync};
}
