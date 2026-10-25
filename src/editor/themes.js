// Themes: a ready look for cards and boxes — background, border, title, meta
// and text colours, badge colour — set by one optional field, item.theme (the
// colours live in styles.css, `.el.theme-<id>`). A theme replaces the object's
// own background colour; the colour picker still works on top of it. A new
// theme is one entry here and one block in styles.css.

/** @typedef {import('../types/layout').Item} Item */

export const THEMES = [
  {id: '', name: 'Без темы'},
  {id: 'parchment', name: 'Пергамент'},
  {id: 'forest', name: 'Лес'},
  {id: 'night', name: 'Ночь'},
  {id: 'ember', name: 'Пламя'},
  {id: 'ice', name: 'Лёд'},
  {id: 'sea', name: 'Море'},
  {id: 'gold', name: 'Золото'},
  {id: 'stone', name: 'Камень'},
  {id: 'blood', name: 'Кровь'},
  {id: 'shadow', name: 'Тень'}
];
// Kinds with a box to colour; shapes, pictures and text boxes keep their own colours.
export const THEMED_KINDS = ['card', 'note', 'resources', 'section', 'header', 'hp'];

/** @param {Item} item */
export const themable = item => THEMED_KINDS.includes(item.kind);

/**
 * Put `theme` ('' = none) on the themable objects, in place.
 * @param {Item[]} items @param {string} theme
 * @returns {number} how many objects got it
 */
export function applyTheme(items, theme) {
  let count = 0;
  for (const item of items.filter(themable)) {
    if (theme) { item.theme = theme; delete item.bg; }
    else delete item.theme;
    count++;
  }
  return count;
}

/**
 * The «Тема» list (to the selection, or to the whole page when nothing is
 * selected) and «На весь лист» (the chosen theme to every object of the page).
 * @param {{store: import('../types/layout').Store, getSelectionIds: () => string[],
 *   current: () => Item | undefined, getPage: () => number}} deps
 */
export function setupThemes({store, getSelectionIds, current, getPage}) {
  const select = /** @type {HTMLSelectElement} */ (/** @type {unknown} */ (document.getElementById('theme')));
  select.replaceChildren(...THEMES.map(theme => new Option(theme.name, theme.id)));
  const selected = () => {
    const ids = getSelectionIds();
    return /** @type {Item[]} */ ((ids.length ? ids.map(id => store.find(id)) : [current()]).filter(Boolean));
  };
  const page = () => store.items.filter(item => (item.page || 1) === getPage());
  /** @param {Item[]} items */
  function apply(items) {
    if (!items.some(themable)) return;
    store.change(() => { applyTheme(items, select.value); });
  }
  select.addEventListener('change', () => { const items = selected(); apply(items.length ? items : page()); });
  /** @type {HTMLButtonElement} */ (document.getElementById('themePage')).addEventListener('click', () => apply(page()));
  // The list shows the theme of the selection (the first themable object).
  function sync() {
    const item = selected().find(themable);
    select.value = item?.theme && THEMES.some(theme => theme.id === item.theme) ? item.theme : '';
  }
  sync();
  return {sync};
}
