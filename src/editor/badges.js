// Badges («кружочки») on cards, notes and resources. The main badge is the old
// spell-level circle (`level`, `badgeX/badgeY`, now also `badgeColor`); more
// can be added (`badges: [{text, x, y, color}]`). Any badge shows a number,
// a letter or a sign from SYMBOLS, in one of COLORS. All fields are optional:
// layouts from before 3.11 look exactly as they did.

/** @typedef {import('../types/layout').Item} Item */
/** @typedef {{text: string, x: number, y: number, color?: string}} ExtraBadge */
/** A badge of an item: `index` null is the main one, a number is badges[index]. */
/** @typedef {{index: number | null, text: string, color?: string}} BadgeRef */

export const BADGE_KINDS = ['card', 'note', 'resources'];
export const BADGE_SIZE = 8; // mm, as in styles.css
// Text presentation (U+FE0E) keeps signs like ⚡ from turning into colour emoji.
const T = '︎';
export const SYMBOLS = ['★', '☆', '✦', '☀' + T, '☾', '♪', '♫', '♥' + T, '♦' + T, '♠' + T, '♣' + T, '⚔' + T, '✚',
  '☠' + T, '⚡' + T, '❄' + T, '✿', '☘' + T, '⚜' + T, '⚖' + T, '⌛' + T, '∞', '✓', '✗', '◆', '●', '▲', '☯' + T, 'Ω', 'К', 'Р'];
export const COLORS = [
  {id: '', name: 'Как в теме'},
  {id: '#2e7cbd', name: 'Синий'},
  {id: '#b18a4a', name: 'Золотой'},
  {id: '#b23a3a', name: 'Красный'},
  {id: '#3d7a37', name: 'Зелёный'},
  {id: '#7a4fb0', name: 'Фиолетовый'},
  {id: '#4a4a55', name: 'Тёмный'}
];

/** @param {Item} item */
export const canHaveBadges = item => BADGE_KINDS.includes(item.kind);
/** @param {Item} item @returns {ExtraBadge[]} */
const extras = item => Array.isArray(item.badges) ? item.badges : [];

/** All badges of an item, the main one first. @param {Item} item @returns {BadgeRef[]} */
export function badgeList(item) {
  /** @type {BadgeRef[]} */
  const list = item.level ? [{index: null, text: item.level, color: item.badgeColor}] : [];
  extras(item).forEach((badge, index) => list.push({index, text: badge.text, color: badge.color}));
  return list;
}

/**
 * Where a new extra badge goes: along the bottom of the item, right to left
 * from the main badge's default corner, then a row higher.
 * @param {Item} item @returns {{x: number, y: number}}
 */
export function nextBadgeSpot(item) {
  const step = BADGE_SIZE + 1, perRow = Math.max(1, Math.floor((item.w + 1) / step));
  const n = 1 + extras(item).length; // the main badge holds the first spot
  return {
    x: Math.max(0, item.w - BADGE_SIZE - (n % perRow) * step),
    y: Math.max(0, item.h - BADGE_SIZE - Math.floor(n / perRow) * step)
  };
}

/**
 * Add a badge: the main one if the item has none, else one more beside it.
 * @param {Item} item @param {string} [text]
 * @returns {number | null} which badge was added (null = the main one)
 */
export function addBadge(item, text) {
  if (!item.level) { item.level = text || '1'; return null; }
  const spot = nextBadgeSpot(item);
  item.badges = [...extras(item), {text: text || '★', ...spot}];
  return item.badges.length - 1;
}

/** @param {Item} item @param {number | null} index */
export function removeBadge(item, index) {
  if (index === null) {
    for (const key of /** @type {const} */ (['level', 'badgeX', 'badgeY', 'badgeCustomPosition', 'badgeColor'])) delete item[key];
    return;
  }
  const rest = extras(item).filter((badge, i) => i !== index);
  if (rest.length) item.badges = rest; else delete item.badges;
}

/** @param {Item} item @param {number | null} index @param {string} text */
export function setBadgeText(item, index, text) {
  if (index === null) item.level = text;
  else { const badge = extras(item)[index]; if (badge) badge.text = text; }
}

/** '' brings back the theme's (or default) colour. @param {Item} item @param {number | null} index @param {string} color */
export function setBadgeColor(item, index, color) {
  if (index === null) { if (color) item.badgeColor = color; else delete item.badgeColor; return; }
  const badge = extras(item)[index];
  if (!badge) return;
  if (color) badge.color = color; else delete badge.color;
}

