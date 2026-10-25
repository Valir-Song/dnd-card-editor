// More than two pages (ROADMAP 4.2). A layout has as many pages as its highest
// `page`; a page with nothing on it keeps a plain sheet object (kind 'sheet', see
// sheet.js) so it does not vanish. Pure functions on the item list (Node tests)
// and the page bars over each sheet: «Лист 2 из 4», up, down, copy, delete,
// and «+ Добавить лист» under the last one.
// Cards on page 1 have always had a compact text layout (styles.css); a card
// that changes pages keeps the look it had (`cardLook`), so nothing re-flows.

import { isSheet, sheetOf, sheetLook } from './sheet.js';

/** @typedef {import('../types/layout').Item} Item */

export const MAX_PAGES = 20;

/** How many pages the layout has: its highest page, at least 1. @param {Item[]} items */
export function pageCount(items) {
  return Math.min(MAX_PAGES, Math.max(1, ...items.map(item => item.page || 1)));
}

/** Objects on a page, without its background. @param {Item[]} items @param {number} page */
export const objectsOn = (items, page) => items.filter(item => (item.page || 1) === page && !isSheet(item));

/**
 * Give every page from 1 to `count` something to stand on: an empty one gets a
 * plain sheet object. In place. @param {Item[]} items @param {number} count @param {() => string} makeId
 */
export function keepPages(items, count, makeId) {
  for (let page = 1; page <= count; page++) {
    if (!items.some(item => (item.page || 1) === page)) items.push(blankSheet(page, makeId));
  }
}

/** @param {number} page @param {() => string} makeId @returns {Item} */
function blankSheet(page, makeId) {
  return /** @type {Item} */ ({id: makeId(), kind: 'sheet', page, x: 0, y: 0, w: 210, h: 297, z: 0});
}

/**
 * Move an object to another page; a card keeps the look of the page it leaves.
 * @param {Item} item @param {number} page
 */
export function setPage(item, page) {
  const from = item.page || 1;
  if (from === page) return;
  if (item.kind === 'card' && !item.cardLook) item.cardLook = from === 1 ? 'compact' : 'full';
  item.page = page;
}

/** Pages after `after` move one down to make room. @param {Item[]} items @param {number} after */
function shiftAfter(items, after) {
  for (const item of items) if ((item.page || 1) > after) setPage(item, (item.page || 1) + 1);
}

/**
 * A new empty page right after `after` (0 = first), with the background of the
 * page before it. In place; false when the layout already has MAX_PAGES.
 * @param {Item[]} items @param {number} after @param {() => string} makeId
 */
export function addPage(items, after, makeId) {
  const count = pageCount(items);
  if (count >= MAX_PAGES) return false;
  after = Math.max(0, Math.min(after, count));
  shiftAfter(items, after);
  const look = after ? sheetLook(sheetOf(items, after)) : {};
  const sheet = blankSheet(after + 1, makeId);
  for (const [key, value] of Object.entries(look)) if (value !== undefined) Object.assign(sheet, {[key]: value});
  items.push(sheet);
  keepPages(items, count + 1, makeId);
  return true;
}

/**
 * A copy of a page (objects, background, locks) right after it. In place;
 * false when the layout already has MAX_PAGES.
 * @param {Item[]} items @param {number} page @param {() => string} makeId
 */
export function duplicatePage(items, page, makeId) {
  const count = pageCount(items);
  if (count >= MAX_PAGES || page < 1 || page > count) return false;
  const copies = items.filter(item => (item.page || 1) === page).map(item => ({...structuredClone(item), id: makeId()}));
  shiftAfter(items, page);
  for (const copy of copies) setPage(copy, page + 1);
  items.push(...copies);
  keepPages(items, count + 1, makeId);
  return true;
}

/**
 * Remove a page with everything on it; later pages move up. The last page
 * stays. Returns the new list, or null when there is one page only.
 * @param {Item[]} items @param {number} page @param {() => string} makeId
 */
export function removePage(items, page, makeId) {
  const count = pageCount(items);
  if (count <= 1 || page < 1 || page > count) return null;
  const left = items.filter(item => (item.page || 1) !== page);
  for (const item of left) if ((item.page || 1) > page) setPage(item, (item.page || 1) - 1);
  keepPages(left, count - 1, makeId);
  return left;
}

/** Swap a page with its neighbour (dir -1 = up, 1 = down). In place. @param {Item[]} items @param {number} page @param {1 | -1} dir */
export function movePage(items, page, dir) {
  const other = page + dir, count = pageCount(items);
  if (page < 1 || page > count || other < 1 || other > count) return false;
  for (const item of items) {
    const p = item.page || 1;
    if (p === page) setPage(item, other);
    else if (p === other) setPage(item, page);
  }
  return true;
}

/**
 * Put objects on another page, at the same place, on top of what is there.
 * Locked objects and backgrounds stay. The page they leave keeps existing.
 * In place; returns the ids that moved.
 * @param {Item[]} items @param {string[]} ids @param {number} target @param {() => string} makeId
 */
export function moveToPage(items, ids, target, makeId) {
  const count = pageCount(items);
  if (target < 1 || target > count) return [];
  const wanted = new Set(ids);
  const moving = items.filter(item => wanted.has(item.id) && !item.locked && !isSheet(item) && (item.page || 1) !== target)
    .sort((a, b) => (a.z || 0) - (b.z || 0));
  let z = Math.max(0, ...items.filter(item => (item.page || 1) === target).map(item => item.z || 0));
  for (const item of moving) { setPage(item, target); item.z = ++z; }
  keepPages(items, count, makeId);
  return moving.map(item => item.id);
}

