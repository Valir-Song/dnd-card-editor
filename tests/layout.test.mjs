import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeLayout } from '../src/editor/layout.js';
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
  for(const bad of [card({page:3}),card({page:0}),card({kind:'spell'}),card({x:'10'}),card({w:0}),null,[]]){
    const {items,errors}=normalizeLayout([bad]);
    assert.equal(items,null,JSON.stringify(bad));
    assert.ok(errors.length>0&&errors.every(e=>/^Объект №1/.test(e)),errors.join());
  }
  const {errors}=normalizeLayout([card({page:3})]);
  assert.match(errors[0],/страница 3/);
});

test('error list is capped for large broken files',()=>{
  const {errors}=normalizeLayout(Array.from({length:20},()=>card({page:9})));
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

test('history reset discards checkpoints that point at replaced data',()=>{
  let doc=[{id:'broken'}];
  const history=createHistory({read:()=>doc,restore:v=>{doc=v}});
  doc=[{id:'template'}];
  history.reset();
  assert.equal(history.undo(),false);
  assert.equal(doc[0].id,'template');
});
