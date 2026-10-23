import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeClip, decodeClip } from '../src/editor/clipboard.js';

const card = {id: 'a', kind: 'card', page: 1, x: 10, y: 20, w: 50, h: 20, z: 3, title: 'Карта', bgImage: 'data:image/png;base64,AAAA'};

test('objects survive the clipboard round trip, pictures included', () => {
  assert.deepEqual(decodeClip(encodeClip([card])), [card]);
});

test('ordinary text and foreign JSON are not objects', () => {
  assert.equal(decodeClip('Магическая рука'), null);
  assert.equal(decodeClip('{"items":[{"id":"a"}]}'), null);
  assert.equal(decodeClip(''), null);
  assert.equal(decodeClip('{"kind":"dnd-card-editor/objects",'), null, 'cut-off text');
});

test('broken objects are refused, not pasted', () => {
  assert.equal(decodeClip(encodeClip([{...card, kind: 'dragon'}])), null);
  assert.equal(decodeClip(JSON.stringify({kind: 'dnd-card-editor/objects', version: 1, items: []})), null);
});
