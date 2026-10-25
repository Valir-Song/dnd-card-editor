// «Сохранить в файл» (Ctrl+S): the layout goes straight into a file the user picked
// once, like a desktop program: a layout file (.dnd, the default in the installed app)
// or the editor itself as HTML with the layout inside (the default for a file from disk). This needs the File System Access API (Chrome, Edge); other
// browsers get a download, as with «Скачать HTML».
// The chosen file is remembered per layout in a small IndexedDB of its own, so
// after the editor is reopened the browser only asks for permission again; the same
// database keeps the list of recent files for «Открыть».

import { HOSTED, STORAGE_SUFFIX } from './channel.js';
import { downloadFile } from './dom.js';
import { fileBase } from './freshness.js';
import { LAYOUT_EXTENSION, LAYOUT_MIME, fileFormat } from './layout-file.js';

/**
 * @typedef {{write: (data: string) => Promise<void>, close: () => Promise<void>, abort?: () => Promise<void>}} Writable
 * @typedef {'granted' | 'denied' | 'prompt'} Permission
 * @typedef {{name: string, createWritable: () => Promise<Writable>, getFile?: () => Promise<Blob>,
 *   queryPermission?: (options: {mode: 'read' | 'readwrite'}) => Promise<Permission>,
 *   requestPermission?: (options: {mode: 'read' | 'readwrite'}) => Promise<Permission>}} FileHandle
 * @typedef {{id: string, fileName: string, layoutName: string, usedAt: string, handle: FileHandle}} RecentFile
 *   id — the layout the file holds: one entry per layout, its latest file
 * @typedef {{get: (id: string) => Promise<FileHandle | undefined>, set: (id: string, handle: FileHandle) => Promise<void>,
 *   delete: (id: string) => Promise<void>, recent?: () => Promise<RecentFile[]>, addRecent?: (entry: RecentFile) => Promise<void>,
 *   removeRecent?: (id: string) => Promise<void>}} HandleStore
 * @typedef {{id: string, fileName: string, content: (fileName: string) => string}} SaveRequest
 *   content — what to write into the chosen file, by its name (.html: the editor, otherwise the layout file)
 * @typedef {{kind: 'file', name: string} | {kind: 'cancel'} | {kind: 'denied', name: string}
 *   | {kind: 'error', name: string, error: unknown}} SaveResult
 */

/** @param {unknown} error */
const errorName = error => error instanceof Error || (typeof error === 'object' && error !== null && 'name' in error)
  ? String(/** @type {{name: unknown}} */ (error).name) : '';

/**
 * Save requests in order. `pick` opens the file dialog (null or AbortError: the
 * user cancelled). The file of a layout is picked once, then reused; `choose`
 * picks another one. A press while a save runs saves once more afterwards, so the
 * file ends up with the newest state. The page is built only when it is written.
 * @param {{pick: (suggestedName: string) => Promise<FileHandle | null>, handles: HandleStore}} deps
 */
export function createFileSave({pick, handles}) {
  /** @type {Promise<SaveResult> | null} */
  let running = null;
  /** @type {SaveRequest | null} */
  let again = null;

  /** @param {FileHandle} handle */
  async function allowed(handle) {
    if (!handle.queryPermission) return true;
    const state = await handle.queryPermission({mode: 'readwrite'});
    if (state === 'granted') return true;
    if (state !== 'prompt' || !handle.requestPermission) return false;
    return await handle.requestPermission({mode: 'readwrite'}) === 'granted';
  }

  // The browser writes into a temporary copy and replaces the file only on
  // close(): a failed write leaves the previous version of the file whole.
  /** @param {FileHandle} handle @param {string} text */
  async function write(handle, text) {
    const writable = await handle.createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch(() => {});
      throw error;
    }
  }

  /** @param {SaveRequest} request @param {boolean} choose @returns {Promise<SaveResult>} */
  async function run(request, choose) {
    let handle = choose ? undefined : await handles.get(request.id).catch(() => undefined);
    if (handle) {
      let ok = false;
      try { ok = await allowed(handle); } catch (error) { return {kind: 'error', name: handle.name, error}; }
      if (!ok) return {kind: 'denied', name: handle.name};
    } else {
      try {
        handle = await pick(request.fileName) ?? undefined;
      } catch (error) {
        if (errorName(error) === 'AbortError') return {kind: 'cancel'};
        return {kind: 'error', name: request.fileName, error};
      }
      if (!handle) return {kind: 'cancel'};
      await handles.set(request.id, handle).catch(() => {});
    }
    try {
      await write(handle, request.content(handle.name));
    } catch (error) {
      // The file was moved or deleted: next time ask for a file again.
      if (errorName(error) === 'NotFoundError') await handles.delete(request.id).catch(() => {});
      return {kind: 'error', name: handle.name, error};
    }
    return {kind: 'file', name: handle.name};
  }

  /** @param {SaveRequest} request @param {{choose?: boolean}} [options] @returns {Promise<SaveResult>} */
  function save(request, {choose = false} = {}) {
    if (running) {
      if (!choose) again = request;
      return running;
    }
    const current = (async () => {
      let result = await run(request, choose);
      while (again && result.kind === 'file') {
        const next = again;
        again = null;
        result = await run(next, false);
      }
      again = null;
      return result;
    })();
    running = current;
    current.finally(() => { if (running === current) running = null; });
    return current;
  }

  return {save, busy: () => !!running};
}

