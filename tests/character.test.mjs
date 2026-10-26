import test from 'node:test';
import assert from 'node:assert/strict';
import { characterOf, characterStats, modifier, profBonus, setScore, setLevel, toggleSave, cycleSkill, setJack,
  setSpellAbility, setFixed, newCharacter, signed, readNumber, findCharacter } from '../src/editor/character.js';
import { pageCount, keepPages, addPage, duplicatePage, removePage, movePage, objectsOn } from '../src/editor/pages.js';
import { normalizeLayout } from '../src/editor/layout.js';

// Richard: bard 6, CHA 16; proficient in DEX and CHA saves; expertise in Performance and Persuasion.
function richard() {
  const item = newCharacter('c');
  for (const [ability, score] of Object.entries({str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16})) setScore(item, /** @type {any} */ (ability), score);
  setLevel(item, 6);
  toggleSave(item, 'dex'); toggleSave(item, 'cha');
  cycleSkill(item, 'performance'); cycleSkill(item, 'performance');
  cycleSkill(item, 'persuasion'); cycleSkill(item, 'persuasion');
  cycleSkill(item, 'deception');
  setSpellAbility(item, 'cha');
  return item;
}

test('modifiers and the proficiency bonus follow the rules', () => {
  assert.deepEqual([1, 8, 9, 10, 11, 16, 30].map(modifier), [-5, -1, -1, 0, 0, 3, 10]);
  assert.deepEqual([1, 4, 5, 8, 9, 13, 17, 20].map(profBonus), [2, 2, 3, 3, 4, 5, 6, 6]);
});

test('saves, skills, initiative, passive perception and spell DC are counted', () => {
  const s = characterStats(characterOf(richard()));
  assert.equal(s.prof.value, 3);
  assert.equal(s.mods.cha, 3);
  assert.deepEqual([s.saves.dex.value, s.saves.cha.value, s.saves.str.value], [5, 6, -1]);
  assert.deepEqual([s.saves.dex.rank, s.saves.str.rank], [1, 0]);
  assert.deepEqual([s.skills.performance.value, s.skills.deception.value, s.skills.athletics.value], [9, 6, -1]);
  assert.deepEqual([s.skills.performance.rank, s.skills.deception.rank], [2, 1]);
  assert.equal(s.init.value, 2);
  assert.equal(s.ac.value, 12, 'without armour: 10 + DEX');
  assert.equal(s.speed.value, 30);
  assert.equal(s.passive.value, 11);
  assert.equal(s.dc.value, 14, 'the DC on the header of the owner’s sheet');
  assert.equal(s.attack.value, 6);
});

test('Jack of All Trades adds half the bonus, rounded down, to skills without proficiency only', () => {
  const item = richard();
  setJack(item, true);
  const s = characterStats(characterOf(item));
  assert.equal(s.skills.athletics.value, -1 + 1);
  assert.equal(s.skills.performance.value, 9, 'expertise unchanged');
  assert.equal(s.saves.str.value, -1, 'saves are not skill checks');
  assert.equal(s.passive.value, 12);
});

test('a skill goes round none → proficiency → expertise → none', () => {
  const item = newCharacter('c');
  const ranks = [];
  for (let i = 0; i < 4; i++) { cycleSkill(item, 'stealth'); ranks.push(characterOf(item).skills.stealth || 0); }
  assert.deepEqual(ranks, [1, 2, 0, 1]);
});

test('a typed number wins over the count, and later counts use it; null gives the count back', () => {
  const item = richard();
  setFixed(item, 'ac', 15);
  setFixed(item, 'prof', 4);
  setFixed(item, 'skill:perception', 5);
  let s = characterStats(characterOf(item));
  assert.deepEqual(s.ac, {value: 15, auto: 12, fixed: true});
  assert.equal(s.skills.performance.value, 3 + 8, 'expertise doubles the typed bonus');
  assert.equal(s.dc.value, 15);
  assert.equal(s.passive.value, 15, 'passive perception from the typed skill');
  setFixed(item, 'prof', null);
  s = characterStats(characterOf(item));
  assert.deepEqual(s.prof, {value: 3, auto: 3, fixed: false});
  setFixed(item, 'nonsense', 3);
  assert.equal('nonsense' in characterOf(item).fixed, false);
});

test('no spellcasting ability: no DC and no attack, unless typed', () => {
  const item = newCharacter('c');
  let s = characterStats(characterOf(item));
  assert.equal(s.dc.value, null);
  setFixed(item, 'dc', 13);
  s = characterStats(characterOf(item));
  assert.deepEqual(s.dc, {value: 13, auto: null, fixed: true});
});

test('damaged stats are repaired, not refused', () => {
  const c = characterOf({character: {level: 99, scores: {str: 'x', dex: 0, cha: 50}, saves: ['dex', 'nope', 'dex'], skills: {stealth: 3, arcana: 2, fly: 1},
    jack: 'yes', spell: 'luck', fixed: {ac: 14.6, init: 'x', bogus: 1}}});
  assert.equal(c.level, 20);
  assert.deepEqual([c.scores.str, c.scores.dex, c.scores.cha, c.scores.wis], [10, 1, 30, 10]);
  assert.deepEqual(c.saves, ['dex']);
  assert.deepEqual(c.skills, {arcana: 2});
  assert.equal(c.jack, false);
  assert.equal(c.spell, '');
  assert.deepEqual(c.fixed, {ac: 15});
  assert.deepEqual(characterOf({}).scores, {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10});
  setScore(newCharacter('c'), 'str', '');
});

test('numbers are written and read the way people type them', () => {
  assert.deepEqual([signed(3), signed(0), signed(-1), signed(null)], ['+3', '+0', '−1', '—']);
  assert.deepEqual(['+3', '-1', '−1', ' 14 ', '', '+', '1.5', 'abc'].map(readNumber), [3, -1, -1, 14, null, null, null, null]);
});

test('the layout keeps the stats object (format unchanged)', () => {
  const card = {id: 'a', kind: 'card', page: 2, x: 5, y: 5, w: 60, h: 40, z: 1};
  const result = normalizeLayout([card, richard()]);
  assert.deepEqual(result.errors, []);
  assert.equal(findCharacter(/** @type {any} */ (result.items))?.character?.level, 6);
});

test('pages: the stats object stays on page 1, is not copied, not removed, and does not hold a page', () => {
  const makeId = (() => { let n = 0; return () => 'n' + (++n); })();
  const stats = {...newCharacter('c'), page: 3};
  assert.equal(pageCount([stats]), 1, 'a stats object alone makes no pages');
  /** @type {any[]} */
  let items = [{...newCharacter('c')}, {id: 'a', kind: 'card', page: 1, x: 5, y: 5, w: 60, h: 40, z: 1}];
  const blank = [...items.slice(0, 1)];
  keepPages(blank, 1, makeId);
  assert.equal(blank.filter(i => i.kind === 'sheet').length, 1, 'a page with only the stats gets a sheet');
  addPage(items, 0, makeId);
  assert.equal(findCharacter(items)?.page, 1, 'a page before page 1 does not move the stats');
  duplicatePage(items, 2, makeId);
  assert.equal(items.filter(i => i.kind === 'character').length, 1);
  movePage(items, 1, 1);
  assert.equal(findCharacter(items)?.page, 1);
  items = /** @type {any[]} */ (removePage(items, 1, makeId));
  assert.ok(findCharacter(items), 'removing page 1 keeps the stats');
  assert.equal(objectsOn(items, 1).some(i => i.kind === 'character'), false);
});
