import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync('dist/index.html','utf8');
assert.ok(html.includes('page1')&&html.includes('page2'));
assert.ok(html.includes('dnd-card-editor-v3'));
assert.ok(html.includes('ИМЯ ПЕРСОНАЖА'));
assert.ok(!html.includes('__STARTER_DATA__'));
assert.ok(!/<script[^>]+\bsrc=/.test(html));
assert.ok(!/<link[^>]+\brel=["']stylesheet["']/.test(html));
// The tab and shortcut icon is inside the file too.
assert.ok(/<link rel="icon"[^>]+href="data:image\/svg\+xml,/.test(html));
console.log('Standalone offline build validated');
