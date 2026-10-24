import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTLINES, applyOutline, outlineLook, outlinable, pageOutlinable } from '../src/editor/borders.js';
import { readFileSync } from 'node:fs';

const item=(id,kind,extra={})=>({id,kind,page:1,x:0,y:0,w:10,h:10,...extra});

test('a frame goes on cards, boxes, pictures and shapes, not on lines and text boxes',()=>{
  const list=[item('c','card'),item('i','image'),item('s','shape',{shape:'rect'}),item('l','shape',{shape:'line'}),item('t','textbox')];
  assert.equal(applyOutline(list,{style:'double'}),3);
  assert.deepEqual(list.map(x=>x.outline),['double','double','double',undefined,undefined]);
  assert.ok(pageOutlinable(item('n','note'))&&!pageOutlinable(item('h','header'))&&outlinable(item('h','header')));
});

test('a colour or width alone puts a solid frame on; «Без рамки» removes all three fields',()=>{
  const list=[item('a','card'),item('b','card',{outline:'dotted'})];
  applyOutline(list,{color:'#b23a3a'});
  assert.deepEqual(list.map(x=>[x.outline,x.outlineColor]),[['solid','#b23a3a'],['dotted','#b23a3a']]);
  applyOutline(list,{width:0.8});
  assert.equal(list[1].outlineWidth,0.8);
  applyOutline(list,{color:'',width:0});
  assert.ok(!('outlineColor' in list[0])&&!('outlineWidth' in list[1]),'back to the defaults');
  applyOutline(list,{style:''});
  assert.ok(list.every(x=>!('outline' in x)&&!('outlineColor' in x)&&!('outlineWidth' in x)));
});

test('the look ignores broken values from a hand-edited file',()=>{
  assert.equal(outlineLook(item('a','card')),null,'old layouts: no frame');
  assert.equal(outlineLook(item('a','card',{outline:'evil" onclick'})),null);
  assert.equal(outlineLook(item('l','shape',{shape:'line',outline:'solid'})),null);
  assert.deepEqual(outlineLook(item('a','card',{outline:'solid',outlineColor:'red;x',outlineWidth:'x'})),{className:'outline-solid',color:'',width:'0.5mm'});
  assert.deepEqual(outlineLook(item('a','card',{outline:'corners',outlineColor:'#B23A3A',outlineWidth:99})),{className:'outline-corners',color:'#B23A3A',width:'3mm'});
});

test('every frame style has its rule in styles.css',()=>{
  const css=readFileSync('src/styles.css','utf8');
  for(const {id} of OUTLINES.filter(o=>o.id&&o.id!=='solid')){
    assert.match(id,/^[a-z-]+$/,'style ids become class names');
    assert.ok(css.includes('.el.outline-'+id+'::after{'),'no rule for '+id);
  }
});
