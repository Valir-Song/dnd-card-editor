import test from 'node:test';
import assert from 'node:assert/strict';
import { setPage, pageCount, keepPages, addPage, duplicatePage, removePage, movePage, moveToPage, objectsOn, MAX_PAGES } from '../src/editor/pages.js';

let seq = 0;
const makeId = () => 'n' + (++seq);
const card = (id, page, extra = {}) => ({id, kind: 'card', page, x: 10, y: 10, w: 50, h: 20, z: 1, ...extra});
const pagesOf = items => Object.fromEntries(items.map(item => [item.id, item.page]));

test('the page count is the highest page, at least 1, at most MAX_PAGES', () => {
  assert.equal(pageCount([]), 1);
  assert.equal(pageCount([card('a', 1), card('b', 2)]), 2);
  assert.equal(pageCount([card('a', 1), card('b', 4)]), 4);
  assert.equal(pageCount([card('a', undefined)]), 1, 'an object without a page is on page 1');
  assert.equal(MAX_PAGES, 20);
});

test('keepPages gives every empty page a plain sheet', () => {
  const items = [card('a', 1), card('c', 3)];
  keepPages(items, 3, makeId);
  assert.equal(items.length, 3);
  assert.deepEqual({...items[2], id: 'x'}, {id: 'x', kind: 'sheet', page: 2, x: 0, y: 0, w: 210, h: 297, z: 0});
  keepPages(items, 3, makeId);
  assert.equal(items.length, 3, 'nothing twice');
});

test('addPage inserts an empty page after the given one, with the background of the page before', () => {
  const items = [card('a', 1), card('b', 2), {id: 's1', kind: 'sheet', page: 1, x: 0, y: 0, w: 210, h: 297, z: 0, sheet: 'stone', src: 'data:x', fit: 'contain'}];
  assert.equal(addPage(items, 1, makeId), true);
  assert.equal(pageCount(items), 3);
  assert.equal(pagesOf(items).b, 3, 'the old page 2 moved down');
  const fresh = items.find(item => item.kind === 'sheet' && item.page === 2);
  assert.equal(fresh.sheet, 'stone'); assert.equal(fresh.src, 'data:x'); assert.equal(fresh.fit, 'contain');
  assert.equal(objectsOn(items, 2).length, 0);
  // At the end, after a page without a background: a plain sheet.
  assert.equal(addPage(items, 3, makeId), true);
  const last = items.find(item => item.page === 4);
  assert.equal(last.kind, 'sheet'); assert.equal(last.sheet, undefined);
});

test('no more than MAX_PAGES', () => {
  const items = [card('a', MAX_PAGES)];
  assert.equal(addPage(items, 3, makeId), false);
  assert.equal(duplicatePage(items, 1, makeId), false);
  assert.equal(items.length, 1);
});

test('duplicatePage copies everything on the page right after it, with new ids', () => {
  const items = [card('a', 1, {locked: true, title: 'A'}), card('b', 2), {id: 's2', kind: 'sheet', page: 2, x: 0, y: 0, w: 210, h: 297, z: 0, sheet: 'wood'}];
  assert.equal(duplicatePage(items, 2, makeId), true);
  assert.equal(pageCount(items), 3);
  const copies = items.filter(item => item.page === 3);
  assert.equal(copies.length, 2);
  assert.ok(copies.every(item => !['b', 's2'].includes(item.id)));
  assert.equal(copies.find(item => item.kind === 'sheet').sheet, 'wood');
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  // A copy of page 1 goes in between; the copy keeps its lock and is not the same object.
  duplicatePage(items, 1, makeId);
  const copy = items.find(item => item.page === 2 && item.kind === 'card');
  assert.equal(copy.locked, true); assert.equal(copy.title, 'A');
  copy.title = 'B'; assert.equal(items.find(item => item.id === 'a').title, 'A');
  assert.equal(pagesOf(items).b, 3);
});

test('removePage drops a page and what is on it; later pages move up; one page always stays', () => {
  const items = [card('a', 1), card('b', 2), card('c', 3)];
  const left = removePage(items, 2, makeId);
  assert.deepEqual(pagesOf(left), {a: 1, c: 2});
  assert.equal(items.length, 3, 'the caller\'s list is untouched (undo keeps it)');
  assert.equal(removePage([card('a', 1)], 1, makeId), null);
  // An empty page that becomes the last one keeps standing.
  const gap = [card('a', 1), {id: 's', kind: 'sheet', page: 2, x: 0, y: 0, w: 210, h: 297, z: 0}, card('c', 3)];
  const after = removePage(gap, 3, makeId);
  assert.equal(pageCount(after), 2);
});

test('movePage swaps neighbours and refuses to leave the layout', () => {
  const items = [card('a', 1), card('b', 2), card('c', 3)];
  assert.equal(movePage(items, 3, -1), true);
  assert.deepEqual(pagesOf(items), {a: 1, b: 3, c: 2});
  assert.equal(movePage(items, 1, -1), false);
  assert.equal(movePage(items, 3, 1), false);
});

test('moveToPage moves unlocked objects on top of the target page; the page they leave stays', () => {
  const items = [card('a', 1, {z: 5}), card('b', 1, {z: 2, locked: true}), card('c', 2, {z: 7}), card('d', 1, {z: 1})];
  const moved = moveToPage(items, ['a', 'b', 'd'], 2, makeId);
  assert.deepEqual(moved, ['d', 'a'], 'lower layer first');
  assert.deepEqual(pagesOf(items), {a: 2, b: 1, c: 2, d: 2});
  assert.equal(items.find(item => item.id === 'd').z, 8);
  assert.equal(items.find(item => item.id === 'a').z, 9);
  assert.equal(items.find(item => item.id === 'a').x, 10, 'same place');
  const two = [card('a', 1), card('b', 2)];
  moveToPage(two, ['b'], 1, makeId);
  assert.equal(pageCount(two), 2, 'the emptied last page stays');
  assert.equal(two.find(item => item.page === 2).kind, 'sheet');
  assert.deepEqual(moveToPage(two, ['a'], 5, makeId), [], 'no such page');
});

test('a card that changes pages keeps its look: compact from page 1, roomy from the others', () => {
  const items = [card('a', 1), card('b', 2), {id: 'n', kind: 'note', page: 1, x: 0, y: 0, w: 10, h: 10}, card('c', 1, {cardLook: 'full'})];
  movePage(items, 1, 1);
  assert.deepEqual(items.map(item => [item.page, item.cardLook]), [[2, 'compact'], [1, 'full'], [2, undefined], [2, 'full']]);
  const copy = card('d', 1);
  setPage(copy, 1);
  assert.equal(copy.cardLook, undefined, 'staying put changes nothing');
  const twin = [card('e', 1)];
  duplicatePage(twin, 1, makeId);
  assert.deepEqual(twin.map(item => [item.page, item.cardLook]), [[1, undefined], [2, 'compact']]);
});
