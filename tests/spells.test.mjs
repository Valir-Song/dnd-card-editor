import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSpells, spellMeta, withDc, readDc, spellText, boldPieces, spellCard, spellCards, filterSpells, SPELLS_NAME, MAX_AT_ONCE } from '../src/editor/spells.js';
import { libraryIndex } from '../scripts/library.mjs';
import { createLibrary } from '../src/editor/library.js';
import { normalizeLayout } from '../src/editor/layout.js';

const file=JSON.parse(readFileSync('library/'+SPELLS_NAME,'utf8'));
const reference=readSpells(file);
const byId=(/** @type {string} */ id)=>{const spell=reference?.spells.find(s=>s.id===id);assert.ok(spell,id);return spell};

test('library/spells.json is a whole spell reference: 130 bard spells, no broken entries, the SRD attribution',()=>{
  assert.ok(reference);
  assert.equal(reference.spells.length,file.spells.length,'every entry is a spell');
  assert.equal(reference.spells.filter(s=>s.classes.includes('bard')).length,130);
  assert.equal(new Set(reference.spells.map(s=>s.id)).size,reference.spells.length);
  assert.equal(new Set(reference.spells.map(s=>s.name)).size,reference.spells.length,'names are unique in the list');
  assert.match(reference.attribution,/System Reference Document 5\.2.*Creative Commons Attribution 4\.0/);
  for(const spell of reference.spells){
    assert.ok(spell.short&&spell.short.length<=120,spell.id+': a one-line summary');
    assert.ok(spell.text.length>0&&spell.text.every(p=>p.trim()),spell.id+': the full text');
    assert.doesNotMatch(spell.short+spell.text.join(''),/[A-Za-z]{3,}/,spell.id+': no English left');
  }
  const levels=Object.fromEntries([0,1,2,3,4,5,6,7,8,9].map(n=>[n,reference.spells.filter(s=>s.level===n).length]));
  assert.deepEqual(levels,{0:10,1:23,2:23,3:17,4:10,5:17,6:8,7:11,8:6,9:5});
});

test('the spell reference is not taken for a ready sheet',()=>{
  const {sheets,errors}=libraryIndex([{file:SPELLS_NAME,text:JSON.stringify(file)}]);
  assert.deepEqual([sheets,errors],[[],[]]);
});

test('a damaged reference is refused, a damaged entry is skipped',()=>{
  assert.equal(readSpells(null),null);
  assert.equal(readSpells({spells:[]}),null,'not our format');
  const good=byId('healing-word');
  const read=readSpells({format:'dnd-card-editor/spells',spells:[{...good,aliases:['Лечащее слово',7]},{...good,id:'x',level:12},{...good,id:'y',text:'one string'},null]});
  assert.deepEqual(read?.spells.map(s=>s.id),['healing-word']);
  assert.deepEqual(read?.spells[0].aliases,['Лечащее слово']);
  assert.deepEqual(readSpells({format:'dnd-card-editor/spells',spells:[{...good,aliases:undefined}]})?.spells[0].aliases,[]);
});

test('the meta line is written the way the owner writes it',()=>{
  assert.equal(spellMeta(byId('dissonant-whispers')),'1 круг · 60 фт.');
  assert.equal(spellMeta(byId('hypnotic-pattern')),'3 круг · 120 фт. · К, 1 мин');
  assert.equal(spellMeta(byId('disguise-self')),'1 круг · на себя · 1 ч');
  assert.equal(spellMeta(byId('mage-hand')),'Заговор · 30 фт. · 1 мин');
  assert.equal(spellMeta(byId('detect-magic')),'1 круг · на себя · К, 10 мин · ритуал');
  assert.equal(spellMeta(byId('find-the-path')),'6 круг · на себя · К, 1 день');
  assert.equal(spellMeta(byId('glyph-of-warding')),'3 круг · касание · до рассеивания');
});

test('«Моя СЛ» puts the number into the first saving throw of the summary',()=>{
  assert.equal(withDc('Спасбросок Мудрости. 3к6 психической энергией.',14),'Мудрость СЛ 14. 3к6 психической энергией.');
  assert.equal(withDc('Касание, спасбросок Харизмы.',15),'Касание, Харизма СЛ 15.');
  assert.equal(withDc('Спасбросок Ловкости.',null),'Спасбросок Ловкости.');
  assert.equal(withDc('Касание: 2к8 хитов.',14),'Касание: 2к8 хитов.');
  assert.deepEqual(['14',' 9 ','','0','31','12.5','abc'].map(readDc),[14,9,null,null,null,null,null]);
});

