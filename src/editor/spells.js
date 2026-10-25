// Spell reference («Заклинание…»): our own Russian translation of SRD 5.2 (CC-BY 4.0) in
// library/spells.json, published next to the hosted editor like the ready sheets and
// fetched only when the dialog opens. A spell becomes an ordinary card in the style of the
// owner's sheet: badge = circle, a short meta line and a one-line summary; the card keeps the
// full text (spellText) so «📖» shows it even offline. Pure functions here (Node tests).

/** @typedef {import('../types/layout').NewItem} NewItem */
/**
 * @typedef {{id: string, name: string, nameEn: string, level: number, school: string,
 *   castingTime: string, range: string, components: string, duration: string,
 *   concentration: boolean, ritual: boolean, classes: string[], short: string,
 *   text: string[], higherLevel: string, aliases?: string[]}} Spell
 */

export const SPELLS_NAME = 'spells.json';
export const SPELLS_FORMAT = 'dnd-card-editor/spells';
/** Card width of the owner's sheet; the height grows with the summary. */
export const CARD_W = 91;
const SOURCE = 'SRD 5.2 (Wizards of the Coast), CC-BY 4.0. Перевод — D&D Card Editor.';

const STRING_KEYS = /** @type {const} */ (['id', 'name', 'nameEn', 'school', 'castingTime', 'range', 'components', 'duration', 'short', 'higherLevel']);

/**
 * The spells of spells.json; entries that are not spells are skipped.
 * @param {unknown} data
 * @returns {{spells: Spell[], attribution: string} | null} null when it is not a spell list
 */
export function readSpells(data) {
  const file = /** @type {{format?: unknown, spells?: unknown, attribution?: unknown}} */ (data && typeof data === 'object' ? data : {});
  if (file.format !== SPELLS_FORMAT || !Array.isArray(file.spells)) return null;
  const spells = file.spells.filter(/** @returns {spell is Spell} */ spell => !!spell && typeof spell === 'object'
    && STRING_KEYS.every(key => typeof spell[key] === 'string') && !!spell.id && !!spell.name
    && Number.isInteger(spell.level) && spell.level >= 0 && spell.level <= 9
    && Array.isArray(spell.text) && spell.text.every(/** @param {unknown} p */ p => typeof p === 'string')
    && Array.isArray(spell.classes))
    // Other names players know a spell by (another translation, the old name with a wizard's): search only.
    .map(spell => ({...spell, aliases: Array.isArray(spell.aliases) ? spell.aliases.filter(/** @param {unknown} a */ a => typeof a === 'string') : []}));
  return {spells, attribution: typeof file.attribution === 'string' ? file.attribution : ''};
}

/** «Заговор» or «3 круг», as on the owner's cards. @param {number} level */
export const levelName = level => level ? level + ' круг' : 'Заговор';

/**
 * The card's meta line: «1 круг · 60 фт. · К, 1 мин».
 * @param {Spell} spell
 */
export function spellMeta(spell) {
  const range = spell.range.replace(/ футов?$/, ' фт.').replace(/^На себя$/, 'на себя').replace(/^Касание$/, 'касание')
    .replace(/^Пределы видимости$/, 'в пределах видимости').replace(/^Особая$/, 'особая').replace(/^Не ограничена$/, 'без ограничений');
  const parts = [levelName(spell.level), range];
  if (spell.duration !== 'Мгновенно') {
    const duration = spell.duration.replace(/^до /, '').replace(/ минут[аы]?$/, ' мин').replace(/ час(а|ов)?$/, ' ч')
      .replace(/^1 дня$/, '1 день').replace(/^Пока не рассеется.*/, 'до рассеивания');
    parts.push((spell.concentration ? 'К, ' : '') + duration);
  }
  if (spell.ritual) parts.push('ритуал');
  return parts.join(' · ');
}

