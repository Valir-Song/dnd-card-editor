import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeLayout, wrapLayout, unwrapLayout, FORMAT_VERSION, FORMAT_MARK, MIGRATIONS } from '../src/editor/layout.js';
import { savedData } from '../src/editor/startup.js';
import { createHistory } from '../src/editor/history.js';

const card=extra=>({id:'c1',kind:'card',page:1,x:10,y:10,w:90,h:20,title:'Приказ',...extra});
let counter=0;
const makeId=()=>'gen'+(++counter);

test('starter layout is accepted unchanged',()=>{
  const starter=JSON.parse(readFileSync('src/starter-layout.json','utf8'));
  const {items,errors}=normalizeLayout(starter);
  assert.deepEqual(errors,[]);
  assert.equal(items.length,starter.length);
  assert.deepEqual(items.map(x=>x.id),starter.map(x=>x.id));
});

test('non-array data and undrawable objects are rejected with readable errors',()=>{
  assert.equal(normalizeLayout({}).items,null);
  for(const bad of [card({page:21}),card({page:0}),card({page:1.5}),card({kind:'spell'}),card({x:'10'}),card({w:0}),null,[]]){
    const {items,errors}=normalizeLayout([bad]);
    assert.equal(items,null,JSON.stringify(bad));
    assert.ok(errors.length>0&&errors.every(e=>/^Объект №1/.test(e)),errors.join());
  }
  const {errors}=normalizeLayout([card({page:21})]);
  assert.match(errors[0],/страница 21/);
  assert.match(errors[0],/не больше 20/);
  // 4.2: up to 20 pages.
  assert.ok(normalizeLayout([card({page:3}),card({page:20})]).items);
});

test('error list is capped for large broken files',()=>{
  const {errors}=normalizeLayout(Array.from({length:20},()=>card({page:99})));
  assert.equal(errors.length,6);
  assert.match(errors.at(-1),/ещё ошибок: 15/);
});

test('missing page, z and id are repaired; duplicate ids become unique',()=>{
  const {items,errors}=normalizeLayout([card({page:undefined,z:undefined}),card(),card({id:''})],{makeId});
  assert.deepEqual(errors,[]);
  assert.equal(items[0].page,1);
  assert.equal(items[0].z,1);
  assert.equal(items[0].id,'c1');
  assert.equal(new Set(items.map(x=>x.id)).size,3);
});

test('input objects are not mutated',()=>{
  const source=[card({page:undefined})];
  normalizeLayout(source,{makeId});
  assert.equal(source[0].page,undefined);
});

test('format: a bare array is version 1, the wrapper names its version; both open',()=>{
  assert.deepEqual(unwrapLayout([card()]),{list:[card()],version:1});
  const wrapped=wrapLayout([card()],{name:'Бард'});
  assert.equal(wrapped.format,FORMAT_MARK);
  assert.equal(wrapped.formatVersion,FORMAT_VERSION);
  assert.equal(wrapped.name,'Бард');
  assert.deepEqual(normalizeLayout(wrapped).items,[card({z:1})]);
  assert.deepEqual(normalizeLayout(JSON.parse(JSON.stringify(wrapped))).items,normalizeLayout([card()]).items,'a downloaded JSON file reads back');
  // The mark is for people; the version and the items decide.
  assert.deepEqual(normalizeLayout({formatVersion:FORMAT_VERSION,items:[card()]}).items,[card({z:1})]);
});

test('format: a newer, broken or missing version is refused with a readable error',()=>{
  const newer=normalizeLayout({formatVersion:FORMAT_VERSION+1,items:[card()]});
  assert.equal(newer.items,null);
  assert.match(newer.errors[0],/более новой версией редактора/);
  for(const version of [0,1.5,-1,'2',null])
    assert.equal(normalizeLayout({formatVersion:version,items:[card()]}).items,null,JSON.stringify(version));
  for(const bad of [{items:[card()]},{formatVersion:2},{formatVersion:2,items:'[]'},'text',null,5])
    assert.match(normalizeLayout(bad).errors[0],/массив объектов/,JSON.stringify(bad));
});

test('format: migrations run from the file version up to the current one, on copies',()=>{
  const steps=[];
  const migrations={1:item=>{steps.push('1→2:'+item.id);item.a=1;return true},2:item=>{steps.push('2→3:'+item.id);item.b=item.a?2:0;return false}};
  const source=[card()];
  const from1=normalizeLayout(source,{migrations,latest:3});
  assert.deepEqual(steps,['1→2:c1','2→3:c1'],'in order');
  assert.equal(from1.items[0].b,2,'the second step sees the first');
  assert.equal(from1.migrated,true);
  assert.ok(!('a' in source[0]),'the input is not changed');
  steps.length=0;
  const from2=normalizeLayout({formatVersion:2,items:[card()]},{migrations,latest:3});
  assert.deepEqual(steps,['2→3:c1'],'a version-2 file skips 1→2');
  assert.equal(from2.migrated,false,'nothing changed');
  steps.length=0;
  normalizeLayout({formatVersion:FORMAT_VERSION,items:[card()]},{migrations});
  assert.deepEqual(steps,[],'the current version is not migrated');
  // Migrations see only objects; the rest is rejected as before.
  assert.equal(normalizeLayout([null],{migrations,latest:3}).items,null);
});

test('format 1 → 2: the old top-right card badge becomes the default spot, a hand-placed one stays',()=>{
  const old=card({level:'1',badgeX:81.5,badgeY:1.1});
  assert.equal(MIGRATIONS[1]({...old}),true);
  const {items,migrated}=normalizeLayout([old,card({id:'c2',badgeX:81.5,badgeY:1.1,badgeCustomPosition:true}),card({id:'c3',badgeX:40,badgeY:1.1}),{...old,id:'n1',kind:'note'}]);
  assert.equal(migrated,true);
  assert.ok(!('badgeX' in items[0])&&!('badgeY' in items[0]),'moved to the default');
  assert.deepEqual([items[1].badgeX,items[2].badgeX,items[3].badgeX],[81.5,40,81.5],'hand-placed, elsewhere and not a card stay');
  assert.equal(old.badgeX,81.5,'the input is not changed');
  // A version-2 layout was already moved: an exact 81.5/1.1 there is the user's choice.
  const current=normalizeLayout(wrapLayout([old]));
  assert.equal(current.items[0].badgeX,81.5);
  assert.equal(current.migrated,false);
  assert.equal(normalizeLayout([card()]).migrated,false,'nothing to move');
});

test('format: browser records without a version are format 1',()=>{
  const items=[card({badgeX:81.5,badgeY:1.1})];
  assert.equal(savedData({id:'a',name:'',savedAt:'',items}),items);
  assert.deepEqual(savedData({id:'a',name:'',savedAt:'',formatVersion:2,items}),{formatVersion:2,items});
  assert.equal(normalizeLayout(savedData({id:'a',name:'',savedAt:'',items})).migrated,true);
  assert.equal(normalizeLayout(savedData({id:'a',name:'',savedAt:'',formatVersion:2,items})).migrated,false);
});

test('history reset discards checkpoints that point at replaced data',()=>{
  let doc=[{id:'broken'}];
  const history=createHistory({read:()=>doc,restore:v=>{doc=v}});
  doc=[{id:'template'}];
  history.reset();
  assert.equal(history.undo(),false);
  assert.equal(doc[0].id,'template');
});
