import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHEETS, isSheet, sheetOf, setSheet, sheetLook } from '../src/editor/sheet.js';
import { normalizeLayout } from '../src/editor/layout.js';

let seq=0;
const makeId=()=>'s'+(++seq);
const card={id:'c',kind:'card',page:1,x:10,y:10,w:50,h:20,z:1};

test('a page background is created on first use and holds only what is set',()=>{
  const items=[structuredClone(card)];
  const sheet=setSheet(items,1,{sheet:'stone'},makeId);
  assert.equal(items.length,2);
  assert.deepEqual({...sheet,id:'x'},{id:'x',kind:'sheet',page:1,x:0,y:0,w:210,h:297,z:0,sheet:'stone'});
  assert.equal(sheetOf(items,1),sheet);
  assert.equal(sheetOf(items,2),undefined,'the other page keeps its own');
  setSheet(items,1,{src:'data:image/jpeg;base64,AAAA',opacity:60,fit:'contain'},makeId);
  assert.equal(items.filter(isSheet).length,1,'one background per page');
  assert.equal(sheet?.sheet,'stone','the picture goes over the ready background');
});

test('removing the picture drops its settings; an empty background disappears',()=>{
  const items=[structuredClone(card)];
  setSheet(items,2,{src:'data:image/png;base64,AAAA',opacity:40,fit:'fill'},makeId);
  const sheet=setSheet(items,2,{src:undefined,sheet:'night'},makeId);
  assert.ok(sheet&&!('src' in sheet)&&!('fit' in sheet)&&!('opacity' in sheet));
  assert.equal(setSheet(items,2,{sheet:''},makeId),undefined);
  assert.deepEqual(items,[card],'nothing is left behind');
});

test('«На оба листа» gives the other page the same look',()=>{
  const items=[];
  setSheet(items,1,{sheet:'wood',src:'data:image/jpeg;base64,BBBB',opacity:70},makeId);
  setSheet(items,2,{sheet:'night'},makeId);
  const copy=setSheet(items,2,sheetLook(sheetOf(items,1)),makeId);
  assert.deepEqual([copy?.sheet,copy?.src,copy?.opacity,'fit' in (copy||{})],['wood','data:image/jpeg;base64,BBBB',70,false]);
  setSheet(items,2,sheetLook(undefined),makeId);
  assert.equal(sheetOf(items,2),undefined,'a page without a background clears the other');
});

test('layouts with a page background load; old layouts are unchanged',()=>{
  const {items,errors}=normalizeLayout([card,{id:'bg',kind:'sheet',page:2,x:0,y:0,w:210,h:297,z:0,sheet:'sea'}]);
  assert.deepEqual(errors,[]);
  assert.equal(items?.[1].kind,'sheet');
});

test('every sheet background has its look in styles.css',()=>{
  const css=readFileSync('src/styles.css','utf8');
  assert.equal(SHEETS[0].id,'','the default parchment is no background object at all');
  for(const {id} of SHEETS.filter(s=>s.id)){
    assert.match(id,/^[a-z-]+$/);
    assert.ok(css.includes('.stage .page[data-sheet="'+id+'"]{'),'no look for '+id);
  }
});
