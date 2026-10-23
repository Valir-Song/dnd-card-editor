import test from 'node:test';
import assert from 'node:assert/strict';
import { arrange } from '../src/editor/align.js';
import { PAGE_FRAME } from '../src/editor/geometry.js';

const targets=(boxes,fixed=boxes.map(()=>false))=>({boxes,fixed,area:PAGE_FRAME});

test('one object aligns to the sheet frame, several to their own bounding box',()=>{
  assert.deepEqual(arrange(targets([{x:50,y:50,w:40,h:20}]),{align:'right'})[0].x,165);
  const two=targets([{x:30,y:100,w:60,h:20},{x:165,y:5,w:40,h:20}]);
  assert.deepEqual(arrange(two,{align:'left'}).map(b=>b.x),[30,30]);
});

test('a locked object counts as the edge to align to',()=>{
  // The locked one (first) is leftmost: the other comes to it; whether it is
  // written back is the caller's business (commit skips fixed boxes).
  const t=targets([{x:30,y:100,w:60,h:20},{x:165,y:5,w:40,h:20}],[true,false]);
  assert.deepEqual(arrange(t,{align:'left'}).map(b=>b.x),[30,30]);
});

test('distribution leaves locked objects out and needs three free ones',()=>{
  const boxes=[{x:0,y:0,w:10,h:10},{x:15,y:0,w:10,h:10},{x:100,y:0,w:10,h:10},{x:60,y:0,w:10,h:10}];
  assert.deepEqual(arrange(targets(boxes),{distribute:'x'}).map(b=>b.x),[0,33.33,100,66.67]);
  const next=arrange(targets(boxes,[false,false,false,true]),{distribute:'x'});
  assert.deepEqual(next.map(b=>b.x),[0,50,100,60],'the locked one stays and is not counted');
  assert.equal(arrange(targets(boxes,[false,true,false,true]),{distribute:'x'}),null);
});

test('one size takes the first selected object as the model',()=>{
  const boxes=[{x:10,y:10,w:91,h:23},{x:120,y:10,w:50,h:30}];
  assert.deepEqual(arrange(targets(boxes),{match:'w'}).map(b=>b.w),[91,90],'kept on the page');
  assert.deepEqual(arrange(targets(boxes),{match:'h'}).map(b=>b.h),[23,23]);
  assert.equal(arrange(targets([boxes[0]]),{match:'w'}),null);
});
