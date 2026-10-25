// Where layouts live between visits. IndexedDB holds hundreds of megabytes,
// while localStorage has ~5 MB shared by every local file, so IndexedDB is
// preferred and localStorage is the fallback for browsers that refuse a
// database to this page (some do for files opened from disk, or in private
// windows). Each layout is one record {id, name, savedAt, items}; a small
// `meta` entry per layout lets the list of saves load without the pictures.

import { STORAGE_SUFFIX } from './channel.js';

/** @typedef {import('../types/storage').Backend} Backend */
/** @typedef {import('../types/storage').LayoutRecord} LayoutRecord */
/** @typedef {import('../types/storage').LayoutMeta} LayoutMeta */
/** @typedef {import('../types/storage').StoredLayout} StoredLayout */
/** @typedef {import('../types/storage').SaveState} SaveState */

export const DB_NAME = 'dnd-card-editor' + STORAGE_SUFFIX;
export const LS_PREFIX = 'dnd-card-editor' + STORAGE_SUFFIX + '-layout:';
export const LS_INDEX = 'dnd-card-editor' + STORAGE_SUFFIX + '-layouts';

/**
 * Pick the best storage this page can use.
 * @param {{prefer?: string | null, indexedDB?: IDBFactory | null, localStorage?: Storage | null, timeoutMs?: number}} [options]
 *   prefer 'local' skips IndexedDB (tests use it to cover the fallback).
 * @returns {Promise<Backend>}
 */
export async function openStorage({prefer = null, indexedDB = globalThis.indexedDB ?? null,
  localStorage = safeLocalStorage(), timeoutMs = 3000} = {}) {
  if (prefer !== 'local' && indexedDB) {
    try { return await indexedDBBackend(indexedDB, timeoutMs); }
    catch (error) { console.warn('IndexedDB is unavailable, falling back to localStorage', error); }
  }
  if (localStorage && canWrite(localStorage)) return localStorageBackend(localStorage);
  return noneBackend();
}

/** @returns {Storage | null} */
function safeLocalStorage() {
  try { return globalThis.localStorage ?? null; } catch (error) { return null; }
}

/** @param {Storage} storage */
function canWrite(storage) {
  try { storage.setItem(LS_PREFIX + '__probe', '1'); storage.removeItem(LS_PREFIX + '__probe'); return true; }
  catch (error) { return false; }
}

/** Rough size of a layout in bytes: pictures dominate, text is small. @param {LayoutRecord} record @returns {LayoutMeta} */
export function metaOf(record) {
  let bytes = 0;
  for (const item of record.items) bytes += 300 + (item.src?.length ?? 0) + (item.bgImage?.length ?? 0) + (item.detailHtml?.length ?? 0);
  return {id: record.id, name: record.name, savedAt: record.savedAt, count: record.items.length, bytes};
}

/**
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** @param {IDBTransaction} tx @returns {Promise<void>} */
function committed(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? Error('Запись в хранилище прервана.'));
  });
}

/**
 * @template T
 * @param {Promise<T>} promise @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve, reject) => setTimeout(() => reject(Error('IndexedDB did not answer')), ms))]);
}

/** @param {IDBFactory} factory @param {number} timeoutMs @returns {Promise<Backend>} */
async function indexedDBBackend(factory, timeoutMs) {
  const request = factory.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('layouts', {keyPath: 'id'});
    db.createObjectStore('meta', {keyPath: 'id'});
  };
  const db = await withTimeout(done(request), timeoutMs);
  // Some browsers open the database but refuse to write (e.g. private
  // windows): find out now rather than on the first edit.
  const probe = db.transaction('meta', 'readwrite');
  probe.objectStore('meta').put({id: '__probe'});
  probe.objectStore('meta').delete('__probe');
  await withTimeout(committed(probe), timeoutMs);
  return {
    kind: 'indexeddb',
    async list() {
      const all = /** @type {LayoutMeta[]} */ (await done(db.transaction('meta').objectStore('meta').getAll()));
      return all.filter(meta => !meta.id.startsWith('__'));
    },
    async load(id) {
      const record = await done(db.transaction('layouts').objectStore('layouts').get(id));
      return record ?? null;
    },
    put(record) {
      // put() copies the record right here, synchronously (structured clone).
      const tx = db.transaction(['layouts', 'meta'], 'readwrite');
      tx.objectStore('layouts').put(record);
      tx.objectStore('meta').put(metaOf(record));
      return committed(tx);
    },
    remove(id) {
      const tx = db.transaction(['layouts', 'meta'], 'readwrite');
      tx.objectStore('layouts').delete(id);
      tx.objectStore('meta').delete(id);
      return committed(tx);
    }
  };
}

