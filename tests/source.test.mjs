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
test('committed standalone HTML is the current offline build',()=>{
  const version=JSON.parse(read('package.json')).version;
  assert.ok(html.includes('content="'+version+'" name="editor-version"'),'index.html editor-version must match package.json');
  const standalone=read('DND_Card_Editor_standalone.html');
  assert.ok(standalone.includes('content="'+version+'" name="editor-version"'),'Run `npm run standalone` after changing the version');
  assert.ok(!standalone.includes('__STARTER_DATA__'));
  assert.ok(!/<script[^>]+\bsrc=/.test(standalone));
});
test('every feature module is imported and v3 storage remains compatible',()=>{
  const js=read('src/editor.js');
  const others=modules.map(x=>read('src/editor/'+x)).join('\n');
  // Imported from editor.js directly or from another feature module.
  for(const x of modules)assert.ok(js.includes('./editor/'+x)||others.includes("'./"+x+"'"),x+' is not imported');
  assert.ok(js.includes('dnd-card-editor-v3'));
});
test('feature modules change the layout only through the store',()=>{
  for(const name of modules.filter(x=>x!=='store.js'&&x!=='history.js')){
    const src=read('src/editor/'+name);
    assert.doesNotMatch(src,/\b(persist|draw|setItems|markRendered|saveToStorage)\(|history\.commit/,name+' must use store.change/commit/shown');
  }
});
