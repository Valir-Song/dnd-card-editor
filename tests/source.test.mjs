import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const read = path => readFileSync(path,'utf8');
const layout = JSON.parse(read('src/starter-layout.json'));
const html = read('index.html');
const modules = readdirSync('src/editor').filter(x=>x.endsWith('.js'));

test('layout is valid',()=>{
  assert.equal(layout.length,28);
  assert.equal(new Set(layout.map(x=>x.id)).size,28);
  for(const x of layout){assert.ok([1,2].includes(x.page));assert.ok(x.w>0&&x.h>0);}
});
test('all UI bindings refer to existing toolbar controls',()=>{
  const js=[read('src/editor.js'),...modules.map(x=>read('src/editor/'+x))].join('\n');
  const refs=[...js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(x=>x[1]);
  assert.deepEqual([...new Set(refs)].filter(x=>!html.includes('id="'+x+'"')),[]);
});
test('every feature module is imported and v3 storage remains compatible',()=>{
  const js=read('src/editor.js');
  for(const x of modules)assert.ok(js.includes('./editor/'+x));
  assert.ok(js.includes('dnd-card-editor-v3'));
});
