import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaver, localStorageBackend, openStorage, metaOf, LS_PREFIX, LS_INDEX } from '../src/editor/storage.js';

// A Storage-like object; `limit` (characters) simulates the browser quota.
function fakeStorage(limit = Infinity) {
  const data = new Map();
  return {
    data,
    getItem: k => data.has(k) ? data.get(k) : null,
    setItem(k, v) {
      const size = [...data].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0) + String(v).length;
      if (size > limit) throw Object.assign(Error('quota'), {name: 'QuotaExceededError'});
      data.set(k, String(v));
    },
    removeItem: k => { data.delete(k); },
    get length() { return data.size; }, key: i => [...data.keys()][i] ?? null, clear: () => data.clear()
  };
}

// A backend whose writes finish only when the test says so.
function slowBackend() {
  const writes = [], pending = [];
  return {
    writes, pending,
    backend: {
      kind: 'indexeddb', list: async () => [], load: async () => null, remove: async () => {},
      put(record) { writes.push(structuredClone(record)); return new Promise((resolve, reject) => pending.push({resolve, reject})); }
    }
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('requests made during a write collapse into one more write of the newest state', async () => {
  const slow = slowBackend(), states = [];
  let items = [{id: 'a', title: '1'}];
  const saver = createSaver({backend: slow.backend, describe: () => ({id: 'L', name: 'N', items}), onState: s => states.push(s), now: () => 'T'});
  saver.request();
  for (const t of ['2', '3', '4']) { items = [{id: 'a', title: t}]; saver.request(); }
  assert.equal(slow.writes.length, 1, 'only one write in flight');
  assert.equal(slow.writes[0].items[0].title, '1');
  slow.pending.shift().resolve(); await tick();
  assert.equal(slow.writes.length, 2, 'one follow-up write, not three');
  assert.equal(slow.writes[1].items[0].title, '4');
  assert.deepEqual(slow.writes[1], {id: 'L', name: 'N', items: [{id: 'a', title: '4'}], savedAt: 'T'});
  slow.pending.shift().resolve(); await tick();
  assert.deepEqual(states, ['saving', 'saved']);
  assert.equal(saver.state, 'saved');
});

test('flush waits for pending writes and reports failure, then recovery', async () => {
  const slow = slowBackend(), states = [];
  const saver = createSaver({backend: slow.backend, describe: () => ({id: 'L', name: '', items: []}), onState: s => states.push(s)});
  saver.request();
  let flushed = null;
  saver.flush().then(ok => { flushed = ok; });
  await tick();
  assert.equal(flushed, null, 'flush must wait for the write');
  slow.pending.shift().reject(Error('quota')); await tick();
  assert.equal(flushed, false);
  assert.equal(saver.state, 'error');
  saver.request();
  slow.pending.shift().resolve(); await tick();
  assert.equal(await saver.flush(), true);
  assert.deepEqual(states, ['saving', 'error', 'saving', 'saved']);
});

test('flush with nothing pending resolves at once', async () => {
  const saver = createSaver({backend: slowBackend().backend, describe: () => ({id: 'L', name: '', items: []})});
  assert.equal(await saver.flush(), true);
});

test('localStorage backend keeps records and an index, and reports the quota', async () => {
  const storage = fakeStorage(3000);
  const backend = localStorageBackend(storage);
  await backend.put({id: 'one', name: 'Первый', savedAt: 'T1', items: [{id: 'a', kind: 'card', page: 1, x: 0, y: 0, w: 1, h: 1}]});
  await backend.put({id: 'two', name: 'Второй', savedAt: 'T2', items: []});
  await backend.put({id: 'one', name: 'Первый', savedAt: 'T3', items: []});
  assert.deepEqual((await backend.list()).map(m => [m.id, m.savedAt]), [['two', 'T2'], ['one', 'T3']]);
  assert.equal((await backend.load('two')).name, 'Второй');
  assert.equal(await backend.load('none'), null);
  await assert.rejects(backend.put({id: 'big', name: '', savedAt: 'T', items: [{id: 'p', kind: 'image', page: 1, x: 0, y: 0, w: 1, h: 1, src: 'x'.repeat(5000)}]}), /quota/);
  assert.equal(await backend.load('big'), null, 'a failed write leaves nothing behind');
  await backend.remove('two');
  assert.deepEqual((await backend.list()).map(m => m.id), ['one']);
  assert.equal(storage.getItem(LS_PREFIX + 'two'), null);
});

test('a broken localStorage entry comes back as raw text for the damaged-save notice', async () => {
  const storage = fakeStorage();
  storage.setItem(LS_PREFIX + 'x', '{not json');
  assert.deepEqual(await localStorageBackend(storage).load('x'), {id: 'x', name: '', savedAt: '', items: '{not json'});
  storage.setItem(LS_INDEX, 'garbage');
  assert.deepEqual(await localStorageBackend(storage).list(), []);
});

test('openStorage falls back to localStorage when IndexedDB fails or is not wanted', async () => {
  const failing = {open() { const request = {}; setTimeout(() => { request.error = Error('denied'); request.onerror?.(); }); return request; }};
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal((await openStorage({indexedDB: failing, localStorage: fakeStorage()})).kind, 'localstorage');
    assert.equal((await openStorage({indexedDB: {open() { return {}; }}, localStorage: fakeStorage(), timeoutMs: 20})).kind, 'localstorage', 'a database that never answers');
  } finally { console.warn = warn; }
  assert.equal((await openStorage({prefer: 'local', indexedDB: failing, localStorage: fakeStorage()})).kind, 'localstorage');
  const none = await openStorage({indexedDB: null, localStorage: fakeStorage(0)});
  assert.equal(none.kind, 'none');
  await assert.rejects(none.put({id: 'a', name: '', savedAt: '', items: []}), /ничего сохранять/);
});

test('meta summarises a layout without its pictures', () => {
  const meta = metaOf({id: 'L', name: 'N', savedAt: 'T', items: [
    {id: 'a', kind: 'image', page: 1, x: 0, y: 0, w: 1, h: 1, src: 'x'.repeat(1000)},
    {id: 'b', kind: 'card', page: 1, x: 0, y: 0, w: 1, h: 1, bgImage: 'y'.repeat(500)}]});
  assert.deepEqual({...meta, bytes: undefined}, {id: 'L', name: 'N', savedAt: 'T', count: 2, bytes: undefined});
  assert.ok(meta.bytes >= 1500 && meta.bytes < 3000, String(meta.bytes));
});
