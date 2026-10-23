import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocked, lockState, setLockedFlag } from '../src/editor/lock.js';
import { normalizeLayout } from '../src/editor/layout.js';

const item=(id,extra={})=>({id,kind:'card',page:1,x:0,y:0,w:10,h:10,...extra});

test('lock state of a selection',()=>{
  assert.equal(lockState([]),'none');
  assert.equal(lockState([undefined]),'none','missing objects do not count');
  assert.equal(lockState([item('a'),item('b')]),'none');
  assert.equal(lockState([item('a',{locked:true}),item('b')]),'some');
  assert.equal(lockState([item('a',{locked:true}),item('b',{locked:true}),undefined]),'all');
  assert.equal(isLocked(undefined),false);
  assert.equal(isLocked(item('a',{locked:false})),false);
});

test('unlocking removes the field, so the layout stays as before 3.11',()=>{
  const list=[item('a'),item('b',{locked:true})];
  setLockedFlag(list,true);
  assert.deepEqual(list.map(x=>x.locked),[true,true]);
  setLockedFlag(list,false);
  assert.ok(list.every(x=>!('locked' in x)));
  assert.deepEqual(list,[item('a'),item('b')]);
});

test('a locked object survives import unchanged',()=>{
  const {items}=normalizeLayout([item('a',{locked:true}),item('b')]);
  assert.equal(items[0].locked,true);
  assert.ok(!('locked' in items[1]));
});
