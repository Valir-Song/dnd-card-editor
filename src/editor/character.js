// Character stats («Персонаж», 4.1): ability scores, level, saves and skills of
// the hero, kept on one invisible object of the layout (kind 'character'), so they
// travel with the .dnd and HTML files. The player types scores, level and which
// saves and skills are proficient; modifiers, the proficiency bonus, saves, skills,
// initiative, passive perception and the spell DC are counted. Any counted number
// can be typed over (`fixed`) and given back to the count. The editor is a sheet
// designer, not a rules engine: no armour, feats or items, just the plain sums.
// The object is never drawn, printed, selected or moved (render.js, pages.js and
// the gesture layer skip it).

/** @typedef {import('../types/layout').Item} Item */
/** @typedef {import('../types/layout').Ability} Ability */
/** @typedef {import('../types/layout').Character} Character */
/** @typedef {{value: number | null, auto: number | null, fixed: boolean}} Value */

/** @type {ReadonlyArray<{id: Ability, short: string, name: string}>} */
export const ABILITIES = [
  {id: 'str', short: 'СИЛ', name: 'Сила'},
  {id: 'dex', short: 'ЛОВ', name: 'Ловкость'},
  {id: 'con', short: 'ТЕЛ', name: 'Телосложение'},
  {id: 'int', short: 'ИНТ', name: 'Интеллект'},
  {id: 'wis', short: 'МДР', name: 'Мудрость'},
  {id: 'cha', short: 'ХАР', name: 'Харизма'},
];
const ABILITY_IDS = ABILITIES.map(a => a.id);

// SRD 5.2 skills, named as in our spell translation (spells.json).
/** @type {ReadonlyArray<{id: string, name: string, ability: Ability}>} */
export const SKILLS = [
  {id: 'athletics', name: 'Атлетика', ability: 'str'},
  {id: 'acrobatics', name: 'Акробатика', ability: 'dex'},
  {id: 'sleightOfHand', name: 'Ловкость рук', ability: 'dex'},
  {id: 'stealth', name: 'Скрытность', ability: 'dex'},
  {id: 'arcana', name: 'Магия', ability: 'int'},
  {id: 'history', name: 'История', ability: 'int'},
  {id: 'investigation', name: 'Расследование', ability: 'int'},
  {id: 'nature', name: 'Природа', ability: 'int'},
  {id: 'religion', name: 'Религия', ability: 'int'},
  {id: 'animalHandling', name: 'Уход за животными', ability: 'wis'},
  {id: 'insight', name: 'Проницательность', ability: 'wis'},
  {id: 'medicine', name: 'Медицина', ability: 'wis'},
  {id: 'perception', name: 'Внимательность', ability: 'wis'},
  {id: 'survival', name: 'Выживание', ability: 'wis'},
  {id: 'deception', name: 'Обман', ability: 'cha'},
  {id: 'intimidation', name: 'Запугивание', ability: 'cha'},
  {id: 'performance', name: 'Выступление', ability: 'cha'},
  {id: 'persuasion', name: 'Убеждение', ability: 'cha'},
];
const SKILL_IDS = SKILLS.map(s => s.id);

/** Numbers that can be typed over a count: these keys, `save:<ability>` and `skill:<id>`. */
export const FIXABLE = ['prof', 'ac', 'init', 'speed', 'passive', 'dc', 'attack',
  ...ABILITY_IDS.map(a => 'save:' + a), ...SKILL_IDS.map(s => 'skill:' + s)];
export const MAX_LEVEL = 20;
export const MAX_SCORE = 30;
const FIXED_LIMIT = 999;

/** @param {Item} item */
export const isCharacter = item => item.kind === 'character';

/** The character object of a layout (the first one), if it has one. @param {Item[]} items */
export const findCharacter = items => items.find(isCharacter);

/** @param {unknown} value @param {number} min @param {number} max @param {number} fallback */
function whole(value, min, max, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && value !== null && value !== '' ? Math.max(min, Math.min(max, n)) : fallback;
}

/** The stats of an item, repaired (missing parts get defaults). @param {Item | {character?: unknown}} item @returns {Character} */
export function characterOf(item) {
  const raw = /** @type {Record<string, any>} */ (item.character && typeof item.character === 'object' ? item.character : {});
  const rawScores = raw.scores && typeof raw.scores === 'object' ? raw.scores : {};
  /** @type {Record<Ability, number>} */
  const scores = {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10};
  for (const id of ABILITY_IDS) scores[id] = whole(rawScores[id], 1, MAX_SCORE, 10);
  const saves = ABILITY_IDS.filter(id => Array.isArray(raw.saves) && raw.saves.includes(id));
  /** @type {Record<string, 1 | 2>} */
  const skills = {};
  const rawSkills = raw.skills && typeof raw.skills === 'object' ? raw.skills : {};
  for (const id of SKILL_IDS) if (rawSkills[id] === 1 || rawSkills[id] === 2) skills[id] = rawSkills[id];
  /** @type {Record<string, number>} */
  const fixed = {};
  const rawFixed = raw.fixed && typeof raw.fixed === 'object' ? raw.fixed : {};
  for (const key of FIXABLE) if (Number.isFinite(rawFixed[key])) fixed[key] = whole(rawFixed[key], -FIXED_LIMIT, FIXED_LIMIT, 0);
  return {
    level: whole(raw.level, 1, MAX_LEVEL, 1),
    scores, saves, skills,
    jack: raw.jack === true,
    spell: ABILITY_IDS.includes(raw.spell) ? raw.spell : '',
    fixed,
  };
}

