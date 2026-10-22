import test from 'node:test';
import assert from 'node:assert/strict';
import { bbox, resizeBox, scaleBoxes, marqueeHits, rectFromPoints } from '../src/editor/geometry.js';

const near=(a,b)=>Object.keys(b).every(k=>Math.abs(a[k]-b[k])<1e-9)||assert.fail(JSON.stringify(a)+' != '+JSON.stringify(b));
const box={x:50,y:60,w:40,h:20};

test('east/south handles grow right and down, west/north keep the opposite edge',()=>{
  near(resizeBox(box,[1,1],10,5),{x:50,y:60,w:50,h:25});
  near(resizeBox(box,[-1,0],-10,99),{x:40,y:60,w:50,h:20});
  near(resizeBox(box,[0,-1],99,5),{x:50,y:65,w:40,h:15});
});

test('minimum size and page edges clamp the moving side only',()=>{
  near(resizeBox(box,[1,1],-100,-100),{x:50,y:60,w:12,h:6});
  near(resizeBox(box,[-1,-1],100,100),{x:78,y:74,w:12,h:6});
  near(resizeBox(box,[1,0],500,0),{x:50,y:60,w:160,h:20});
  near(resizeBox(box,[-1,-1],-500,-500),{x:0,y:0,w:90,h:80});
});

test('Shift on a corner keeps the aspect ratio, also when clamped',()=>{
  near(resizeBox(box,[1,1],40,0,{keepRatio:true}),{x:50,y:60,w:80,h:40});
  const r=resizeBox(box,[1,1],1000,0,{keepRatio:true});
  assert.ok(Math.abs(r.w/r.h-2)<1e-9 && r.x+r.w<=210+1e-9);
});

test('group boxes scale proportionally inside the resized frame',()=>{
  const boxes=[{x:10,y:10,w:10,h:10},{x:30,y:20,w:10,h:20}];
  const from=bbox(boxes);
  near(from,{x:10,y:10,w:30,h:30});
  const to=resizeBox(from,[1,1],30,30,{min:{w:1,h:1}});
  const [a,b]=scaleBoxes(boxes,from,to);
  near(a,{x:10,y:10,w:20,h:20});
  near(b,{x:50,y:30,w:20,h:40});
});

test('marquee selects boxes it covers by at least 12 % of their area',()=>{
  const boxes=[{id:1,x:0,y:0,w:10,h:10},{id:2,x:9,y:9,w:10,h:10},{id:3,x:50,y:50,w:5,h:5}];
  // Box 2 overlaps 3×3 = 9 % with the first marquee, 4×4 = 16 % with the second.
  assert.deepEqual(marqueeHits(rectFromPoints([12,12],[-5,-5]),boxes).map(b=>b.id),[1]);
  assert.deepEqual(marqueeHits(rectFromPoints([13,13],[-5,-5]),boxes).map(b=>b.id),[1,2]);
});
