import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, applyTheme, themable } from '../src/editor/themes.js';
import { readFileSync } from 'node:fs';

const item=(id,kind,extra={})=>({id,kind,page:1,x:0,y:0,w:10,h:10,...extra});

test('a theme replaces the own background of cards and boxes only',()=>{
  const list=[item('c','card',{bg:'#9ebbff'}),item('n','note'),item('s','shape',{bg:'#d8c5ed'}),item('t','textbox',{bg:'#fff'})];
  assert.equal(applyTheme(list,'forest'),2);
  assert.deepEqual(list.map(x=>x.theme),['forest','forest',undefined,undefined]);
  assert.ok(!('bg' in list[0]),'the card colour gives way to the theme');
  assert.equal(list[2].bg,'#d8c5ed','shapes keep their colour');
  applyTheme(list,'');
  assert.ok(list.every(x=>!('theme' in x)),'«Без темы» removes the field');
});

test('every theme has its colours in styles.css',()=>{
  const css=readFileSync('src/styles.css','utf8');
  for(const {id} of THEMES.filter(t=>t.id)){
    assert.match(id,/^[a-z-]+$/,'theme ids become class names');
    assert.ok(css.includes('.el.theme-'+id+'{'),'no colours for '+id);
  }
  assert.ok(themable(item('h','header'))&&!themable(item('i','image')));
});
