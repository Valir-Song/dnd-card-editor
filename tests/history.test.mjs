import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistory} from '../src/editor/history.js';

function fixture(options={}){
  let doc=[{id:'e1',title:'original'}], tick=0;
  const events=[];
  const history=createHistory({read:()=>doc,restore:v=>{doc=v},onChange:v=>events.push(v),now:()=>tick,...options});
  return {history,events,doc:()=>doc,set:v=>{doc=v},time:ms=>{tick+=ms}};
}

test('undo and redo restore nested state without reference aliasing',()=>{
  const f=fixture();
  f.doc()[0].textFrames={title:{x:10}};
  f.history.commit();
  f.doc()[0].textFrames.title.x=20;
  f.history.commit();
  assert.equal(f.history.undo(),true);
  assert.equal(f.doc()[0].textFrames.title.x,10);
  assert.equal(f.history.undo(),true);
  assert.equal(f.doc()[0].textFrames,undefined);
  assert.equal(f.history.undo(),false);
  assert.equal(f.history.redo(),true);
  assert.equal(f.doc()[0].textFrames.title.x,10);
});

test('typing is coalesced until a distinct action or sufficient pause',()=>{
  const f=fixture();
  f.doc()[0].title='a';f.history.commit({group:'e1:title'});
  f.time(200);f.doc()[0].title='ab';f.history.commit({group:'e1:title'});
  f.history.undo();assert.equal(f.doc()[0].title,'original');
  f.history.redo();assert.equal(f.doc()[0].title,'ab');
  f.time(1000);f.doc()[0].title='abc';f.history.commit({group:'e1:title'});
  f.history.undo();assert.equal(f.doc()[0].title,'ab');
});

test('new edit after undo invalidates redo and no-op is ignored',()=>{
  const f=fixture();
  f.doc()[0].title='one';f.history.commit();
  f.doc()[0].title='two';f.history.commit();
  f.history.undo();assert.equal(f.doc()[0].title,'one');
  f.doc()[0].title='branch';f.history.commit();
  assert.equal(f.history.redo(),false);
  assert.equal(f.history.commit(),false);
  assert.equal(f.doc()[0].title,'branch');
});

test('checkpoint count and image-heavy memory budget are bounded',()=>{
  const f=fixture({limit:3,maxBytes:600});
  for(let i=0;i<20;i++){
    f.doc()[0].title='x'.repeat(i+10);
    f.history.commit();
  }
  let undone=0;
  while(f.history.undo())undone++;
  assert.ok(undone<=3 && undone>=1);
});

test('large pictures are stored once: many undo steps fit and restore exactly',()=>{
  const picture=n=>'data:image/png;base64,'+String(n).repeat(200000); // ~200 KB each
  const f=fixture({maxBytes:4*1024*1024}); // room for a few copies only
  f.set([{id:'e1',title:'t',bgImage:picture(1)},{id:'e2',src:picture(2)}]);
  f.history.reset();
  for(let i=0;i<30;i++){f.doc()[0].title='t'+i;f.history.commit()}
  let undone=0;
  while(f.history.undo())undone++;
  assert.equal(undone,30);
  assert.equal(f.doc()[0].title,'t');
  assert.equal(f.doc()[0].bgImage,picture(1));
  assert.equal(f.doc()[1].src,picture(2));
  while(f.history.redo());
  assert.equal(f.doc()[0].title,'t29');
});

test('pictures replaced long ago are released from the history pool',()=>{
  const picture=n=>'data:image/png;base64,'+String(n).repeat(100000);
  // Each picture is ~200 KB in memory; the budget holds about five of them.
  // Without releasing old ones the pool would fill it and leave a single undo.
  const f=fixture({maxBytes:1024*1024});
  for(let i=0;i<10;i++){f.doc()[0].bgImage=picture(i);f.history.commit()}
  let undone=0;
  while(f.history.undo())undone++;
  assert.ok(undone>=3,'undo steps kept: '+undone);
  assert.equal(f.doc()[0].bgImage,picture(9-undone));
});