/**
 * The «Кружочки» tools. They act on the badge clicked last, if it belongs to
 * the selection; otherwise on the main badge of every selected card (a sign
 * creates it where there is none).
 * @param {{store: import('../types/layout').Store, getSelectionIds: () => string[],
 *   current: () => Item | undefined}} deps
 */
export function setupBadges({store, getSelectionIds, current}) {
  const symbols = /** @type {HTMLElement} */ (document.getElementById('badgeSymbols'));
  const colors = /** @type {HTMLElement} */ (document.getElementById('badgeColors'));
  /** @type {{id: string, index: number | null} | null} */
  let active = null;
  const targets = () => {
    const ids = getSelectionIds();
    return /** @type {Item[]} */ ((ids.length ? ids.map(id => store.find(id)) : [current()]).filter(item => item && canHaveBadges(item)));
  };
  // The badge clicked last, while its item is among the targets.
  function activeBadge() {
    const item = active && targets().find(target => target.id === active?.id);
    if (!item || !active) return null;
    const exists = active.index === null ? !!item.level : !!extras(item)[active.index];
    return exists ? {item, index: active.index} : null;
  }
  document.addEventListener('focusin', event => {
    const badge = event.target instanceof HTMLElement ? event.target.closest('.level') : null;
    const el = badge?.closest('.el');
    if (!(badge instanceof HTMLElement) || !(el instanceof HTMLElement) || !el.dataset.id) return;
    active = {id: el.dataset.id, index: badge.dataset.index === undefined ? null : Number(badge.dataset.index)};
    sync();
  });
  /** @param {(item: Item, index: number | null) => void} edit */
  function change(edit) {
    const one = activeBadge(), items = one ? [one.item] : targets();
    if (!items.length) return;
    store.change(() => { for (const item of items) edit(item, one ? one.index : null); });
    sync();
  }
  // Buttons keep the focus where it was (a badge being edited) while clicked.
  /** @param {string} label @param {string} title @param {() => void} run */
  const button = (label, title, run) => {
    const node = document.createElement('button');
    node.type = 'button'; node.textContent = label; node.title = title;
    node.addEventListener('pointerdown', event => event.preventDefault());
    node.addEventListener('click', run);
    return node;
  };
  symbols.replaceChildren(...SYMBOLS.map(sign => button(sign, 'Поставить «' + sign.replace(T, '') + '» в кружочек', () =>
    change((item, index) => { if (index === null && !item.level) addBadge(item, sign); else setBadgeText(item, index, sign); }))));
  colors.replaceChildren(...COLORS.map(color => {
    const node = button(color.id ? '' : '⟲', 'Цвет кружочка: ' + color.name.toLowerCase(), () =>
      change((item, index) => { if (index !== null || item.level) setBadgeColor(item, index, color.id); }));
    node.className = 'badge-color';
    if (color.id) node.style.background = color.id;
    return node;
  }));
  /** @type {HTMLButtonElement} */ (document.getElementById('addBadge')).addEventListener('click', () => {
    const items = targets();
    if (!items.length) return;
    store.change(() => { for (const item of items) addBadge(item); });
    sync();
  });
  /** @type {HTMLButtonElement} */ (document.getElementById('removeBadge')).addEventListener('click', () => {
    const one = activeBadge();
    // Without a clicked badge: each selected card loses its last one.
    const items = one ? [one.item] : targets().filter(item => badgeList(item).length);
    if (!items.length) return;
    store.change(() => {
      for (const item of items) {
        const list = badgeList(item);
        removeBadge(item, one ? one.index : list[list.length - 1].index);
      }
    });
    active = null;
    sync();
  });
  function sync() {
    // Always shown in its own tab (showing and hiding tools would move the sheet);
    // greyed out without a card to act on.
    const none = !targets().length;
    // The ribbon spreads these over its groups (toolbar-tabs.js), so they are found by id.
    const add = document.getElementById('addBadge'), remove = document.getElementById('removeBadge');
    for (const node of [add, remove, ...colors.querySelectorAll('button'), ...symbols.querySelectorAll('button')])
      if (node) /** @type {HTMLButtonElement} */ (node).disabled = none;
  }
  sync();
  return {
    sync,
    // A new selection forgets the badge clicked before (a click on a badge
    // selects its card first, then focuses the badge).
    selectionChanged() { active = null; sync(); }
  };
}
