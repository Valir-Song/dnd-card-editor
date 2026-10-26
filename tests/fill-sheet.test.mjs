import test from 'node:test';
import assert from 'node:assert/strict';
import { fillSheet, fillText, fillReport } from '../src/editor/fill-sheet.js';
import { characterOf, characterStats, newCharacter, setScore, setLevel, setSpellAbility, setFixed } from '../src/editor/character.js';

// Bard 6, DEX 14, CHA 18: AC 12, initiative +2, DC 15, attack +7, speed 30.
function stats(spell = true) {
  const item = newCharacter('c');
  setScore(item, 'dex', 14); setScore(item, 'cha', 18); setLevel(item, 6);
  if (spell) setSpellAbility(item, 'cha');
  return characterStats(characterOf(item));
}
const zero = () => ({ac: 0, attack: 0, init: 0, speed: 0, dc: 0});

test('the header gets AC, attack, initiative, speed and DC; the words stay', () => {
  const counts = zero();
  assert.equal(fillText('КД 15 · HP 39 · СЛ магии 14 · Атака +6 · Скорость 30 фт.', true, stats(), counts),
    'КД 12 · HP 39 · СЛ магии 15 · Атака +7 · Скорость 30 фт.');
  assert.deepEqual(counts, {ac: 1, attack: 1, init: 0, speed: 0, dc: 1}, 'speed was already 30');
  assert.equal(fillText('КД — · ХП — · СЛ заклинаний — · Атака +— · Скорость — фт. · Инициатива +0', true, stats(), zero()),
    'КД 12 · ХП — · СЛ заклинаний 15 · Атака +7 · Скорость 30 фт. · Инициатива +2', 'the empty template is filled');
});

test('spell texts get the DC wherever an ability names it; weapons and other words are left alone', () => {
  const counts = zero();
  assert.equal(fillText('Мудрость СЛ 14. Провал: 3d6; спасбросок Мудрости СЛ 13. Атака +5, КД 18 у врага', false, stats(), counts),
    'Мудрость СЛ 15. Провал: 3d6; спасбросок Мудрости СЛ 15. Атака +5, КД 18 у врага');
  assert.equal(counts.dc, 2);
  assert.equal(fillText('СЛ 10 на концентрацию; ПКД 3; Скорости 20', true, stats(), zero()), 'СЛ 10 на концентрацию; ПКД 3; Скорости 20');
});

test('formatted text: tags and &nbsp; between the label and the number', () => {
  assert.equal(fillText('<p><strong>КД</strong>&nbsp;15 · Мудрость <em>СЛ</em> 14</p>', true, stats(), zero()),
    '<p><strong>КД</strong>&nbsp;12 · Мудрость <em>СЛ</em> 15</p>');
});

test('no spellcasting ability: DC and attack are not touched; typed numbers are used', () => {
  assert.equal(fillText('СЛ магии 14 · Атака +6', true, stats(false), zero()), 'СЛ магии 14 · Атака +6');
  const item = newCharacter('c');
  setFixed(item, 'ac', 16);
  assert.equal(fillText('КД 10', true, characterStats(characterOf(item)), zero()), 'КД 16');
});

test('the layout: both copies of a text are written, counted once, other kinds untouched', () => {
  const items = /** @type {any[]} */ ([
    {id: 'h', kind: 'header', detail: 'КД 15', detailHtml: '<p>КД 15</p>'},
    {id: 'a', kind: 'card', detail: 'Мудрость СЛ 14', title: 'Атака +5'},
    {id: 'r', kind: 'resources', text: 'КД 1'},
    newCharacter('c'),
  ]);
  const counts = fillSheet(items, stats());
  assert.equal(items[0].detail, 'КД 12');
  assert.equal(items[0].detailHtml, '<p>КД 12</p>');
  assert.equal(items[1].detail, 'Мудрость СЛ 15');
  assert.equal(items[1].title, 'Атака +5', 'a card’s attack is a weapon');
  assert.equal(items[2].text, 'КД 1');
  assert.deepEqual(counts, {ac: 1, attack: 0, init: 0, speed: 0, dc: 1});
  assert.match(fillReport(counts), /КД — 1, СЛ — 1/);
  assert.match(fillReport(zero()), /совпадает/);
});
