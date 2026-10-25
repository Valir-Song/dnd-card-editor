import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { libraryEntry, libraryIndex, LIBRARY_FOLDER } from '../scripts/library.mjs';
import { readIndex, libraryBase, createLibrary, LIBRARY_SITE } from '../src/editor/library.js';
import { readSheet } from '../src/editor/new-sheet.js';
import { wrapLayout } from '../src/editor/layout.js';

const card={id:'c1',kind:'card',page:1,x:10,y:10,w:90,h:20,title:'Приказ'};
const header={id:'h1',kind:'header',page:1,x:12,y:12,w:186,h:37,title:'ГРОМ',subtitle:'  Воин 3 ·   Чемпион '};

test('every file in library/ is a ready sheet (a broken upload fails here, before the site)',()=>{
  const files=readdirSync(LIBRARY_FOLDER).map(file=>({file,text:readFileSync(LIBRARY_FOLDER+'/'+file,'utf8')}));
  const {sheets,errors}=libraryIndex(files);
  assert.deepEqual(errors,[]);
  const richard=sheets.find(sheet=>sheet.file==='richard-sadsong.dnd');
  assert.ok(richard,'Richard is the first ready sheet');
  assert.equal(richard.name,'Бард — Ричард Сэдсонг');
  assert.match(richard.summary,/^Бард 6 · Коллегия очарования/);
  assert.equal(richard.count,28);
});

test('a sheet is named by its layout name, else its heading, and described by the heading subtitle',()=>{
  const named=libraryEntry('grom.dnd',JSON.stringify(wrapLayout([header,card],{name:'Воин — Гром'})));
  assert.deepEqual(named.entry&&{...named.entry,bytes:0},{file:'grom.dnd',name:'Воин — Гром',summary:'Воин 3 · Чемпион',count:2,bytes:0});
  assert.equal(libraryEntry('grom.dnd',JSON.stringify(wrapLayout([header]))).entry?.name,'ГРОМ');
  assert.equal(libraryEntry('x.dnd',JSON.stringify(wrapLayout([card]))).entry?.summary,'');
});

test('files that are not sheets are errors with the file name; the index and README are skipped',()=>{
  const {sheets,errors}=libraryIndex([
    {file:'b.dnd',text:JSON.stringify(wrapLayout([card],{name:'Бэ'}))},
    {file:'a.dnd',text:JSON.stringify(wrapLayout([card],{name:'А'}))},
    {file:'broken.dnd',text:'{oops'},
    {file:'bad.dnd',text:JSON.stringify([{...card,kind:'spell'}])},
    {file:'picture.png',text:'png'},
    {file:'README.md',text:'# Готовые листы'},
    {file:'index.json',text:'{}'},
  ]);
  assert.deepEqual(sheets.map(sheet=>sheet.name),['А','Бэ'],'sorted by name');
  assert.equal(errors.length,3);
  assert.match(errors[0],/^broken\.dnd: /);
  assert.match(errors[1],/^bad\.dnd: /);
  assert.match(errors[2],/^picture\.png: .*\.dnd/);
});

test('the app reads its own library folder, a file from disk reads the main site',()=>{
  assert.equal(libraryBase(true,'https://valir-song.github.io/dnd-editor/beta/?x=1'),'https://valir-song.github.io/dnd-editor/beta/library/');
  assert.equal(libraryBase(true,'http://localhost:8000/index.html'),'http://localhost:8000/library/');
  assert.equal(libraryBase(false,'file:///C:/Users/v/Ричард.html'),LIBRARY_SITE);
});

test('the index keeps only real sheets, and no path can leave the library folder',()=>{
  assert.equal(readIndex(null),null);
  assert.equal(readIndex({sheets:'no'}),null);
  assert.deepEqual(readIndex({sheets:[
    {file:'a.dnd',name:'А',summary:'s',count:3,bytes:10},
    {file:'../secret.dnd',name:'X'},{file:'b/c.dnd',name:'X'},{file:'',name:'X'},{file:'d.dnd'},null,
    {file:'e.dnd',name:'Е'},
  ]}),[{file:'a.dnd',name:'А',summary:'s',count:3,bytes:10},{file:'e.dnd',name:'Е',summary:'',count:0,bytes:0}]);
});

test('the library fetches the index and a sheet from its folder',async()=>{
  const asked=[];
  const files={'index.json':JSON.stringify({sheets:[{file:'Ричард 1.dnd',name:'Р'}]}),'Ричард 1.dnd':'{"items":[]}'};
  const library=createLibrary('https://example.org/dnd-editor/library/',async url=>{
    asked.push(url);
    const name=decodeURIComponent(url.split('/').pop());
    return {ok:name in files,status:name in files?200:404,text:async()=>files[name]};
  });
  const [sheet]=await library.list();
  assert.equal(await library.sheet(sheet),'{"items":[]}');
  assert.deepEqual(asked,['https://example.org/dnd-editor/library/index.json','https://example.org/dnd-editor/library/%D0%A0%D0%B8%D1%87%D0%B0%D1%80%D0%B4%201.dnd']);
  await assert.rejects(library.sheet({...sheet,file:'gone.dnd'}),/HTTP 404/);
  files['index.json']='{"oops":1}';
  await assert.rejects(library.list(),/повреждён/);
});

test('a ready sheet opens like a layout file',()=>{
  assert.deepEqual(readSheet(JSON.stringify(wrapLayout([card],{name:'А'}))).items?.map(x=>x.id),['c1']);
  assert.ok('error' in readSheet('<html></html>'));
  assert.ok('error' in readSheet(JSON.stringify([{...card,page:70}])));
});

test('the empty template has no character of its own',()=>{
  const template=readFileSync('src/starter-layout.json','utf8');
  assert.doesNotMatch(template,/Ричард|РИЧАРД|Сэдсонг|Бард 6/);
  assert.match(template,/ИМЯ ПЕРСОНАЖА/);
});