/** @param {number} score */
export const modifier = score => Math.floor((score - 10) / 2);
/** Proficiency bonus by level: +2 at 1–4, +3 at 5–8 … +6 at 17–20. @param {number} level */
export const profBonus = level => 2 + Math.floor((Math.max(1, level) - 1) / 4);

/**
 * Everything the window shows: counted numbers, with the typed ones over them.
 * @param {Character} c
 */
export function characterStats(c) {
  /** @param {string} key @param {number | null} auto @returns {Value} */
  const value = (key, auto) => key in c.fixed ? {value: c.fixed[key], auto, fixed: true} : {value: auto, auto, fixed: false};
  /** @type {Record<Ability, number>} */
  const mods = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
  for (const id of ABILITY_IDS) mods[id] = modifier(c.scores[id]);
  const prof = value('prof', profBonus(c.level));
  const pb = prof.value ?? 0;
  /** @type {Record<string, Value & {rank: number}>} */
  const saves = {};
  for (const id of ABILITY_IDS) {
    const rank = c.saves.includes(id) ? 1 : 0;
    saves[id] = {...value('save:' + id, mods[id] + rank * pb), rank};
  }
  /** @type {Record<string, Value & {rank: number}>} */
  const skills = {};
  for (const skill of SKILLS) {
    const rank = c.skills[skill.id] || 0;
    // Jack of All Trades (bard): half the bonus, rounded down, to skills without proficiency.
    const bonus = rank ? rank * pb : c.jack ? Math.floor(pb / 2) : 0;
    skills[skill.id] = {...value('skill:' + skill.id, mods[skill.ability] + bonus), rank};
  }
  const spellMod = c.spell ? mods[c.spell] : null;
  return {
    mods, prof, saves, skills,
    ac: value('ac', 10 + mods.dex),
    init: value('init', mods.dex),
    speed: value('speed', 30),
    passive: value('passive', 10 + (skills.perception.value ?? 0)),
    dc: value('dc', spellMod === null ? null : 8 + pb + spellMod),
    attack: value('attack', spellMod === null ? null : pb + spellMod),
  };
}

// ---- edits (each repairs the stats and changes the item in place) ----

/** @param {Item} item @param {(c: Character) => void} change */
function edit(item, change) {
  const c = characterOf(item);
  change(c);
  item.character = c;
}

/** @param {Item} item @param {Ability} ability @param {unknown} score */
export function setScore(item, ability, score) {
  edit(item, c => { c.scores[ability] = whole(score, 1, MAX_SCORE, c.scores[ability]); });
}

/** @param {Item} item @param {unknown} level */
export function setLevel(item, level) {
  edit(item, c => { c.level = whole(level, 1, MAX_LEVEL, c.level); });
}

/** Proficient save on / off. @param {Item} item @param {Ability} ability */
export function toggleSave(item, ability) {
  edit(item, c => { c.saves = c.saves.includes(ability) ? c.saves.filter(a => a !== ability) : [...c.saves, ability]; });
}

/** A skill goes round: none → proficiency → expertise → none. @param {Item} item @param {string} skill */
export function cycleSkill(item, skill) {
  edit(item, c => {
    const next = ((c.skills[skill] || 0) + 1) % 3;
    if (next) c.skills[skill] = /** @type {1 | 2} */ (next); else delete c.skills[skill];
  });
}

/** @param {Item} item @param {boolean} on */
export function setJack(item, on) {
  edit(item, c => { c.jack = on; });
}

/** @param {Item} item @param {Ability | ''} ability */
export function setSpellAbility(item, ability) {
  edit(item, c => { c.spell = ability; });
}

/** Type a number over a count, or (null) give the count back. @param {Item} item @param {string} key @param {number | null} number */
export function setFixed(item, key, number) {
  edit(item, c => {
    if (number === null) delete c.fixed[key];
    else if (FIXABLE.includes(key)) c.fixed[key] = whole(number, -FIXED_LIMIT, FIXED_LIMIT, 0);
  });
}

/** The invisible object that holds the stats. @param {string} id @returns {Item} */
export function newCharacter(id) {
  return {id, kind: 'character', page: 1, x: 0, y: 0, w: 210, h: 297, z: 0, character: characterOf({})};
}

/** «+3», «−1» (a real minus), «+0»; «—» for nothing. @param {number | null} n */
export const signed = n => n === null ? '—' : n < 0 ? '−' + Math.abs(n) : '+' + n;

/** A number as people type it: «+3», «-1», «−1», «14»; null when it is not one. @param {string} text */
export function readNumber(text) {
  const match = /^\s*([+\-−]?)\s*(\d{1,3})\s*$/.exec(text);
  if (!match) return null;
  return (match[1] === '-' || match[1] === '−' ? -1 : 1) * Number(match[2]);
}
