import test from 'node:test';
import assert from 'node:assert/strict';
import { createFileSave } from '../src/editor/save-file.js';

// A file on "disk": what it holds is replaced only when a write closes.
function fakeFile(name,{permission='granted',ask='granted',fail=null}={}){
  const file={name,content:'',writes:0,asked:0,aborted:0,
    queryPermission:async()=>permission,
    requestPermission:async()=>{file.asked++;return ask},
    createWritable:async()=>{let buffer='';return {
      write:async data=>{if(fail)throw fail;buffer+=data},
      close:async()=>{file.content=buffer;file.writes++},
      abort:async()=>{file.aborted++}
    }}};
  return file;
}
function memoryHandles(){
  const map=new Map();
  return {map,get:async id=>map.get(id),set:async(id,h)=>{map.set(id,h)},delete:async id=>{map.delete(id)}};
}
const error=(name,message='')=>Object.assign(new Error(message),{name});

test('the file is chosen once, then Ctrl+S writes into the same file',async()=>{
  const file=fakeFile('Ричард.html'),handles=memoryHandles(),picked=[];
  const saver=createFileSave({pick:async name=>{picked.push(name);return file},handles});
  let html='v1';
  const request={id:'m-1',fileName:'Ричард.html',content:()=>html};
  assert.deepEqual(await saver.save(request),{kind:'file',name:'Ричард.html'});
  assert.deepEqual(picked,['Ричард.html'],'the dialog suggests the layout name');
  html='v2';
  assert.deepEqual(await saver.save(request),{kind:'file',name:'Ричард.html'});
  assert.equal(picked.length,1,'no dialog the second time');
  assert.equal(file.content,'v2');
  assert.equal(handles.map.get('m-1'),file,'remembered for this layout');
});

test('«Сохранить как…» picks another file; another layout has its own file',async()=>{
  const first=fakeFile('a.html'),second=fakeFile('b.html'),third=fakeFile('c.html'),handles=memoryHandles();
  const queue=[first,second,third];
  const saver=createFileSave({pick:async()=>queue.shift(),handles});
  const request={id:'m-1',fileName:'a.html',content:()=>'x'};
  await saver.save(request);
  assert.deepEqual(await saver.save(request,{choose:true}),{kind:'file',name:'b.html'});
  assert.equal(handles.map.get('m-1'),second);
  assert.deepEqual(await saver.save({id:'m-2',fileName:'c.html',content:()=>'y'}),{kind:'file',name:'c.html'});
  assert.equal(handles.map.get('m-1'),second);
});

test('a cancelled dialog saves nothing and remembers nothing',async()=>{
  const handles=memoryHandles();
  let saver=createFileSave({pick:async()=>{throw error('AbortError')},handles});
  assert.deepEqual(await saver.save({id:'m-1',fileName:'a.html',content:()=>'x'}),{kind:'cancel'});
  saver=createFileSave({pick:async()=>null,handles});
  assert.deepEqual(await saver.save({id:'m-1',fileName:'a.html',content:()=>'x'}),{kind:'cancel'});
  assert.equal(handles.map.size,0);
  saver=createFileSave({pick:async()=>{throw error('SecurityError','no gesture')},handles});
  const result=await saver.save({id:'m-1',fileName:'a.html',content:()=>'x'});
  assert.equal(result.kind,'error');
});

test('after reopening, the browser asks for permission; refused — nothing written',async()=>{
  const handles=memoryHandles(),pick=async()=>assert.fail('no dialog while a file is remembered');
  const allowed=fakeFile('a.html',{permission:'prompt',ask:'granted'});
  handles.map.set('m-1',allowed);
  assert.deepEqual(await createFileSave({pick,handles}).save({id:'m-1',fileName:'a.html',content:()=>'x'}),{kind:'file',name:'a.html'});
  assert.equal(allowed.asked,1);
  const refused=fakeFile('b.html',{permission:'prompt',ask:'denied'});
  handles.map.set('m-1',refused);
  assert.deepEqual(await createFileSave({pick,handles}).save({id:'m-1',fileName:'b.html',content:()=>'x'}),{kind:'denied',name:'b.html'});
  assert.equal(refused.writes,0);
});

test('a failed write keeps the old file content; a vanished file is forgotten',async()=>{
  const handles=memoryHandles();
  const full=fakeFile('a.html',{fail:error('QuotaExceededError','disk full')});
  full.content='old';handles.map.set('m-1',full);
  const saver=createFileSave({pick:async()=>assert.fail(),handles});
  const result=await saver.save({id:'m-1',fileName:'a.html',content:()=>'new'});
  assert.equal(result.kind,'error');
  assert.equal(full.content,'old');
  assert.equal(full.aborted,1);
  assert.equal(handles.map.get('m-1'),full,'kept: the same file may work next time');
  const gone=fakeFile('b.html');gone.createWritable=async()=>{throw error('NotFoundError')};
  handles.map.set('m-1',gone);
  assert.equal((await saver.save({id:'m-1',fileName:'b.html',content:()=>'x'})).kind,'error');
  assert.equal(handles.map.has('m-1'),false);
});

test('Ctrl+S during a save saves once more afterwards, with the newest layout',async()=>{
  const file=fakeFile('a.html'),handles=memoryHandles();handles.map.set('m-1',file);
  let release;const gate=new Promise(resolve=>{release=resolve});
  const slow=file.createWritable;let calls=0;
  file.createWritable=async()=>{calls++;if(calls===1)await gate;return slow()};
  const saver=createFileSave({pick:async()=>assert.fail(),handles});
  let html='v1';const request={id:'m-1',fileName:'a.html',content:()=>html};
  const first=saver.save(request);
  html='v2';const second=saver.save(request);const third=saver.save(request);
  assert.equal(saver.busy(),true);
  release();
  await Promise.all([first,second,third]);
  assert.equal(file.content,'v2');
  assert.equal(file.writes,2,'one extra write for all the presses meanwhile');
  assert.equal(saver.busy(),false);
});

test('what is written depends on the chosen file: its name goes to content()',async()=>{
  const handles=memoryHandles(),names=[];
  const saver=createFileSave({pick:async()=>fakeFile('Ричард.dnd'),handles});
  const result=await saver.save({id:'m-1',fileName:'Ричард.html',content:name=>{names.push(name);return '{"items":[]}'}});
  assert.deepEqual(result,{kind:'file',name:'Ричард.dnd'});
  assert.deepEqual(names,['Ричард.dnd'],'the user may pick another type than suggested');
  assert.equal((await handles.get('m-1')).content,'{"items":[]}');
});
