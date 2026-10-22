import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/editor/store.js';

function fixture({failRender = false} = {}) {
  let items = [{id: 'a', x: 1}];
  const log = [];
  const store = createStore({
    get: () => items, set: v => { items = v; },
    history: {commit: o => log.push(['history', o.group ?? null])},
    save: () => { log.push(['save']); return true; },
    render: () => { if (failRender) throw Error('boom'); log.push(['render']); },
    mark: item => log.push(['mark', item.id])
  });
  return {store, log, items: () => items};
}

test('change edits, then renders, records history and saves — in that order', () => {
  const f = fixture();
  assert.equal(f.store.change(items => { items[0].x = 5; }, {group: 'g'}), true);
  assert.equal(f.items()[0].x, 5);
  assert.deepEqual(f.log, [['render'], ['history', 'g'], ['save']]);
});

test('a returned array replaces the layout', () => {
  const f = fixture();
  f.store.change(items => items.filter(i => i.id !== 'a'));
  assert.deepEqual(f.items(), []);
});

test('commit redraws edits made directly (a finished gesture)', () => {
  const f = fixture();
  f.store.commit();
  assert.deepEqual(f.log, [['render'], ['history', null], ['save']]);
});

test('shown marks edits already on screen and skips the redraw', () => {
  const f = fixture();
  f.store.shown(f.items()[0], {group: 'text'});
  assert.deepEqual(f.log, [['mark', 'a'], ['history', 'text'], ['save']]);
});

test('a failed redraw records and saves nothing', () => {
  const f = fixture({failRender: true});
  assert.throws(() => f.store.change(items => { items[0].x = 9; }), /boom/);
  assert.deepEqual(f.log, []);
});

test('find and replace', () => {
  const f = fixture();
  assert.equal(f.store.find('a').x, 1);
  f.store.replace([{id: 'b'}]);
  assert.equal(f.store.find('b').id, 'b');
  assert.deepEqual(f.log, []);
});
