// Which layout the editor opens with, read once at start-up: the save this file
// continues (see chooseLayout) or the layout embedded in the file, whichever is
// fresher. Editors up to 3.8 kept one save in localStorage under LEGACY_KEY: it
// is moved once into the record 'default' and never deleted, so an older editor
// file still opens it.
import { normalizeLayout, FORMAT_VERSION } from './layout.js';
import { chooseStartupLayout, chooseLayout, layoutTitle } from './freshness.js';

/** @typedef {import('../types/layout').Item} Item */
/** @typedef {import('../types/storage').Backend} Backend */
/** @typedef {import('../types/storage').LayoutMeta} LayoutMeta */
/** @typedef {import('../types/storage').StoredLayout} StoredLayout */

export const LEGACY_KEY = 'dnd-card-editor-v3';
export const RECOVERY_KEY = LEGACY_KEY + '-recovery';
const LEGACY_META_KEY = LEGACY_KEY + '-meta';
const LEGACY_MOVED_KEY = LEGACY_KEY + '-moved';

export const newLayoutId = () => 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/**
 * A saved layout as the editor can use it, or why it cannot.
 * @param {unknown} data
 * @returns {{items: Item[] | null, errors: string[], migrated: boolean}}
 */
export const checkSaved = data => typeof data === 'string'
  ? {items: null, errors: ['Данные не являются корректным JSON.'], migrated: false}
  : normalizeLayout(data);

/**
 * What a browser record holds in the layout format: records written before 3.11.0 beta.13 have no version.
 * @param {StoredLayout} record
 */
export const savedData = record => typeof record.formatVersion === 'number' ? {formatVersion: record.formatVersion, items: record.items} : record.items;

/**
 * @param {Backend} storage
 * @returns {Promise<{raw: string, errors: string[]} | null>} the old save, when it is damaged
 */
async function moveLegacySave(storage) {
  /** @type {string | null} */
  let raw = null;
  /** @type {string | null} */
  let at = null;
  try {
    if (localStorage.getItem(LEGACY_MOVED_KEY)) return null;
    raw = localStorage.getItem(LEGACY_KEY);
    at = JSON.parse(localStorage.getItem(LEGACY_META_KEY) || 'null')?.savedAt || null;
  } catch (e) { console.warn('Could not read the save of an older editor', e); }
  if (raw === null) return null;
  const markMoved = () => { try { localStorage.setItem(LEGACY_MOVED_KEY, new Date().toISOString()); } catch (e) {} };
  /** @type {unknown} */
  let parsed = raw;
  try { parsed = JSON.parse(raw); } catch (e) {}
  const result = checkSaved(parsed);
  if (!result.items) { markMoved(); return {raw, errors: result.errors}; }
  try {
    // 3.9.0-beta.1 moved it already, without the mark.
    if (!await storage.load('default')) await storage.put({id: 'default', name: layoutTitle(result.items), savedAt: at || new Date().toISOString(), formatVersion: FORMAT_VERSION, items: result.items});
    markMoved();
  } catch (e) { console.warn('Could not move the save of an older editor; will retry next time', e); }
  return null;
}

/**
 * @param {{storage: Backend, initialNode: HTMLElement, embedded: Item[], embeddedAt: string | null, embeddedMigrated?: boolean}} input
 */
export async function loadStartupLayout({storage, initialNode, embedded, embeddedAt, embeddedMigrated = false}) {
  // A damaged save must never lock the user out: fall back to the embedded layout
  // and keep the raw data so it can be downloaded and repaired.
  let damagedSave = await moveLegacySave(storage);
  /** @type {LayoutMeta[]} */
  let saves = [];
  try { saves = await storage.list(); } catch (e) { console.warn('Could not list saved layouts', e); }
  const choice = chooseLayout({fileId: initialNode.dataset.layoutId || null, fileAt: embeddedAt, fileText: initialNode.textContent ?? '', saves, newId: newLayoutId});
  let layoutId = choice.layoutId;
  let layoutName = initialNode.dataset.layoutName || '';
  /** @type {Item[] | null} */
  let items = null;
  /** @type {StoredLayout | null} */
  let saved = null;
  /** @type {string | null} */
  let storedAt = null;
  /** @type {{source: 'file' | 'browser', conflict: boolean, storedItems: Item[]} | null} */
  let freshness = null;
  /** @type {{name: string, version: number} | null} */
  let tooNew = null;
  let migrated = embeddedMigrated;
  if (choice.hasSave) try { saved = await storage.load(layoutId); } catch (e) { console.warn('Could not read the saved layout', e); }
  // A newer editor wrote this record: it cannot be read here, and must not be overwritten
  // either, so this session works on the file's layout under a new id.
  if (saved && typeof saved.formatVersion === 'number' && saved.formatVersion > FORMAT_VERSION) {
    tooNew = {name: saved.name || '', version: saved.formatVersion};
    layoutId = newLayoutId();
    saved = null;
  }
  if (saved) {
    storedAt = saved.savedAt || null;
    layoutName = saved.name || layoutName;
    const result = checkSaved(savedData(saved));
    if (result.items) {
      freshness = {...chooseStartupLayout({storedItems: result.items, storedAt, embeddedItems: embedded, embeddedAt}), storedItems: result.items};
      if (freshness.source === 'browser') { items = result.items; migrated = result.migrated; }
      // The newer file wins, but the older browser save must survive the next autosave.
      else storage.put({id: layoutId + ':previous', name: (saved.name || layoutTitle(result.items)) + ' — до открытия файла', savedAt: storedAt || new Date().toISOString(), formatVersion: FORMAT_VERSION, items: result.items})
        .catch(e => console.warn('Could not keep the previous browser layout', e));
    }
    else damagedSave = {raw: typeof saved.items === 'string' ? saved.items : JSON.stringify(saved.items), errors: result.errors};
  }
  items ||= structuredClone(embedded);
  layoutName ||= layoutTitle(items);
  return {items, layoutId, layoutName, choice, saves, saved, storedAt, freshness, damagedSave, tooNew,
    // A layout moved to the current format (see MIGRATIONS) is written once the saver exists.
    saveAtStart: !damagedSave && migrated};
}
