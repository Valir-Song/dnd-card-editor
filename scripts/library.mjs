// Ready sheets («Готовые листы»): the layout files in library/ are published next to the
// hosted editor (build-site.mjs), with library/index.json listing them. The editor reads the
// list and fetches a sheet only when it is chosen (src/editor/library.js), so the editor file
// does not grow with the library. Pure functions here (Node tests).
import { readLayoutFile, LAYOUT_EXTENSION } from '../src/editor/layout-file.js';
import { normalizeLayout } from '../src/editor/layout.js';
import { layoutTitle } from '../src/editor/freshness.js';

export const LIBRARY_FOLDER = 'library';
export const INDEX_NAME = 'index.json';

/**
 * One sheet of the list, or why the file cannot be a ready sheet.
 * @param {string} file the file name in library/
 * @param {string} text the file
 */
export function libraryEntry(file, text) {
  if (!file.toLowerCase().endsWith(LAYOUT_EXTENSION)) return {error: file + ': готовый лист должен быть файлом ' + LAYOUT_EXTENSION + '.'};
  const read = readLayoutFile(text);
  if ('error' in read) return {error: file + ': ' + read.error};
  const {items, errors} = normalizeLayout(read.data);
  if (!items) return {error: file + ': ' + errors.join(' ')};
  const header = items.find(item => item.kind === 'header' && item.subtitle?.trim());
  return {entry: {
    file,
    name: read.name.trim() || layoutTitle(items),
    // The sheet describes itself: the line under the character's name.
    summary: header?.subtitle?.trim().replace(/\s+/g, ' ') || '',
    count: items.length,
    bytes: new TextEncoder().encode(text).length,
  }};
}

/**
 * The list the editor reads, sorted by name; every file that is not a sheet is an error,
 * so a broken upload stops the build instead of reaching the players.
 * @param {{file: string, text: string}[]} files
 */
export function libraryIndex(files) {
  const sheets = [], errors = [];
  for (const {file, text} of files) {
    if (file === INDEX_NAME || file.startsWith('.') || file.toLowerCase() === 'readme.md') continue;
    const result = libraryEntry(file, text);
    if ('error' in result) errors.push(result.error); else sheets.push(result.entry);
  }
  sheets.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return {sheets, errors};
}