// «спасбросок Мудрости» → «Мудрость СЛ 14», as the owner writes it.
const ABILITIES = {Силы: 'Сила', Ловкости: 'Ловкость', Телосложения: 'Телосложение', Интеллекта: 'Интеллект', Мудрости: 'Мудрость', Харизмы: 'Харизма'};
/**
 * The summary with the player's spell save DC, when there is one.
 * @param {string} text @param {number | null} dc
 */
export function withDc(text, dc) {
  if (!dc) return text;
  return text.replace(/[Сс]пасбросок (Силы|Ловкости|Телосложения|Интеллекта|Мудрости|Харизмы)/,
    (_, ability) => ABILITIES[/** @type {keyof typeof ABILITIES} */ (ability)] + ' СЛ ' + dc);
}

/** A DC typed by the player: a whole number 1–30, otherwise none. @param {string} value */
export function readDc(value) {
  const dc = Number(value.trim());
  return Number.isInteger(dc) && dc >= 1 && dc <= 30 ? dc : null;
}

/**
 * The full description kept in the card: paragraphs separated by an empty line, **bold**;
 * the first paragraph is the heading.
 * @param {Spell} spell
 */
export function spellText(spell) {
  const kind = (spell.level ? spell.level + '-й круг' : 'Заговор') + ', ' + spell.school.toLowerCase()
    + (spell.concentration ? ', концентрация' : '') + (spell.ritual ? ', ритуал' : '');
  return [
    spell.name + ' [' + spell.nameEn + '] — ' + kind,
    '**Время:** ' + spell.castingTime + ' · **Дистанция:** ' + spell.range + ' · **Компоненты:** ' + spell.components
      + ' · **Длительность:** ' + (spell.concentration ? 'Концентрация, ' : '') + spell.duration,
    ...spell.text,
    ...(spell.higherLevel ? [spell.higherLevel] : []),
    SOURCE,
  ].join('\n\n');
}

/**
 * A paragraph as plain pieces and bold pieces (shown with textContent, never as HTML).
 * @param {string} paragraph
 * @returns {{text: string, bold: boolean}[]}
 */
export function boldPieces(paragraph) {
  return paragraph.split(/\*\*/).map((text, i) => ({text, bold: i % 2 === 1})).filter(piece => piece.text);
}

/**
 * The card for a spell; long summaries get a taller card so the text fits.
 * @param {Spell} spell @param {number | null} dc
 * @returns {NewItem}
 */
export function spellCard(spell, dc) {
  const detail = withDc(spell.short, dc);
  return {kind: 'card', w: CARD_W, h: detail.length > 95 ? 27 : 22.6, title: spell.name, meta: spellMeta(spell), detail,
    level: String(spell.level), bg: '#ffffff', spellId: spell.id, spellText: spellText(spell)};
}

/**
 * Cards for several spells, in columns of up to ten under each other, ready for addObjects.
 * @param {Spell[]} spells @param {number | null} dc
 * @returns {NewItem[]}
 */
export function spellCards(spells, dc) {
  const tops = [0, 0, 0];
  return spells.map((spell, i) => {
    const card = spellCard(spell, dc), column = Math.floor(i / 10);
    const placed = {...card, x: column * (CARD_W + 4), y: tops[column] ?? 0};
    tops[column] = (tops[column] ?? 0) + card.h + 2;
    return placed;
  });
}
/** At most this many cards at once: two columns fill an A4 page. */
export const MAX_AT_ONCE = 20;

/**
 * The spells the dialog shows: by circle, then by a search in the Russian, English or another known name.
 * @param {Spell[]} spells @param {{query: string, level: number | null, cls?: string}} filter
 */
export function filterSpells(spells, {query, level, cls = 'bard'}) {
  const words = query.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  return spells.filter(spell => (level === null || spell.level === level) && (!cls || spell.classes.includes(cls))
    && words.every(word => [spell.name, spell.nameEn, ...(spell.aliases || [])].join(' ').toLowerCase().replace(/ё/g, 'е').includes(word)))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'ru'));
}
