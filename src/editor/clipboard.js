// Copy, cut and paste of whole objects (Ctrl+C / Ctrl+X / Ctrl+V). Objects
// travel through the system clipboard as marked JSON text, so they can be
// pasted into another editor file too. Inside a text field the keys keep
// their usual meaning (Tiptap copies text), and pasted pictures are handled
// by objects.js.
import { normalizeLayout, FORMAT_VERSION } from './layout.js';
import { bbox } from './geometry.js';

/** @typedef {import('../types/layout').Item} Item */
const MARK = 'dnd-card-editor/objects';

/** @param {Item[]} items */
export function encodeClip(items) {
  // version: of this clipboard wrapper; formatVersion: of the objects (see layout.js).
  return JSON.stringify({kind: MARK, version: 1, formatVersion: FORMAT_VERSION, items});
}

/**
 * Objects from clipboard text, or null when the text is not ours or is broken.
 * @param {string} text
 * @returns {Item[] | null}
 */
export function decodeClip(text) {
  if (!text || !text.includes(MARK)) return null;
  let data;
  try { data = JSON.parse(text); } catch (error) { return null; }
  if (data?.kind !== MARK || !Array.isArray(data.items) || !data.items.length) return null;
  // Objects copied in an editor before 3.11.0 beta.13 are format 1.
  return normalizeLayout({formatVersion: data.formatVersion ?? 1, items: data.items}).items;
}

/** The event is ours: no default action and no other listener (a text editor). @param {Event} event */
const claim = event => { event.preventDefault(); event.stopImmediatePropagation(); };

// Typing means the focus is in a text field. The event's target is not enough:
// clipboard events go to wherever text was last selected, even after the user
// has clicked objects on the sheet.
const typing = () => {
  const focus = document.activeElement;
  return focus instanceof HTMLElement && (focus.isContentEditable || !!focus.closest('input, textarea, select'));
};

/**
 * @param {{store: import('../types/layout').Store, getSelectionIds: () => string[],
 *   addObjects: (list: Item[], wish?: {x: number, y: number}) => unknown,
 *   removeObjects: (ids: string[]) => number}} deps
 */
export function setupClipboard({store, getSelectionIds, addObjects, removeObjects}) {
  /** @param {ClipboardEvent} event */
  function copy(event) {
    if (typing() || !event.clipboardData) return null;
    const ids = getSelectionIds();
    const list = /** @type {Item[]} */ (ids.map(id => store.find(id)).filter(Boolean));
    if (!list.length) return null;
    event.clipboardData.setData('text/plain', encodeClip(list));
    claim(event);
    return ids;
  }
  // Some browsers send no «copy»/«cut» event without selected text: with objects
  // selected, the keys ask for one explicitly (exactly one, the native one is cancelled).
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || typing()) return;
    const key = event.key.toLowerCase(), action = key === 'c' || event.code === 'KeyC' ? 'copy' : key === 'x' || event.code === 'KeyX' ? 'cut' : null;
    if (!action || !getSelectionIds().length) return;
    event.preventDefault();
    document.execCommand(action);
  });
  // Listening in the capture phase lets objects take the event before a text
  // editor that last held a selection does: it would paste the objects' text
  // into itself, or cut its own text, while the focus is elsewhere.
  document.addEventListener('copy', event => { copy(event); }, true);
  document.addEventListener('cut', event => {
    const ids = copy(event);
    if (ids) removeObjects(ids); // locked objects are copied but stay
  }, true);
  document.addEventListener('paste', event => {
    if (typing()) return;
    const list = decodeClip(event.clipboardData?.getData('text/plain') ?? '');
    if (!list) return;
    claim(event);
    // A copy whose originals are still here goes under them, like «Дублировать»;
    // after a cut, or in another file, the objects return to their own place
    // (or the nearest free spot).
    const box = bbox(list), originals = list.some(item => store.find(item.id));
    addObjects(list, originals ? {x: box.x, y: box.y + box.h + 2} : {x: box.x, y: box.y});
  }, true);
}