export const RECENT_LIMIT = 10;

/**
 * Chosen files by layout id, and the recent files. File handles survive in IndexedDB
 * (Chrome keeps them with their permission to be asked again); when the database or
 * the handle cannot be stored they stay for this session only.
 * @returns {Required<HandleStore>}
 */
export function openHandleStore() {
  /** @type {Map<string, FileHandle>} */
  const memory = new Map();
  /** @type {Map<string, RecentFile>} */
  const recentMemory = new Map();
  /** @type {Promise<IDBDatabase | null> | null} */
  let opening = null;
  const db = () => opening ??= new Promise(resolve => {
    try {
      // Version 2 adds the recent files; version 1 had only the chosen file per layout.
      const request = indexedDB.open('dnd-card-editor' + STORAGE_SUFFIX + '-files', 2);
      request.onupgradeneeded = () => {
        const base = request.result;
        if (!base.objectStoreNames.contains('handles')) base.createObjectStore('handles');
        if (!base.objectStoreNames.contains('recent')) base.createObjectStore('recent', {keyPath: 'id'});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  /** @template T @param {'handles' | 'recent'} name @param {'readonly' | 'readwrite'} mode @param {(store: IDBObjectStore) => IDBRequest<T>} fn @returns {Promise<T | undefined>} */
  async function tx(name, mode, fn) {
    const base = await db();
    if (!base) return undefined;
    return new Promise((resolve, reject) => {
      try {
        const request = fn(base.transaction(name, mode).objectStore(name));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (error) { reject(error); }
    });
  }
  /** @returns {Promise<RecentFile[]>} newest first */
  async function recent() {
    const stored = /** @type {RecentFile[] | undefined} */ (await tx('recent', 'readonly', store => store.getAll()).catch(() => undefined)) ?? [];
    const all = new Map(stored.map(entry => [entry.id, entry]));
    for (const entry of recentMemory.values()) all.set(entry.id, entry);
    return [...all.values()].sort((a, b) => b.usedAt.localeCompare(a.usedAt));
  }
  /** @param {string} id */
  async function removeRecent(id) {
    recentMemory.delete(id);
    await tx('recent', 'readwrite', store => store.delete(id)).catch(() => {});
  }
  return {
    async get(id) {
      if (memory.has(id)) return memory.get(id);
      const handle = /** @type {FileHandle | undefined} */ (await tx('handles', 'readonly', store => store.get(id)).catch(() => undefined));
      if (handle) memory.set(id, handle);
      return handle;
    },
    async set(id, handle) {
      memory.set(id, handle);
      await tx('handles', 'readwrite', store => store.put(handle, id)).catch(() => {});
    },
    async delete(id) {
      memory.delete(id);
      await tx('handles', 'readwrite', store => store.delete(id)).catch(() => {});
    },
    recent,
    async addRecent(entry) {
      recentMemory.set(entry.id, entry);
      // A handle the database cannot keep (or no database) stays in memory for this session.
      const stored = !!await db() && await tx('recent', 'readwrite', store => store.put(entry)).then(() => true, () => false);
      if (stored) recentMemory.delete(entry.id);
      for (const old of (await recent()).slice(RECENT_LIMIT)) await removeRecent(old.id);
    },
    removeRecent,
  };
}

/** @returns {((options: object) => Promise<FileHandle>) | null} */
function savePicker() {
  const picker = /** @type {{showSaveFilePicker?: (options: object) => Promise<FileHandle>}} */ (/** @type {unknown} */ (window)).showSaveFilePicker;
  return typeof picker === 'function' ? picker.bind(window) : null;
}

/**
 * The «Сохранить в файл» / «Сохранить как…» buttons, Ctrl+S and Ctrl+Shift+S
 * (in any keyboard layout, also while typing), and the file name next to the
 * save state. The browser's own «save page» would store the live editor, which
 * does not open again, so Ctrl+S never reaches it.
 * @param {{store: import('../types/layout').Store, notices: ReturnType<typeof import('./notice.js').createNotices>,
 *   exportFile: () => {name: string, html: string}, layoutFile: () => {name: string, text: string},
 *   identity: () => {id: string, name: string}}} deps
 */
export function setupFileSave({store, notices, exportFile, layoutFile, identity}) {
  const handles = openHandleStore();
  const layoutType = {description: 'Макет листов (.dnd)', accept: {[LAYOUT_MIME]: [LAYOUT_EXTENSION]}};
  const htmlType = {description: 'Редактор листов с макетом (HTML)', accept: {'text/html': ['.html']}};
  const saver = createFileSave({
    pick: async suggestedName => {
      const picker = savePicker();
      if (!picker) return null;
      return picker({suggestedName, id: 'dnd-card-editor', types: HOSTED ? [layoutType, htmlType] : [htmlType, layoutType]});
    },
    handles
  });
  /** @param {string} fileName */
  const content = fileName => fileFormat(fileName) === 'html' ? exportFile().html : layoutFile().text;
  const state = /** @type {HTMLElement} */ (document.getElementById('fileState'));
  const time = () => new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
  /** @param {string} name @param {string} [when] */
  function showFile(name, when) {
    state.textContent = name;
    state.title = 'Ctrl+S сохраняет макет в файл «' + name + '»' + (when ? ' (последний раз в ' + when + ')' : '') + '. Ctrl+Shift+S — выбрать другой файл.';
  }
  async function refresh() {
    const handle = await handles.get(identity().id).catch(() => undefined);
    if (handle && savePicker()) showFile(handle.name);
    else { state.textContent = ''; state.title = ''; }
  }
  /** @param {{choose?: boolean}} [options] */
  async function save({choose = false} = {}) {
    store.commit();
    if (!savePicker()) {
      if (HOSTED) { const {name, text} = layoutFile(); downloadFile(name, text, LAYOUT_MIME); }
      else { const {name, html} = exportFile(); downloadFile(name, html, 'text/html;charset=utf-8'); }
      notices.show('file', 'Этот браузер не умеет сохранять прямо в файл (так умеют Chrome и Edge), поэтому макет скачан в «Загрузки» новым файлом.');
      return;
    }
    const {id, name} = identity();
    const result = await saver.save({id, fileName: fileBase(name) + (HOSTED ? LAYOUT_EXTENSION : '.html'), content}, {choose});
    const download = {label: 'Скачать HTML', onClick: () => document.getElementById('export')?.click()};
    const other = {label: 'Выбрать файл', onClick: () => { notices.hide('file'); void save({choose: true}); }};
    if (result.kind === 'file') {
      notices.hide('file'); showFile(result.name, time());
      const handle = await handles.get(id);
      if (handle) await handles.addRecent({id, fileName: handle.name, layoutName: name, usedAt: new Date().toISOString(), handle});
    }
    else if (result.kind === 'denied') notices.show('file', 'Браузер не дал записать в файл «' + result.name + '». Выберите файл ещё раз (можно тот же) или скачайте HTML. Макет сохранён в браузере.', [other, download]);
    else if (result.kind === 'error') {
      console.warn('Saving to the file failed', result.error);
      const reason = result.error instanceof Error && result.error.message ? ' (' + result.error.message + ')' : '';
      notices.show('file', 'Не удалось сохранить в файл «' + result.name + '»' + reason + '. Макет сохранён в браузере; чтобы не потерять работу, скачайте HTML или выберите другой файл.', [download, other]);
      void refresh();
    }
  }
  const button = /** @type {HTMLButtonElement} */ (document.getElementById('saveFile'));
  const as = /** @type {HTMLButtonElement} */ (document.getElementById('saveFileAs'));
  if (!savePicker()) {
    button.title = 'В этом браузере сохранить прямо в файл нельзя (так умеют Chrome и Edge): макет скачается в «Загрузки», как «Скачать HTML». Ctrl+S';
    as.hidden = true;
  }
  button.onclick = () => void save();
  as.onclick = () => void save({choose: true});
  // Capture phase: before the text editor sees the keys; any layout (code KeyS).
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.code !== 'KeyS' && event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    if (event.repeat) return;
    void save({choose: event.shiftKey});
  }, true);
  // «Мои макеты» switches the layout, and with it the file.
  new MutationObserver(() => void refresh()).observe(document.documentElement, {attributes: true, attributeFilter: ['data-layout-id']});
  void refresh();
  return {
    handles,
    /** A file just opened becomes the layout's file: Ctrl+S writes back into it. @param {string} id @param {string} layoutName @param {FileHandle} handle */
    async remember(id, layoutName, handle) {
      await handles.set(id, handle);
      await handles.addRecent({id, fileName: handle.name, layoutName, usedAt: new Date().toISOString(), handle});
      await refresh();
    },
  };
}