test('a spell becomes a card like the owner’s: badge = circle, meta, summary, the full text inside',()=>{
  const card=spellCard(byId('dissonant-whispers'),14);
  assert.equal(card.kind,'card');
  assert.equal(card.title,'Диссонирующий шёпот');
  assert.equal(card.meta,'1 круг · 60 фт.');
  assert.equal(card.detail,'Мудрость СЛ 14. 3к6 психической энергией, половина при успехе; провал — отход реакцией.');
  assert.equal(card.level,'1');
  assert.equal(card.w,91);
  assert.equal(card.spellId,'dissonant-whispers');
  const [heading,first]=(card.spellText||'').split('\n\n');
  assert.equal(heading,'Диссонирующий шёпот [Dissonant Whispers] — 1-й круг, очарование');
  assert.match(first,/^\*\*Время:\*\* Действие · \*\*Дистанция:\*\* 60 футов/);
  assert.match(card.spellText||'',/Ячейкой выше/);
  assert.match(card.spellText||'',/CC-BY 4\.0/);
  assert.equal(spellCard(byId('vicious-mockery'),null).level,'0');
  // A long summary gets a taller card.
  assert.ok(spellCard(byId('bestow-curse'),null).h>spellCard(byId('light'),null).h);
  // The card is an ordinary layout object.
  const {items,errors}=normalizeLayout([{...card,id:'s1',page:1,x:10,y:10}]);
  assert.ok(items,errors.join());
  assert.equal(items[0].spellText,card.spellText);
});

test('several cards stand in columns of ten, two millimetres apart',()=>{
  const spells=filterSpells(reference?.spells||[],{query:'',level:1}).slice(0,12);
  const cards=spellCards(spells,null);
  assert.equal(cards.length,12);
  assert.deepEqual([cards[0].x,cards[0].y],[0,0]);
  assert.equal(cards[1].y,(cards[0].y||0)+cards[0].h+2);
  assert.deepEqual([cards[10].x,cards[10].y],[95,0]);
  assert.ok(cards.slice(0,10).every(c=>(c.y||0)+c.h<=297-10),'a column fits on the page');
  assert.equal(MAX_AT_ONCE,20);
});

test('the list filters by circle and by a Russian or English word',()=>{
  const spells=reference?.spells||[];
  assert.equal(filterSpells(spells,{query:'',level:0}).length,10);
  assert.deepEqual(filterSpells(spells,{query:'лечащее',level:null}).map(s=>s.id),['healing-word','mass-healing-word']);
  assert.deepEqual(filterSpells(spells,{query:'Healing word',level:3}).map(s=>s.id),['mass-healing-word']);
  assert.deepEqual(filterSpells(spells,{query:'шепот',level:null}).map(s=>s.id),['dissonant-whispers'],'ё = е');
  // The names of the owner's sheet, and other known names too.
  assert.deepEqual(filterSpells(spells,{query:'разбивающий',level:null}).map(s=>s.id),['shatter']);
  assert.deepEqual(filterSpells(spells,{query:'дребезги',level:null}).map(s=>s.id),['shatter']);
  assert.deepEqual(filterSpells(spells,{query:'Таши',level:null}).map(s=>s.id),['hideous-laughter']);
  const all=filterSpells(spells,{query:'',level:null});
  assert.ok(all.every((s,i)=>!i||all[i-1].level<=s.level),'by circle');
});

test('**bold** is cut into pieces, never parsed as HTML',()=>{
  assert.deepEqual(boldPieces('**Звук.** Громкость <b>любая</b>'),[{text:'Звук.',bold:true},{text:' Громкость <b>любая</b>',bold:false}]);
  assert.deepEqual(boldPieces(spellText(byId('light')).split('\n\n')[0]),[{text:'Свет [Light] — Заговор, воплощение',bold:false}]);
});

test('the library fetches the reference from its folder',async()=>{
  const asked=/** @type {string[]} */ ([]);
  const library=createLibrary('https://example.org/dnd-editor/library/',async url=>{asked.push(url);return {ok:true,status:200,text:async()=>JSON.stringify(file)}});
  assert.equal(readSpells(await library.spells())?.spells.length,file.spells.length);
  assert.deepEqual(asked,['https://example.org/dnd-editor/library/spells.json']);
});

test('spells of the owner’s sheet carry the names he uses there',()=>{
  const sheet=JSON.parse(readFileSync('library/richard-sadsong.dnd','utf8'));
  const names=new Set(reference?.spells.map(s=>s.name));
  const titles=sheet.items.filter((/** @type {{kind: string}} */ i)=>i.kind==='card').map((/** @type {{title?: string}} */ i)=>(i.title||'').replace(/\s+/g,' ').trim());
  for(const title of ['Магическая рука','Мелкие фокусы','Диссонирующий шёпот','Приказ','Изменение облика','Немой образ','Приворот гуманоида','Разбивающий звук','Внушение','Зеркальное отражение','Обнаружение мыслей','Завораживающий узор','Ужас','Исцеляющее слово','Массовое исцеляющее слово']){
    assert.ok(titles.includes(title),'on the sheet: '+title);
    assert.ok(names.has(title),'in the reference: '+title);
  }
});
