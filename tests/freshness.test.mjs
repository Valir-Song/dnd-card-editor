import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseStartupLayout, formatStamp } from '../src/editor/freshness.js';

const a=[{id:'a'}],b=[{id:'b'}];
const pick=(o)=>chooseStartupLayout({storedItems:a,embeddedItems:b,...o});

test('no browser save opens the file',()=>{
  assert.deepEqual(chooseStartupLayout({storedItems:null,embeddedItems:b}),{source:'file',conflict:false});
});
test('identical layouts open quietly',()=>{
  assert.deepEqual(pick({embeddedItems:a,embeddedAt:'2026-10-22T10:00:00Z'}),{source:'browser',conflict:false});
});
test('release/template files without an export time keep the browser save',()=>{
  assert.deepEqual(pick({storedAt:'2026-10-22T10:00:00Z'}),{source:'browser',conflict:false});
});
test('the newer of file and browser save wins, with a conflict notice',()=>{
  assert.deepEqual(pick({embeddedAt:'2026-10-22T11:00:00Z',storedAt:'2026-10-22T10:00:00Z'}),{source:'file',conflict:true});
  assert.deepEqual(pick({embeddedAt:'2026-10-22T09:00:00Z',storedAt:'2026-10-22T10:00:00Z'}),{source:'browser',conflict:true});
});
test('an undated browser save (before 3.3.2) loses to a dated file',()=>{
  assert.deepEqual(pick({embeddedAt:'2026-10-22T11:00:00Z',storedAt:null}),{source:'file',conflict:true});
});
test('stamps format in Russian and tolerate garbage',()=>{
  assert.match(formatStamp('2026-10-22T11:00:00Z'),/22\.10\.2026/);
  assert.equal(formatStamp('nope'),'дата неизвестна');
});