/** @param {Storage} storage @returns {Backend} */
export function localStorageBackend(storage) {
  /** @returns {LayoutMeta[]} */
  const readIndex = () => {
    try { const list = JSON.parse(storage.getItem(LS_INDEX) || '[]'); return Array.isArray(list) ? list : []; }
    catch (error) { return []; }
  };
  /** @param {LayoutMeta[]} list */
  const writeIndex = list => storage.setItem(LS_INDEX, JSON.stringify(list));
  return {
    kind: 'localstorage',
    async list() { return readIndex(); },
    async load(id) {
      const raw = storage.getItem(LS_PREFIX + id);
      if (raw === null) return null;
      try { return /** @type {StoredLayout} */ (JSON.parse(raw)); }
      // Hand the raw text back so the editor can offer it for download.
      catch (error) { return {id, name: '', savedAt: '', items: raw}; }
    },
    put(record) {
      try {
        // Stringified right here, synchronously; throws when the quota is exceeded.
        storage.setItem(LS_PREFIX + record.id, JSON.stringify(record));
        writeIndex([...readIndex().filter(meta => meta.id !== record.id), metaOf(record)]);
        return Promise.resolve();
      } catch (error) { return Promise.reject(error); }
    },
    async remove(id) {
      storage.removeItem(LS_PREFIX + id);
      writeIndex(readIndex().filter(meta => meta.id !== id));
    }
  };
}

/** @returns {Backend} */
function noneBackend() {
  const refuse = () => Promise.reject(Error('Браузер не даёт этой странице ничего сохранять.'));
  return {kind: 'none', list: async () => [], load: async () => null, put: refuse, remove: refuse};
}

/**
 * Writes the current layout in the background: requests made while a write is
 * running collapse into one more write of the newest state, so typing never
 * queues dozens of copies of a layout full of pictures.
 * @param {{backend: Backend, describe: () => {id: string, name: string, formatVersion?: number, items: import('../types/layout').Item[]},
 *   onState?: (state: SaveState, error?: unknown) => void, now?: () => string}} options
 * @returns {import('../types/storage').Saver}
 */
export function createSaver({backend, describe, onState = () => {}, now = () => new Date().toISOString()}) {
  let dirty = false, writing = false, ok = true;
  /** @type {SaveState} */
  let state = 'saved';
  /** @type {Array<(ok: boolean) => void>} */
  let waiters = [];
  /** @param {SaveState} next @param {unknown} [error] */
  const setState = (next, error) => { state = next; onState(next, error); };
  async function pump() {
    if (writing) return;
    if (!dirty) {
      const ready = waiters; waiters = [];
      ready.forEach(resolve => resolve(ok));
      return;
    }
    dirty = false; writing = true;
    if (state !== 'saving') setState('saving');
    /** @type {unknown} */
    let failure;
    try { await backend.put({...describe(), savedAt: now()}); ok = true; }
    catch (error) { ok = false; failure = error; }
    writing = false;
    if (!dirty) setState(ok ? 'saved' : 'error', failure);
    pump();
  }
  return {
    request() { dirty = true; pump(); },
    flush() { return new Promise(resolve => { waiters.push(resolve); pump(); }); },
    get state() { return state; }
  };
}
