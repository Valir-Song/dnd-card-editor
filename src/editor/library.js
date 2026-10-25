// Ready sheets («Готовые листы»): layout files published next to the hosted editor with
// library/index.json listing them (scripts/library.mjs). Nothing of the library is built
// into the editor: the list and a sheet are fetched when the user asks for them, so the
// file stays small however many sheets there are. The app's service worker keeps what was
// fetched for offline use; an editor file from disk reads the site, so it needs the internet.

import { SPELLS_NAME } from './spells.js';

/** @typedef {{file: string, name: string, summary: string, count: number, bytes: number}} LibrarySheet */
/** @typedef {(url: string) => Promise<{ok: boolean, status: number, text: () => Promise<string>}>} Fetch */

/** Where the main editor lives on the web. */
export const LIBRARY_SITE = 'https://valir-song.github.io/dnd-editor/library/';

/**
 * The library of this copy of the editor: the app reads its own folder (the beta has its
 * own), a file from disk reads the main site.
 * @param {boolean} hosted @param {string} href the page address
 */
export function libraryBase(hosted, href) {
  return hosted ? new URL('library/', href).href : LIBRARY_SITE;
}

/**
 * The sheets of index.json; entries that are not sheets are skipped.
 * @param {unknown} data
 * @returns {LibrarySheet[] | null} null when it is not a library index
 */
export function readIndex(data) {
  const sheets = data && typeof data === 'object' ? /** @type {{sheets?: unknown}} */ (data).sheets : null;
  if (!Array.isArray(sheets)) return null;
  return sheets.filter(/** @returns {sheet is LibrarySheet} */ sheet => !!sheet && typeof sheet === 'object'
    && typeof sheet.file === 'string' && !!sheet.file && !/[\\/]/.test(sheet.file) && typeof sheet.name === 'string')
    .map(sheet => ({file: sheet.file, name: sheet.name, summary: typeof sheet.summary === 'string' ? sheet.summary : '',
      count: Number(sheet.count) || 0, bytes: Number(sheet.bytes) || 0}));
}

/** @param {string} base @param {Fetch} fetchText */
export function createLibrary(base, fetchText) {
  /** @param {string} name */
  async function text(name) {
    const response = await fetchText(new URL(encodeURIComponent(name), base).href);
    if (!response.ok) throw Error('HTTP ' + response.status);
    return response.text();
  }
  return {
    base,
    /** @returns {Promise<LibrarySheet[]>} */
    async list() {
      const sheets = readIndex(JSON.parse(await text('index.json')));
      if (!sheets) throw Error('Список готовых листов повреждён.');
      return sheets;
    },
    /** The sheet's file, as «Открыть» reads it. @param {LibrarySheet} sheet */
    sheet: (/** @type {LibrarySheet} */ sheet) => text(sheet.file),
    /** The spell reference (spells.js). @returns {Promise<unknown>} */
    spells: async () => JSON.parse(await text(SPELLS_NAME)),
  };
}
