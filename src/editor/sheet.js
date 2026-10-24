// Sheet background (3.11): a look for a whole page — a ready background
// (colours and patterns in styles.css, `.page[data-sheet="<id>"]`) and/or the
// owner's own picture over it. Kept in the layout as one object of kind
// 'sheet' per page, so it is saved, exported, copied with the layout and
// undone like everything else; it is drawn on the page itself, never as an
// object, so it cannot be selected, moved or snapped to.

/** @typedef {import('../types/layout').Item} Item */

export const SHEETS = [
  {id: '', name: 'Пергамент'},
  {id: 'paper', name: 'Белая бумага'},
  {id: 'oldpaper', name: 'Старая бумага'},
  {id: 'stone', name: 'Камень'},
  {id: 'wood', name: 'Дерево'},
  {id: 'forest', name: 'Лес'},
  {id: 'sea', name: 'Море'},
  {id: 'ember', name: 'Пламя'},
  {id: 'night', name: 'Звёздная ночь'}
];
export const FITS = ['cover', 'contain', 'fill'];

/** @param {Item} item */
export const isSheet = item => item.kind === 'sheet';

/** The sheet object of a page, if any (the first one wins). @param {Item[]} items @param {number} page */
export function sheetOf(items, page) {
  return items.find(item => isSheet(item) && (item.page || 1) === page);
}

/**
 * Change the background of a page, in place: the sheet object is created when
 * needed and removed once it holds nothing (no background, no picture).
 * `undefined` or '' in the patch removes that setting.
 * @param {Item[]} items
 * @param {number} page
 * @param {{sheet?: string, src?: string, fit?: string, opacity?: number}} patch
 * @param {() => string} makeId
 * @returns {Item | undefined} the sheet object after the change
 */
export function setSheet(items, page, patch, makeId) {
  let sheet = sheetOf(items, page);
  if (!sheet) {
    sheet = /** @type {Item} */ ({id: makeId(), kind: 'sheet', page, x: 0, y: 0, w: 210, h: 297, z: 0});
    items.push(sheet);
  }
  const target = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (sheet));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === '') delete target[key];
    else target[key] = value;
  }
  // A picture's settings mean nothing without it.
  if (!sheet.src) { delete sheet.fit; delete sheet.opacity; }
  if (!sheet.sheet && !sheet.src) {
    items.splice(items.indexOf(sheet), 1);
    return undefined;
  }
  return sheet;
}

/** What `setSheet` takes to give another page the same look. @param {Item | undefined} sheet */
export function sheetLook(sheet) {
  return {sheet: sheet?.sheet, src: sheet?.src, fit: sheet?.fit, opacity: sheet?.opacity};
}

/**
 * Draw a page's background: the ready one as `data-sheet`, the picture as an
 * <img> under every object. Called by the renderer on every draw, so it only
 * touches what changed (a big picture is not decoded again).
 * @param {HTMLElement} page @param {Item | undefined} sheet
 */
export function paintSheet(page, sheet) {
  const look = sheet?.sheet && /^[a-z-]+$/.test(sheet.sheet) ? sheet.sheet : '';
  if (look) page.dataset.sheet = look; else delete page.dataset.sheet;
  const found = page.querySelector(':scope > img.sheet-image');
  /** @type {HTMLImageElement | null} */
  let img = found instanceof HTMLImageElement ? found : null;
  if (!sheet?.src) {
    img?.remove();
    page.classList.remove('has-sheet-image');
    return;
  }
  if (!img) {
    img = document.createElement('img');
    img.className = 'sheet-image';
    img.alt = '';
    img.draggable = false;
    page.prepend(img);
  }
  if (img.getAttribute('src') !== sheet.src) img.src = sheet.src;
  img.style.objectFit = FITS.includes(sheet.fit ?? '') ? String(sheet.fit) : 'cover';
  img.style.opacity = String((sheet.opacity ?? 100) / 100);
  page.classList.add('has-sheet-image');
}

/**
 * The «Фон листа» tools (tab «Оформление»): a ready background, a picture with
 * its fill and opacity, and «На оба листа». They act on the active page.
 * @param {{store: import('../types/layout').Store, getPage: () => number, makeId: () => string,
 *   readPicture: (file: File) => Promise<string>}} deps
 */
export function setupSheet({store, getPage, makeId, readPicture}) {
  /** @param {string} id */
  const element = id => /** @type {HTMLElement} */ (document.getElementById(id));
  const select = /** @type {HTMLSelectElement} */ (element('sheetTheme'));
  const upload = /** @type {HTMLInputElement} */ (element('sheetUpload'));
  const fit = /** @type {HTMLSelectElement} */ (element('sheetFit'));
  const opacity = /** @type {HTMLInputElement} */ (element('sheetOpacity'));
  const opacityValue = element('sheetOpacityValue');
  const remove = /** @type {HTMLButtonElement} */ (element('sheetRemove'));
  const both = /** @type {HTMLButtonElement} */ (element('sheetBoth'));
  const pageLabel = element('sheetPage');
  select.replaceChildren(...SHEETS.map(sheet => new Option(sheet.name, sheet.id)));

  /** @param {{sheet?: string, src?: string, fit?: string, opacity?: number}} patch @param {import('../types/layout').CommitOptions} [options] */
  const change = (patch, options) => store.change(items => { setSheet(items, getPage(), patch, makeId); }, options);

  select.addEventListener('change', () => change({sheet: select.value}));
  upload.addEventListener('change', async () => {
    const file = upload.files?.[0];
    upload.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const page = getPage();
    let src;
    try { src = await readPicture(file); }
    catch (error) { alert('Картинку не удалось загрузить: ' + (error instanceof Error ? error.message : error)); return; }
    store.change(items => { setSheet(items, page, {src}, makeId); });
  });
  fit.addEventListener('change', () => change({fit: fit.value === 'cover' ? undefined : fit.value}));
  opacity.addEventListener('input', () => {
    const value = Number(opacity.value);
    opacityValue.textContent = value + '%';
    change({opacity: value === 100 ? undefined : value}, {group: 'sheet-opacity:' + getPage(), windowMs: 1200});
  });
  remove.addEventListener('click', () => change({src: undefined}));
  // The other page gets this page's look (and the same picture).
  both.addEventListener('click', () => {
    const page = getPage(), look = sheetLook(sheetOf(store.items, page));
    store.change(items => { setSheet(items, page === 1 ? 2 : 1, look, makeId); });
  });

  // The tools show the active page's background; picture settings are greyed out without a picture.
  function sync() {
    const page = getPage(), sheet = sheetOf(store.items, page);
    pageLabel.textContent = 'лист ' + page;
    select.value = sheet?.sheet && SHEETS.some(s => s.id === sheet.sheet) ? sheet.sheet : '';
    const hasPicture = !!sheet?.src;
    fit.value = FITS.includes(sheet?.fit ?? '') ? String(sheet?.fit) : 'cover';
    const value = sheet?.opacity ?? 100;
    if (document.activeElement !== opacity) opacity.value = String(value);
    opacityValue.textContent = value + '%';
    fit.disabled = opacity.disabled = remove.disabled = !hasPicture;
  }
  sync();
  return {sync};
}
