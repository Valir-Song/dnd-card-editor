import test from 'node:test';
import assert from 'node:assert/strict';
import { hpOf, diceOf, savesOf, damage, heal, step, setHp, toggleDice, toggleSaves, setDice, toggleDie, toggleSave, hpRest, newHp, MAX_DICE } from '../src/editor/hp.js';
import { takeRest } from '../src/editor/resources.js';
import { normalizeLayout } from '../src/editor/layout.js';

const box = (extra = {}) => ({id: 'h', kind: 'hp', page: 1, x: 0, y: 0, w: 60, h: 30, hp: {now: 30, max: 39, temp: 5}, ...extra});

test('damage takes temporary hit points first and stops at 0', () => {
  const item = box();
  damage(item, 3);
  assert.deepEqual(item.hp, {now: 30, max: 39, temp: 2});
  damage(item, 12);
  assert.deepEqual(item.hp, {now: 20, max: 39, temp: 0});
  damage(item, 100);
  assert.equal(item.hp.now, 0);
});

test('healing stops at the maximum; back from 0 the death saves start over', () => {
  const item = box({hp: {now: 0, max: 39, temp: 0}, deathSaves: {ok: 2, fail: 1}});
  heal(item, 7);
  assert.equal(item.hp.now, 7);
  assert.deepEqual(item.deathSaves, {ok: 0, fail: 0});
  heal(item, 100);
  assert.equal(item.hp.now, 39);
  step(item, -1); assert.equal(item.hp.now, 38);
  step(item, 1); step(item, 1); assert.equal(item.hp.now, 39);
});

test('typed numbers: a new maximum carries a full current along, odd values are repaired', () => {
  const item = box({hp: {now: 10, max: 10, temp: 0}});
  setHp(item, 'max', 39);
  assert.deepEqual(item.hp, {now: 39, max: 39, temp: 0});
  setHp(item, 'max', 20);
  assert.equal(item.hp.now, 20, 'never above the maximum');
  setHp(item, 'now', 25);
  assert.equal(item.hp.now, 20);
  setHp(item, 'temp', -4);
  assert.equal(item.hp.temp, 0);
  assert.deepEqual(hpOf(box({hp: {now: 'x', max: 5.6}})), {now: 0, max: 6, temp: 0});
  assert.deepEqual(hpOf(box({hp: undefined})), {now: 0, max: 0, temp: 0});
});

test('hit dice: shown or hidden, boxes spent like resources, a size from d6 to d12', () => {
  const item = box();
  assert.equal(diceOf(item), null);
  toggleDice(item);
  assert.deepEqual(item.hitDice, {count: 1, die: 8, used: 0});
  setDice(item, {count: 5, die: 10});
  toggleDie(item, 2);
  assert.deepEqual(diceOf(item), {count: 5, die: 10, used: 3});
  toggleDie(item, 0);
  assert.equal(diceOf(item)?.used, 0);
  setDice(item, {count: 99, die: 7});
  assert.deepEqual(diceOf(item), {count: MAX_DICE, die: 8, used: 0});
  toggleDice(item);
  assert.equal(item.hitDice, undefined);
});

test('death saves: three of each, a click fills up to it or empties from it', () => {
  const item = box();
  toggleSaves(item, true);
  toggleSave(item, 'fail', 1);
  toggleSave(item, 'ok', 5);
  assert.deepEqual(savesOf(item), {ok: 3, fail: 2});
  toggleSave(item, 'fail', 0);
  assert.deepEqual(savesOf(item), {ok: 3, fail: 0});
  toggleSaves(item, false);
  assert.equal(savesOf(item), null);
});

test('a long rest: full hit points, no temporary, saves cleared, half the hit dice (at least one) back', () => {
  const item = box({hp: {now: 3, max: 39, temp: 4}, hitDice: {count: 5, die: 8, used: 5}, deathSaves: {ok: 1, fail: 2}});
  const one = box({id: 'one', hitDice: {count: 1, die: 8, used: 1}});
  assert.deepEqual(hpRest([item, one], 'short'), [], 'a short rest leaves hit points to the player');
  assert.equal(hpRest([item, one], 'long').length, 2);
  assert.deepEqual(item.hp, {now: 39, max: 39, temp: 0});
  assert.deepEqual(item.hitDice, {count: 5, die: 8, used: 3});
  assert.deepEqual(item.deathSaves, {ok: 0, fail: 0});
  assert.equal(one.hitDice?.used, 0);
  assert.deepEqual(hpRest([item], 'long').length, 1, 'still three dice spent');
  assert.deepEqual(hpRest([box({hp: {now: 39, max: 39, temp: 0}})], 'long'), [], 'nothing to bring back');
  // The resources rest leaves the box alone.
  assert.deepEqual(takeRest([box()], 'long'), []);
});

test('a new box opens and comes through the layout check', () => {
  const {items, errors} = normalizeLayout([{...newHp(), id: 'n', page: 1, x: 10, y: 10}]);
  assert.deepEqual(errors, []);
  assert.equal(items?.[0].kind, 'hp');
  assert.deepEqual(hpOf(items?.[0]), {now: 10, max: 10, temp: 0});
});
