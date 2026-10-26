// Character stats on the sheet («Карточки → Персонаж», 4.1 beta.2): boxes that show
// the numbers of the «Персонаж» window (character.js). A box holds no numbers of its
// own: render.js redraws it whenever the character changes. A double click (or a tap
// in game mode) opens the window, where the numbers are changed.
import { statsView, findCharacter, characterOf, newStats, setAllSkills, statsPart } from './character.js';

/** @typedef {import('../types/layout').Item} Item */

/**
 * @template {keyof HTMLElementTagNameMap} T
 * @param {T} tag @param {string} className @param {string} [text] @returns {HTMLElementTagNameMap[T]}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const openWindow = () => document.getElementById('character')?.click();

/**
 * The body of a stats box. @param {Item} box @param {Item[]} items the layout (for its character)
 * @returns {HTMLElement}
 */
export function buildStats(box, items) {
  const character = findCharacter(items);
  const view = statsView(box, characterOf(character || {}));
  const root = el('div', 'stats-body stats-' + view.part);
  root.title = 'Числа из окна «Персонаж»: двойной щелчок открывает его';
  root.addEventListener('dblclick', openWindow);
  // In game mode the box is a tap target (play.js): it opens the window to look.
  root.addEventListener('click', () => { if (document.documentElement.dataset.play === 'on') openWindow(); });
  if (view.part !== 'skills') {
    for (const cell of view.cells) {
      const node = el('div', 'stats-cell');
      node.append(el('span', 'stats-label', cell.label), el('span', 'stats-value', cell.value));
      if ('small' in cell && cell.small) node.append(el('span', 'stats-small', cell.small));
      root.append(node);
    }
    return root;
  }
  const saves = el('div', 'stats-saves');
  for (const save of view.saves) {
    const node = el('span', 'stats-save rank-' + save.rank);
    node.append(el('i', 'stats-rank'), save.label + ' ', el('b', '', save.value));
    saves.append(node);
  }
  const list = el('div', 'stats-skills');
  for (const skill of view.skills) {
    const node = el('div', 'stats-skill rank-' + skill.rank);
    node.append(el('i', 'stats-rank'), el('span', 'stats-name', skill.label), el('b', '', skill.value));
    list.append(node);
  }
  root.append(saves, list);
  if (view.rest) root.append(el('div', 'stats-rest', view.rest));
  return root;
}

/**
 * The «Персонаж» group on the «Карточки» tab: three boxes, and «Все навыки» for the
 * selected skills boxes.
 * @param {import('../types/layout').Deps<'addObject' | 'current' | 'getSelectionIds'>} deps
 */
export function setupStats({store, addObject, current, getSelectionIds}) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLButtonElement} */ (document.getElementById(id));
  byId('addAbilities').addEventListener('click', () => addObject(newStats('abilities')));
  byId('addSkills').addEventListener('click', () => addObject(newStats('skills')));
  byId('addCombat').addEventListener('click', () => addObject(newStats('combat')));
  const targets = () => {
    const ids = getSelectionIds();
    return /** @type {Item[]} */ ((ids.length ? ids.map(id => store.find(id)) : [current()])
      .filter(item => item?.kind === 'stats' && statsPart(item) === 'skills'));
  };
  const all = byId('allSkills');
  all.addEventListener('click', () => {
    const list = targets();
    if (!list.length) return;
    const show = !list.every(item => item.allSkills === true);
    store.change(() => { for (const item of list) setAllSkills(item, show); });
  });
  function sync() {
    const list = targets();
    all.disabled = !list.length;
    all.setAttribute('aria-pressed', String(!!list.length && list.every(item => item.allSkills === true)));
  }
  sync();
  return {sync};
}
