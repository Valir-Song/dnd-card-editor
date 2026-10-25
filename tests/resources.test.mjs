import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePools, migrateResources, poolsOf, addPool, changeCount, toggleCell, cycleRest, switchColumn, removePool, takeRest, MAX_CELLS } from '../src/editor/resources.js';
import { normalizeLayout, FORMAT_VERSION } from '../src/editor/layout.js';

const box = (extra = {}) => ({id: 'r', kind: 'resources', page: 1, x: 0, y: 0, w: 80, h: 30, ...extra});
const richard = 'Вдохновение (d8): □ □ □        Лютня: □ □ □ □ □ □ □ □\nЯчейки 1: □ □ □ □                   Чарующая магия: □\nЯчейки 2: □ □ □                      Ореол величия: □\nЯчейки 3: □ □ □                      Телепат: □';

test('the template text with typed boxes becomes rows in two columns', () => {
  const {pools, rest} = parsePools(richard);
  assert.equal(rest, '');
  assert.deepEqual(pools.map(p => [p.label, p.count, p.col]), [
    ['Вдохновение (d8)', 3, 0], ['Лютня', 8, 1],
    ['1 круг', 4, 0], ['Чарующая магия', 1, 1],
    ['2 круг', 3, 0], ['Ореол величия', 1, 1],
    ['3 круг', 3, 0], ['Телепат', 1, 1]
  ]);
  assert.ok(pools.every(p => p.used === 0 && p.rest === 'long'));
});

test('filled boxes are spent; text that is not a row stays as text', () => {
  const {pools, rest} = parsePools('Заметка про отдых\nКи: ■ ■ □ □   и ещё слова');
  assert.deepEqual(pools, [{label: 'Ки', count: 4, used: 2, rest: 'long', col: 0}]);
  assert.equal(rest, 'Заметка про отдых\nи ещё слова');
});

test('format 2 → 3: only resources with rows change; the formatted copy of the text goes', () => {
  const old = box({title: 'РЕСУРСЫ', detail: richard, detailHtml: '<p>…</p>'});
  const result = normalizeLayout({formatVersion: 2, items: [old]});
  assert.equal(FORMAT_VERSION, 3);
  assert.equal(result.migrated, true);
  const item = result.items?.[0];
  assert.ok(item && item.pools?.length === 8 && !('detail' in item) && !('detailHtml' in item) && item.title === 'РЕСУРСЫ');
  assert.equal(old.detail, richard, 'the input is not changed');
  // Plain text, other kinds and boxes that already have rows are left alone.
  for (const item of [box({detail: 'Просто текст'}), {...box({detail: richard}), kind: 'note'}, box({detail: richard, pools: []})])
    assert.equal(migrateResources({...item}), false, JSON.stringify(item).slice(0, 60));
  assert.equal(normalizeLayout({formatVersion: 3, items: [box({detail: richard})]}).migrated, false, 'format 3 is not migrated again');
});

test('a click fills up to the box, a click on a filled one empties from it', () => {
  const item = box({pools: [{label: '1 круг', count: 4, used: 0, rest: 'long', col: 0}]});
  toggleCell(item, 0, 2); assert.equal(item.pools?.[0].used, 3);
  toggleCell(item, 0, 0); assert.equal(item.pools?.[0].used, 0);
  toggleCell(item, 0, 0); assert.equal(item.pools?.[0].used, 1);
  changeCount(item, 0, -4); assert.deepEqual([item.pools?.[0].count, item.pools?.[0].used], [0, 0]);
  changeCount(item, 0, 99); assert.equal(item.pools?.[0].count, MAX_CELLS);
});

test('new rows: the next circle on the left after the circles, a resource on the right', () => {
  const item = box({pools: [{label: '1 круг', count: 2, used: 0, rest: 'long', col: 0}, {label: 'Лютня', count: 1, used: 0, rest: 'short', col: 1}]});
  assert.equal(addPool(item, 'spell'), 1);
  assert.equal(addPool(item, 'extra'), 3);
  assert.deepEqual(item.pools?.map(p => [p.label, p.col]), [['1 круг', 0], ['2 круг', 0], ['Лютня', 1], ['Ресурс', 1]]);
  assert.equal(addPool(box(), 'spell'), 0, 'an empty box starts with 1 круг');
  cycleRest(item, 2); assert.equal(item.pools?.[2].rest, 'none');
  cycleRest(item, 2); assert.equal(item.pools?.[2].rest, 'long');
  switchColumn(item, 0); assert.equal(item.pools?.[0].col, 1);
  removePool(item, 0); assert.equal(item.pools?.length, 3);
  const one = box({pools: [{label: 'x', count: 1, used: 0, rest: 'long', col: 0}]});
  removePool(one, 0); assert.ok(!('pools' in one), 'no rows left — no field');
});

test('a short rest brings back КО rows, a long one КО and ДО, never «без отдыха»', () => {
  const rows = () => [
    {label: 'a', count: 3, used: 3, rest: 'short', col: 0}, {label: 'b', count: 2, used: 2, rest: 'long', col: 0},
    {label: 'c', count: 1, used: 1, rest: 'none', col: 1}];
  const items = [box({pools: rows()}), box({id: 's', pools: rows()}), {...box({id: 'n'}), kind: 'note'}];
  assert.deepEqual(takeRest(items, 'short').map(i => i.id), ['r', 's']);
  assert.deepEqual(items[0].pools?.map(p => p.used), [0, 2, 1]);
  assert.deepEqual(takeRest(items, 'long').map(i => i.id), ['r', 's']);
  assert.deepEqual(items[0].pools?.map(p => p.used), [0, 0, 1]);
  assert.deepEqual(takeRest(items, 'long'), [], 'nothing spent — nothing changes');
});

test('rows from a hand-edited file are repaired for drawing', () => {
  const item = box({pools: [null, {label: 5, count: '3', used: 9, rest: 'weekly', col: 7}]});
  assert.deepEqual(poolsOf(/** @type {any} */ (item)), [{label: '5', count: 3, used: 3, rest: 'long', col: 0}]);
});

test('the template is migrated by the same step (no hand-typed boxes left after loading)', () => {
  const template = JSON.parse(readFileSync(new URL('../src/starter-layout.json', import.meta.url), 'utf8'));
  const result = normalizeLayout(template);
  assert.ok(result.items);
  for (const item of result.items.filter(i => i.kind === 'resources'))
    assert.ok(!/[□■]/.test(item.detail ?? ''), item.id);
});
