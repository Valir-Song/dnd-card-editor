import test from 'node:test';
import assert from 'node:assert/strict';
import { readLayoutFile, fileFormat } from '../src/editor/layout-file.js';
import { chooseLayout } from '../src/editor/freshness.js';
import { normalizeLayout, wrapLayout } from '../src/editor/layout.js';

const card = {id: 'c1', kind: 'card', page: 1, x: 10, y: 20, w: 80, h: 30, z: 1, title: 'Огонь'};

test('a .dnd file is the JSON download plus the layout id, and opens back as the same layout', () => {
  const text = JSON.stringify(wrapLayout([card], {id: 'm-abc', name: 'Ричард', editor: '3.11.0-beta.15', savedAt: '2026-10-25T10:00:00.000Z'}));
  const file = readLayoutFile(text);
  assert.ok(!('error' in file));
  assert.equal(file.id, 'm-abc');
  assert.equal(file.name, 'Ричард');
  assert.equal(file.savedAt, '2026-10-25T10:00:00.000Z');
  assert.equal(file.kind, 'layout');
  assert.deepEqual(normalizeLayout(file.data).items, [card]);
});

test('a JSON without an id (older download or bare array) starts a new layout', () => {
  const wrapped = readLayoutFile(JSON.stringify(wrapLayout([card], {name: 'x'})));
  const bare = readLayoutFile(JSON.stringify([card]));
  assert.ok(!('error' in wrapped) && !('error' in bare));
  assert.equal(wrapped.id, null);
  assert.equal(bare.id, null);
  assert.deepEqual(normalizeLayout(bare.data).items, [card]);
  // A copy's id ('…:previous') is never opened as a layout of its own.
  const copy = readLayoutFile(JSON.stringify({...wrapLayout([card]), id: 'm-1:previous', savedAt: 'not a date'}));
  assert.ok(!('error' in copy));
  assert.equal(copy.id, null);
  assert.equal(copy.savedAt, null);
});

test('text that is neither a layout JSON nor an editor HTML is refused', () => {
  assert.match(/** @type {{error: string}} */ (readLayoutFile('hello')).error, /не JSON и не HTML/);
  assert.match(/** @type {{error: string}} */ (readLayoutFile('<html><body>hi</body></html>')).error, /нет макета/);
  assert.match(/** @type {{error: string}} */ (readLayoutFile('<script id="initial" type="application/json">[oops</script>')).error, /повреждён/);
});

const html = (attrs, layout = JSON.stringify([card])) =>
  '<!doctype html>\n<html><head><script type="module">const a="</div>"</script></head><body><script id="initial" type="application/json"' + attrs + '>' + layout + '</script></body></html>';

test('a downloaded editor HTML opens its layout with the same id the file gets when opened from disk', () => {
  const file = readLayoutFile(html(' data-saved-at="2026-10-20T08:00:00.000Z" data-format-version="2" data-layout-id="m-xyz" data-layout-name="Ричард &amp; &quot;Ко&quot;"'));
  assert.ok(!('error' in file));
  assert.deepEqual({id: file.id, name: file.name, savedAt: file.savedAt, kind: file.kind},
    {id: 'm-xyz', name: 'Ричард & "Ко"', savedAt: '2026-10-20T08:00:00.000Z', kind: 'html'});
  assert.deepEqual(file.data, {formatVersion: 2, items: [card]});
  // 3.3–3.8 exports carry only the time: the id is the start-up one (chooseLayout).
  const layout = JSON.stringify([card]);
  const old = readLayoutFile(html(' data-saved-at="2026-01-02T03:04:05.000Z"', layout));
  assert.ok(!('error' in old));
  const startup = chooseLayout({fileId: null, fileAt: '2026-01-02T03:04:05.000Z', fileText: layout, saves: [], newId: () => 'new'});
  assert.equal(old.id, startup.layoutId);
  assert.deepEqual(old.data, {formatVersion: 1, items: [card]});
  // A clean editor (release or template) has no layout of its own: a new one.
  const clean = readLayoutFile(html(''));
  assert.ok(!('error' in clean));
  assert.equal(clean.id, null);
});

test('Ctrl+S writes the editor into .html files and the layout into everything else', () => {
  assert.equal(fileFormat('Ричард.html'), 'html');
  assert.equal(fileFormat('a.HTM'), 'html');
  assert.equal(fileFormat('Ричард.dnd'), 'layout');
  assert.equal(fileFormat('Ричард.json'), 'layout');
});
