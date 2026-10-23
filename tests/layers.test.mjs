import test from 'node:test';
import assert from 'node:assert/strict';
import { reorderLayers } from '../src/editor/layers.js';

const order=['a','b','c','d','e'];
const move=(chosen,mode)=>reorderLayers(order,new Set(chosen),mode).join('');

test('a single object moves one step or all the way',()=>{
  assert.equal(move(['b'],'front'),'acdeb');
  assert.equal(move(['d'],'back'),'dabce');
  assert.equal(move(['b'],'forward'),'acbde');
  assert.equal(move(['d'],'backward'),'abdce');
  assert.equal(move(['e'],'forward'),'abcde','the top one stays');
  assert.equal(move(['a'],'backward'),'abcde','the bottom one stays');
});

test('a group keeps its internal order',()=>{
  assert.equal(move(['b','d'],'front'),'acebd');
  assert.equal(move(['b','d'],'back'),'bdace');
  assert.equal(move(['b','d'],'forward'),'acbed');
  assert.equal(move(['b','d'],'backward'),'badce');
  assert.equal(move(['a','b'],'backward'),'abcde','a group already at the bottom stays');
  assert.equal(move(['d','e'],'forward'),'abcde','a group already on top stays');
});
