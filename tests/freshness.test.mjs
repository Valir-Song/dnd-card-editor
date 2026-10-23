import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseStartupLayout, formatStamp, chooseLayout, hashText, layoutTitle, isCopy, fileBase } from '../src/editor/freshness.js';

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

const save=(id,savedAt)=>({id,name:id,savedAt,count:1,bytes:1});
const choose=o=>chooseLayout({fileId:null,fileAt:null,fileText:'[]',saves:[],newId:()=>'new',...o});

test('a file with its own id continues its own save, never another one',()=>{
  const saves=[save('A','2026-10-20T10:00:00Z'),save('B','2026-10-23T10:00:00Z')];
  assert.deepEqual(choose({fileId:'A',fileAt:'2026-10-19T10:00:00Z',saves}),{layoutId:'A',hasSave:true,newer:null});
  assert.deepEqual(choose({fileId:'C',fileAt:'2026-10-19T10:00:00Z',saves}),{layoutId:'C',hasSave:false,newer:null},
    'a newer save of another character is not suggested');
});

test('a clean editor file continues the most recently saved layout (copies never count)',()=>{
  const saves=[save('A','2026-10-20T10:00:00Z'),save('B','2026-10-23T10:00:00Z'),save('A:previous','2026-10-24T10:00:00Z')];
  assert.deepEqual(choose({saves}),{layoutId:'B',hasSave:true,newer:null});
  assert.deepEqual(choose({saves:[]}),{layoutId:'new',hasSave:false,newer:null});
});

test('a file exported by 3.3–3.8 gets a stable id from its content',()=>{
  const first=choose({fileAt:'2026-10-01T10:00:00Z',fileText:'[{"id":"x"}]'});
  const again=choose({fileAt:'2026-10-01T10:00:00Z',fileText:'[{"id":"x"}]'});
  const other=choose({fileAt:'2026-10-01T10:00:00Z',fileText:'[{"id":"y"}]'});
  assert.match(first.layoutId,/^f-[0-9a-f]{8}$/);
  assert.equal(first.layoutId,again.layoutId);
  assert.notEqual(first.layoutId,other.layoutId);
  assert.deepEqual(choose({fileAt:'2026-10-01T10:00:00Z',fileText:'[{"id":"x"}]',saves:[save(first.layoutId,'2026-10-02T10:00:00Z')]}),
    {layoutId:first.layoutId,hasSave:true,newer:null});
});

test('an old file without a save points to work saved after its export',()=>{
  const fileAt='2026-10-01T10:00:00Z',fileText='[]';
  const later=save('default','2026-10-05T10:00:00Z'),earlier=save('default','2026-09-01T10:00:00Z');
  assert.equal(choose({fileAt,fileText,saves:[later]}).newer,later);
  assert.equal(choose({fileAt,fileText,saves:[earlier]}).newer,null);
});

test('hash, copies and default names',()=>{
  assert.equal(hashText(''),'811c9dc5');
  assert.notEqual(hashText('ab'),hashText('ba'));
  assert.ok(isCopy('A:previous')&&!isCopy('A'));
  assert.equal(layoutTitle([{kind:'note'},{kind:'header',title:'  РИЧАРД   СЭДСОНГ '}]),'РИЧАРД СЭДСОНГ');
  assert.equal(layoutTitle([{kind:'card',title:'x'}]),'Макет без названия');
});

test('download names come from the layout name',()=>{
  assert.equal(fileBase('РИЧАРД СЭДСОНГ'),'РИЧАРД_СЭДСОНГ');
  assert.equal(fileBase('Бард: 6 ур. / «Очарование»'),'Бард_6_ур_Очарование');
  assert.equal(fileBase('Макет без названия'),'DND_Card_Editor');
  assert.equal(fileBase('///'),'DND_Card_Editor');
});
