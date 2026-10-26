// «Вписать в лист» (window «Персонаж», 4.3): the hero's numbers written into the
// texts the player already has. The sheet keeps its own words; only the number
// after a known label changes: «КД 15», «Атака +6», «Инициатива +2», «Скорость 30»
// in the header, «СЛ магии 14» / «СЛ заклинаний 14» and «Мудрость СЛ 14» anywhere.
// Attack, AC and speed only in the header: a card's «Атака +5» is a weapon.
// One press = one undo step; nothing changes on its own while the player types.
import { signed } from './character.js';

/** @typedef {import('../types/layout').Item} Item */
/** @typedef {ReturnType<typeof import('./character.js').characterStats>} Stats */

const FIELDS = /** @type {const} */ (['title', 'subtitle', 'meta', 'detail', 'text']);
const HTML_FIELDS = /** @type {const} */ (['titleHtml', 'subtitleHtml', 'metaHtml', 'detailHtml', 'textHtml']);
const TEXT_KINDS = ['header', 'note', 'card', 'section', 'textbox', 'shape'];

// Not a letter before the label; spaces, &nbsp; or formatting tags between label and number.
const START = '(^|[^А-Яа-яЁёA-Za-z])';
const GAP = '(?:\\s|&nbsp;|<[^>]+>)*';
const PLAIN = '(?:\\d+|—)';
const SIGNED = '(?:[+\\-−]?\\d+|\\+?—)';
const ABILITY = '(?:Сила|Силы|Ловкость|Ловкости|Телосложение|Телосложения|Интеллект|Интеллекта|Мудрость|Мудрости|Харизма|Харизмы)';

/** @param {string} label @param {string} number */
const rule = (label, number) => new RegExp(START + '(' + label + GAP + ')' + number + '(?![\\d])', 'g');

/**
 * What can be written, by part of the sheet: [label, number pattern, stat].
 * @type {ReadonlyArray<{key: 'ac' | 'attack' | 'init' | 'speed' | 'dc', re: RegExp, sign: boolean, header: boolean}>}
 */
const RULES = [
  {key: 'ac', re: rule('КД', PLAIN), sign: false, header: true},
  {key: 'attack', re: rule('Атака', SIGNED), sign: true, header: true},
  {key: 'init', re: rule('Инициатива', SIGNED), sign: true, header: true},
  {key: 'speed', re: rule('Скорость', PLAIN), sign: false, header: true},
  {key: 'dc', re: rule('СЛ' + GAP + '(?:магии|заклинаний)', PLAIN), sign: false, header: false},
  {key: 'dc', re: rule(ABILITY + GAP + 'СЛ', PLAIN), sign: false, header: false},
];

/** @typedef {{ac: number, attack: number, init: number, speed: number, dc: number}} Counts */

/**
 * Writes the numbers into one text; counts the places that really changed.
 * @param {string} text @param {boolean} header @param {Stats} stats @param {Counts} counts
 */
export function fillText(text, header, stats, counts) {
  let out = text;
  for (const {key, re, sign, header: headerOnly} of RULES) {
    const value = stats[key].value;
    if (value === null || (headerOnly && !header)) continue;
    const number = sign ? signed(value) : String(value);
    out = out.replace(re, (whole, before, label) => {
      const next = before + label + number;
      if (next !== whole) counts[key]++;
      return next;
    });
  }
  return out;
}

/**
 * Writes the hero's numbers into the layout's texts, in place.
 * @param {Item[]} items @param {Stats} stats
 * @returns {Counts} how many places changed, by number
 */
export function fillSheet(items, stats) {
  /** @type {Counts} */
  const counts = {ac: 0, attack: 0, init: 0, speed: 0, dc: 0};
  for (const item of items) {
    if (!TEXT_KINDS.includes(item.kind)) continue;
    const header = item.kind === 'header';
    // The formatted copy and the plain one are both written; the plain one is counted.
    FIELDS.forEach((field, i) => {
      const text = item[field], html = item[HTML_FIELDS[i]];
      if (typeof text === 'string') item[field] = fillText(text, header, stats, counts);
      if (typeof html === 'string') item[HTML_FIELDS[i]] = fillText(html, header, stats, typeof text === 'string' ? {...counts} : counts);
    });
  }
  return counts;
}

/** «КД — 1, СЛ — 9»: what the press changed, for the window. @param {Counts} counts */
export function fillReport(counts) {
  const names = {ac: 'КД', dc: 'СЛ', attack: 'атака', init: 'инициатива', speed: 'скорость'};
  const parts = /** @type {const} */ (['ac', 'dc', 'attack', 'init', 'speed']).filter(k => counts[k]).map(k => names[k] + ' — ' + counts[k]);
  return parts.length ? 'Вписано: ' + parts.join(', ') + '. Отменить — Ctrl+Z.' : 'На листе всё уже совпадает или нечего менять.';
}
