// Locked objects stay where they are: no drag, resize or badge drag, the
// marquee passes over them and Delete/cut leave them in place. Their text and
// colours still change. `locked` is optional: layouts without it (all made
// before 3.11) are unlocked, and unlocking removes the field again.
import { setLabel } from './dom.js';


/** @typedef {import('../types/layout').Item} Item */

/** @param {Item | undefined | null} item */
export const isLocked = item => !!item?.locked;

/**
 * How many of the objects are locked.
 * @param {Array<Item | undefined>} items
 * @returns {'none' | 'some' | 'all'}
 */
export function lockState(items) {
  const known = /** @type {Item[]} */ (items.filter(Boolean));
  const count = known.filter(isLocked).length;
  return !known.length || !count ? 'none' : count === known.length ? 'all' : 'some';
}

/**
 * Lock (true) or unlock (false) the objects in place.
 * @param {Item[]} items @param {boolean} lock
 */
export function setLockedFlag(items, lock) {
  for (const item of items) {
    if (lock) item.locked = true;
    else delete item.locked;
  }
}

const typing = () => {
  const focus = document.activeElement;
  return focus instanceof HTMLElement && (focus.isContentEditable || !!focus.closest('input, textarea, select'));
};

/**
 * The «Закрепить» button and Ctrl+Shift+L. They act on the selection, or on
 * the card whose text frame is selected (then the selection itself is empty).
 * «Открепить всё на странице» unlocks every object of the page being worked on
 * (the marquee passes over locked objects, so they are hard to select together).
 * @param {{store: import('../types/layout').Store, getSelectionIds: () => string[],
 *   current: () => Item | undefined, getPage: () => number}} deps
 */
export function setupLock({store, getSelectionIds, current, getPage}) {
  const button = /** @type {HTMLButtonElement} */ (document.getElementById('lock'));
  const targets = () => {
    const ids = getSelectionIds();
    const chosen = ids.length ? ids.map(id => store.find(id)) : [current()];
    return /** @type {Item[]} */ (chosen.filter(Boolean));
  };
  function sync() {
    const all = lockState(targets()) === 'all';
    setLabel(button, all ? 'Открепить' : 'Закрепить');
    button.setAttribute('aria-pressed', String(all));
  }
  /** @param {string[]} ids @param {boolean} lock */
  function setLocked(ids, lock) {
    const items = /** @type {Item[]} */ (ids.map(id => store.find(id)).filter(Boolean));
    if (!items.length) return;
    store.change(() => setLockedFlag(items, lock));
    sync();
  }
  function toggle() {
    const items = targets();
    if (items.length) setLocked(items.map(item => item.id), lockState(items) !== 'all');
  }
  button.addEventListener('click', toggle);
  /** @type {HTMLButtonElement} */ (document.getElementById('unlockPage')).addEventListener('click', () => {
    const page = getPage();
    const items = store.items.filter(item => (item.page || 1) === page && isLocked(item));
    if (items.length) setLocked(items.map(item => item.id), false);
  });
  document.addEventListener('keydown', event => {
    // Inside text the same keys belong to the text editor.
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey || typing()) return;
    if (event.code !== 'KeyL' && event.key.toLowerCase() !== 'l') return;
    if (!targets().length) return;
    event.preventDefault();
    toggle();
  });
  sync();
  return {sync, setLocked};
}
