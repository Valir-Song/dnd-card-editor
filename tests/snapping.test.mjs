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

// ---- equal gaps (3.11) ----
const A={x:10,y:30,w:40,h:20},B={x:60,y:30,w:40,h:20};   // a row with a 10 mm gap

test('a box next to a row takes the row\'s gap',async()=>{
  const {gapSnap}=await import('../src/editor/snapping.js');
  const right=gapSnap({x:108.8,y:31,w:40,h:20},[A,B],'x',1.6);
  assert.ok(Math.abs(right.offset-1.2)<1e-9&&right.gap===10,JSON.stringify(right));
  const left=gapSnap({x:-1,y:31,w:40,h:20},[{...A,x:50},{...B,x:100}],'x',1.6);
  assert.ok(Math.abs(left.offset-1)<1e-9&&left.gap===10,'to the left of the row too');
  assert.equal(gapSnap({x:105,y:31,w:40,h:20},[A,B],'x',1.6),null,'too far from 10 mm');
  assert.equal(gapSnap({x:108.8,y:60,w:40,h:20},[A,B],'x',1.6),null,'another row');
});

test('a box between two neighbours is centred',async()=>{
  const {gapSnap}=await import('../src/editor/snapping.js');
  const result=gapSnap({x:61,y:100,w:40,h:20},[{x:10,y:100,w:40,h:20},{x:110,y:100,w:40,h:20}],'x',1.6);
  assert.deepEqual(result,{offset:-1,gap:10});
});

test('columns work the same way, and a background under everything changes nothing',async()=>{
  const {gapSnap}=await import('../src/editor/snapping.js');
  const column=[{x:10,y:30,w:40,h:20},{x:10,y:55,w:40,h:20}];
  assert.deepEqual(gapSnap({x:12,y:79,w:40,h:20},column,'y',1.6),{offset:1,gap:5});
  const background={x:0,y:0,w:210,h:297};
  assert.deepEqual(gapSnap({x:12,y:79,w:40,h:20},[background,...column],'y',1.6),{offset:1,gap:5});
  // A small box inside a big one adds no false gap.
  const inner={x:20,y:32,w:10,h:5};
  assert.equal(gapSnap({x:128.8,y:31,w:40,h:20},[A,inner,B],'x',1.6),null,'30 mm (inner→B) is not a gap of the row');
  // A frame around the row keeps the row's gaps; a box outside it keeps the
  // same spacing from the frame, its nearest neighbour (never a false one).
  const frame={x:5,y:25,w:100,h:30};
  const outside=gapSnap({x:113.8,y:31,w:40,h:20},[frame,A,B],'x',1.6);
  assert.ok(outside&&Math.abs(outside.offset-1.2)<1e-9&&outside.gap===10,JSON.stringify(outside));
  const between=gapSnap({x:54,y:31,w:40,h:20},[frame,A,{...B,x:100}],'x',1.6);
  assert.deepEqual(between,{offset:1,gap:5},'inside the frame: centred between A and B');
});

test('marks show the box\'s own gap and the equal ones in its row',async()=>{
  const {gapMarks}=await import('../src/editor/snapping.js');
  const marks=gapMarks({x:110,y:30,w:40,h:20},[A,B],'x',10);
  assert.deepEqual(marks.map(m=>[m.from,m.to]),[[100,110],[50,60]]);
  assert.ok(marks.every(m=>m.axis==='x'&&m.at===40));
  assert.deepEqual(gapMarks({x:113,y:30,w:40,h:20},[A,B],'x',10),[],'no neighbour at that gap: nothing');
});

test('snapMove: the closer of a line and an equal gap wins; otherwise the grid',async()=>{
  const {snapMove}=await import('../src/editor/snapping.js');
  const box={x:150,y:30,w:40,h:20};
  const lines={x:[0,5,105,205,210,10,30,50,60,80,100],y:[0,5,148.5,292,297,30,40,50]};
  // Lands at 108.8: no line within 1.6 mm, the 10 mm gap is 1.2 mm away.
  const gap=snapMove(box,-41.2,0,lines,{threshold:1.6,others:[A,B]});
  assert.ok(Math.abs(box.x+gap.dx-110)<1e-9&&gap.guides.x===null,JSON.stringify(gap));
  assert.equal(gap.gaps.length,2);
  // Lands at 105.5: the sheet centre line (105) is closer than the gap.
  const line=snapMove(box,-44.5,0,lines,{threshold:1.6,others:[A,B]});
  assert.ok(Math.abs(box.x+line.dx-105)<1e-9&&line.guides.x===105&&!line.gaps.length,JSON.stringify(line));
  // Far from both: the grid.
  const grid=snapMove(box,-22.2,0,lines,{threshold:1.6,grid:5,others:[A,B]});
  assert.ok(Math.abs(box.x+grid.dx-130)<1e-9,JSON.stringify(grid));
  // Without `others` nothing changes for existing callers.
  const plain=snapMove(box,-41.2,0,lines,{threshold:1.6});
  assert.ok(Math.abs(box.x+plain.dx-108.8)<1e-9&&plain.gaps.length===0);
});