/**
 * The page bars and «На лист»: buttons change the layout through the store (one
 * undo step each); `sync` runs after every draw.
 * @param {import('../types/layout').Deps<'pages' | 'getSelectionIds' | 'current' | 'getPage'> & {
 *   makeId: () => string, setPage: (page: number) => void, select: (ids: string[]) => void}} deps
 */
export function setupPages({store, pages, getSelectionIds, current, getPage, makeId, setPage, select}) {
  const stage = /** @type {HTMLElement} */ (pages[0].closest('.stage'));
  /** @type {Map<HTMLElement, HTMLElement>} */
  const bars = new Map();
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'page-add';
  add.textContent = '+ Добавить лист';
  add.title = 'Новый пустой лист в конце (фон — как у последнего)';
  add.addEventListener('click', () => {
    const count = pageCount(store.items);
    if (store.change(items => { addPage(items, count, makeId); })) show(count + 1);
  });
  const toPage = /** @type {HTMLSelectElement} */ (/** @type {unknown} */ (document.getElementById('toPage')));

  // After the page moved or appeared: it becomes the active one and comes into view.
  /** @param {number} page */
  function show(page) {
    setPage(page);
    const node = pages[page - 1];
    const bar = node && bars.get(node);
    (bar || node)?.scrollIntoView({block: 'start'});
  }

  /** @param {HTMLElement} page */
  function makeBar(page) {
    const bar = document.createElement('div');
    bar.className = 'page-bar';
    const title = document.createElement('span');
    title.className = 'page-bar-title';
    bar.append(title);
    /** @type {[string, string, string, (n: number) => void][]} */
    const buttons = [
      ['up', '↑', 'Поменять местами с листом выше', n => { if (store.change(items => { movePage(items, n, -1); })) show(n - 1); }],
      ['down', '↓', 'Поменять местами с листом ниже', n => { if (store.change(items => { movePage(items, n, 1); })) show(n + 1); }],
      ['copy', 'Копия', 'Копия листа со всеми объектами — сразу после него', n => { if (store.change(items => { duplicatePage(items, n, makeId); })) show(n + 1); }],
      ['remove', 'Удалить', 'Удалить лист со всем, что на нём (Ctrl+Z вернёт)', n => {
        const count = objectsOn(store.items, n).length;
        if (count && !confirm('Удалить лист ' + n + ' и объекты на нём (' + count + ')? Ctrl+Z вернёт.')) return;
        if (store.change(items => removePage(items, n, makeId) || undefined)) setPage(Math.min(n, pageCount(store.items)));
      }]
    ];
    for (const [action, label, hint, run] of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action;
      button.textContent = label;
      button.title = hint;
      button.addEventListener('click', () => run(Number(page.dataset.page)));
      bar.append(button);
    }
    page.before(bar);
    return bar;
  }

  function sync() {
    const count = pages.length, full = count >= MAX_PAGES;
    for (const [page, bar] of bars) if (!pages.includes(page)) { bar.remove(); bars.delete(page); }
    pages.forEach((page, i) => {
      const bar = bars.get(page) || makeBar(page);
      bars.set(page, bar);
      if (bar.nextElementSibling !== page) page.before(bar);
      /** @type {HTMLElement} */ (bar.querySelector('.page-bar-title')).textContent = 'Лист ' + (i + 1) + ' из ' + count;
      /** @param {string} action */
      const button = action => /** @type {HTMLButtonElement} */ (bar.querySelector('[data-action="' + action + '"]'));
      button('up').disabled = i === 0;
      button('down').disabled = i === count - 1;
      button('copy').disabled = full;
      button('remove').disabled = count === 1;
    });
    const last = pages[count - 1];
    if (add.previousElementSibling !== last) last.after(add);
    add.disabled = full;
    add.title = full ? 'Листов уже ' + MAX_PAGES + ' — больше нельзя' : 'Новый пустой лист в конце (фон — как у последнего)';
    syncToPage();
  }

  // «На лист»: the selected objects (or the card whose text is selected) go to another page.
  const selection = () => {
    const ids = getSelectionIds();
    const one = current();
    return ids.length ? ids : one ? [one.id] : [];
  };
  function syncToPage() {
    const ids = selection(), from = getPage(), count = pages.length;
    const wanted = ['', ...Array.from({length: count}, (_, i) => String(i + 1)), ...(count < MAX_PAGES ? ['new'] : [])];
    const now = [...toPage.options].map(option => option.value);
    if (now.join() !== wanted.join()) {
      toPage.replaceChildren(...wanted.map(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value === '' ? 'выбрать…' : value === 'new' ? 'новый лист' : 'лист ' + value;
        return option;
      }));
    }
    for (const option of toPage.options) option.disabled = option.value === String(from);
    toPage.value = '';
    toPage.disabled = !ids.length;
  }
  toPage.addEventListener('change', () => {
    const ids = selection(), value = toPage.value;
    toPage.value = '';
    if (!ids.length || !value) return;
    let target = Number(value), moved = /** @type {string[]} */ ([]);
    store.change(items => {
      if (value === 'new') { target = pageCount(items) + 1; if (!addPage(items, target - 1, makeId)) return; }
      moved = moveToPage(items, ids, target, makeId);
    });
    if (!moved.length) return;
    select(moved);
    show(target);
  });

  stage.addEventListener('pointerdown', event => {
    if (event.target instanceof HTMLElement && event.target.closest('.page-bar')) {
      const page = /** @type {HTMLElement | null | undefined} */ (event.target.closest('.page-bar')?.nextElementSibling);
      if (page && pages.includes(page)) setPage(Number(page.dataset.page));
    }
  });
  return {sync};
}
