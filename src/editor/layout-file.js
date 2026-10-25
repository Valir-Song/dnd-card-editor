// A layout as a document of its own, like a Word file: «Ричард.dnd» holds the JSON a
// «Скачать JSON» gives (wrapLayout, format 2) plus the layout's id, so opening the file
// again continues the same layout and Ctrl+S writes back into it.
// Opening also reads the older ways a layout was kept: a bare JSON array, and an editor
// HTML downloaded from any version (the layout sits in its #initial script).
import { hashText } from './freshness.js';

export const LAYOUT_EXTENSION = '.dnd';
export const LAYOUT_MIME = 'application/x-dnd-card-layout+json';

/**
 * What a layout file holds. `data` goes to normalizeLayout; `id` is the layout's own id
 * (null: the file starts a new layout), `name` and `savedAt` may be missing.
 * @typedef {{data: unknown, id: string | null, name: string, savedAt: string | null, kind: 'layout' | 'html'}} LayoutFile
 */

/** @param {string} fileName @returns {'layout' | 'html'} the kind of file Ctrl+S writes for this name */
export function fileFormat(fileName) {
  return /\.html?$/i.test(fileName) ? 'html' : 'layout';
}

/** @param {string} value */
const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * @param {string} text the whole file
 * @returns {LayoutFile | {error: string}}
 */
export function readLayoutFile(text) {
  if (/^\s*</.test(text)) return readEditorHtml(text);
  /** @type {unknown} */
  let data;
  try { data = JSON.parse(text); } catch { return {error: 'Файл не является макетом: это не JSON и не HTML редактора.'}; }
  if (Array.isArray(data)) return {data, id: null, name: '', savedAt: null, kind: 'layout'};
  const about = /** @type {{id?: unknown, name?: unknown, savedAt?: unknown}} */ (data && typeof data === 'object' ? data : {});
  return {
    data,
    id: typeof about.id === 'string' && about.id && !about.id.includes(':') ? about.id : null,
    name: typeof about.name === 'string' ? about.name : '',
    savedAt: typeof about.savedAt === 'string' && !Number.isNaN(Date.parse(about.savedAt)) ? about.savedAt : null,
    kind: 'layout',
  };
}

/**
 * The layout inside a downloaded editor. Its id follows the editor's own start-up rule
 * (chooseLayout in freshness.js), so the file reaches the same browser save as when it
 * is opened from disk: its data-layout-id, or for 3.3–3.8 files a hash of layout and time.
 * @param {string} text
 * @returns {LayoutFile | {error: string}}
 */
function readEditorHtml(text) {
  const match = /<script\b([^>]*\bid="initial"[^>]*)>([\s\S]*?)<\/script>/i.exec(text);
  if (!match) return {error: 'Это HTML-файл, но в нём нет макета редактора листов.'};
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const [, key, value] of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[key] = decode(value);
  const raw = match[2];
  /** @type {unknown} */
  let data;
  try { data = JSON.parse(raw); } catch { return {error: 'Макет в этом HTML-файле повреждён.'}; }
  // As the editor reads its own #initial (editor.js): no data-format-version means format 1.
  if (Array.isArray(data)) data = {formatVersion: Number(attrs['data-format-version']) || 1, items: data};
  const savedAt = attrs['data-saved-at'] && !Number.isNaN(Date.parse(attrs['data-saved-at'])) ? attrs['data-saved-at'] : null;
  const id = attrs['data-layout-id'] || (savedAt ? 'f-' + hashText(raw + savedAt) : null);
  return {data, id, name: attrs['data-layout-name'] || '', savedAt, kind: 'html'};
}
