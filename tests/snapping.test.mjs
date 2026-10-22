import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLines, snapAxis, snapMove, PAGE_LINES } from '../src/editor/snapping.js';

const items=[
  {id:'a',page:1,x:20,y:20,w:30,h:20},
  {id:'b',page:1,x:100,y:100,w:30,h:20},
  {id:'other',page:2,x:60,y:60,w:10,h:10}
];

test('lines come from other objects on the same page plus sheet guides',()=>{
  const lines=collectLines(items,1,new Set(['b']));
  assert.deepEqual(lines.x,[...PAGE_LINES.x,20,35,50]);
  assert.deepEqual(lines.y,[...PAGE_LINES.y,20,30,40]);
});

test('the nearest edge within the threshold wins',()=>{
  assert.deepEqual(snapAxis([21,36,51],[20,35,50],1.5),{offset:-1,line:20});
  assert.deepEqual(snapAxis([21.4],[20,22],1.5),{offset:0.6000000000000014,line:22});
  assert.deepEqual(snapAxis([30],[20],1.5),{offset:0,line:null});
});

test('without a nearby line the grid applies to the leading edge',()=>{
  const {offset,line}=snapAxis([62.2],[20],1.5,5);
  assert.equal(line,null);
  assert.ok(Math.abs(62.2+offset-60)<1e-9);
});

test('a moved box aligns to another object and reports guides',()=>{
  const lines=collectLines(items,1,new Set(['b']));
  const box=items[1];
  const result=snapMove(box,-79,-60.8,lines,{threshold:1.5});   // lands at x=21, y=39.2
  assert.equal(result.dx,-80);                                   // left edge on a's left (20)
  assert.ok(Math.abs(box.y+result.dy-40)<1e-9);                // top edge on a's bottom (40)
  assert.equal(result.guides.y,40);
  assert.equal(result.guides.x,20);
});

test('sheet frame and centre are snap targets',()=>{
  const lines=collectLines([],1,new Set());
  assert.equal(snapAxis([5.8],lines.x,1).line,5);
  assert.equal(snapAxis([148],lines.y,1).line,148.5);
});
