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

test('the clipboard names the format version: older copies are migrated, newer refused', () => {
  assert.equal(JSON.parse(encodeClip([card])).formatVersion, 2);
  const old = {...card, badgeX: 81.5, badgeY: 1.1};
  const fromOld = decodeClip(JSON.stringify({kind: 'dnd-card-editor/objects', version: 1, items: [old]}));
  assert.ok(fromOld && !('badgeX' in fromOld[0]), 'a copy from 3.11.0 beta.12 is format 1');
  assert.equal(decodeClip(JSON.stringify({kind: 'dnd-card-editor/objects', version: 1, formatVersion: 99, items: [card]})), null);
});
