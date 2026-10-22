import { createHistory } from './editor/history.js';
import { createInnerInteractions } from './editor/interactions.js';
import { createCanvasControls } from './editor/canvas-controls.js';
import { createInnerCanvas } from './editor/inner-canvas.js';
import { setupCardBackground } from './editor/card-background.js';
import { setupImageTools } from './editor/image-tools.js';
import { setupLayers } from './editor/layers.js';
import { createRichText } from './editor/rich-text.js';
import { setupObjects } from './editor/objects.js';
import { setupFiles } from './editor/files.js';
import { setupToolbarTabs } from './editor/toolbar-tabs.js';
import { setupTextBoxes } from './editor/text-boxes.js';
import { normalizeLayout } from './editor/layout.js';
import { createNotices } from './editor/notice.js';
import { chooseStartupLayout, formatStamp } from './editor/freshness.js';
import { createSnapSettings } from './editor/snapping.js';

// State and DOM rendering remain together to minimize v3 regressions.
const key='dnd-card-editor-v3',recoveryKey=key+'-recovery',metaKey=key+'-meta',previousKey=key+'-previous';let items;
const notices=createNotices(document.getElementById('notices'));
const initialNode=document.getElementById('initial');
const embedded=normalizeLayout(JSON.parse(initialNode.textContent)).items||[];
const embeddedAt=initialNode.dataset.savedAt||null;
// A damaged save must never lock the user out: fall back to the embedded layout
// and keep the raw data so it can be downloaded and repaired.
let stored=null,storedAt=null,damagedSave=null,freshness=null;
try{
  stored=localStorage.getItem(key);
  storedAt=JSON.parse(localStorage.getItem(metaKey)||'null')?.savedAt||null;
}catch(e){console.warn('Browser storage is unavailable',e)}
if(stored){
  let result;
  try{result=normalizeLayout(JSON.parse(stored))}catch(e){result={items:null,errors:['Данные не являются корректным JSON.']}}
  if(result.items){
    freshness={...chooseStartupLayout({storedItems:result.items,storedAt,embeddedItems:embedded,embeddedAt}),storedItems:result.items};
    if(freshness.source==='browser')items=result.items;
    // The newer file wins, but the older browser save must survive the next autosave.
    else try{localStorage.setItem(previousKey,stored)}catch(e){console.warn('Could not keep the previous browser layout',e)}
  }
  else damagedSave={raw:stored,errors:result.errors};
}
items ||= structuredClone(embedded);
let selected=null, activePage=1;

// Convert the old top-right default on saved cards; preserve manual positions.
let migratedBadges=false;
for(const item of items){
  if(item.kind==='card' && !item.badgeCustomPosition && item.badgeX===81.5 && item.badgeY===1.1){
    delete item.badgeX;delete item.badgeY;migratedBadges=true;
  }
}
if(migratedBadges&&!damagedSave){try{localStorage.setItem(key,JSON.stringify(items))}catch(e){console.warn('Could not save badge migration',e)}}

const pages=[document.getElementById('page1'),document.getElementById('page2')];
const mm=v=>v+'mm',esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function saveToStorage(){
  try{
    localStorage.setItem(key,JSON.stringify(items));
    localStorage.setItem(metaKey,JSON.stringify({savedAt:new Date().toISOString()}));
    notices.hide('storage');return true;
  }
  catch(e){
    console.warn('Storage limit exceeded: export HTML to save',e);
    notices.show('storage','Макет не помещается в хранилище браузера (обычно из-за крупных картинок), поэтому последние изменения не сохранены: после перезагрузки откроется предыдущая версия. Скачайте HTML или JSON, чтобы не потерять работу.',[
      {label:'Скачать HTML',onClick:()=>document.getElementById('export').click()},
      {label:'Скачать JSON',onClick:()=>document.getElementById('json').click()}
    ]);
    return false;
  }
}
function downloadJSON(name,data){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
// Replace the whole layout as one undoable step (Ctrl+Z brings the old one back).
function switchLayout(next){
  items=structuredClone(next);clearSelection();
  draw();syncImageTools();syncBgTools();persist();
  notices.hide('freshness');
}
function reportFreshness(){
  if(!freshness?.conflict)return;
  const fileStamp=formatStamp(embeddedAt),browserStamp=formatStamp(storedAt);
  if(freshness.source==='file')notices.show('freshness','Открыт макет из этого файла (сохранён '+fileStamp+'): он новее макета, сохранённого в браузере ('+browserStamp+'). Макет из браузера не потерян.',[
    {label:'Открыть макет из браузера',onClick:()=>switchLayout(freshness.storedItems)},
    {label:'Скачать его JSON',onClick:()=>downloadJSON('Ричард_макет_из_браузера.json',freshness.storedItems)}
  ]);
  else notices.show('freshness','Открыт макет, сохранённый в браузере '+browserStamp+': он новее макета в этом файле ('+fileStamp+').',[
    {label:'Открыть макет из файла',onClick:()=>switchLayout(embedded)}
  ]);
}
document.getElementById('resetStorage').onclick=()=>{
  if(!confirm('Сбросить сохранение браузера и открыть макет, записанный в этом файле?\n\nТекущий макет будет скачан как резервная копия JSON, а Ctrl+Z вернёт его.'))return;
  downloadJSON('Ричард_макет_резервная_копия.json',items);
  switchLayout(embedded);
};
function reportDamagedSave(){
  if(!damagedSave)return;
  try{localStorage.setItem(recoveryKey,damagedSave.raw)}catch(e){console.warn('Could not keep a copy of the damaged layout',e)}
  console.warn('Damaged saved layout replaced by the template',damagedSave.errors);
  notices.show('damaged','Сохранённый в браузере макет повреждён и не открывается, поэтому загружен исходный шаблон. Скачайте копию повреждённых данных, прежде чем вносить изменения: при следующем сохранении она будет заменена.',[
    {label:'Скачать повреждённый JSON',onClick:()=>{
      const url=URL.createObjectURL(new Blob([damagedSave.raw],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='Ричард_макет_повреждённый.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),3000);
    }}
  ]);
}
const history=createHistory({read:()=>items,restore:restored=>{
  const focusedRich=rich.active();
  const wasEditing=!!document.activeElement?.classList?.contains('tiptap-content');
  const focusedRange=focusedRich?{from:focusedRich.editor.state.selection.from,to:focusedRich.editor.state.selection.to}:null;
  const focusedId=wasEditing?focusedRich?.item.id:null;
  const focusedField=wasEditing?focusedRich?.field:null;
  items=restored;
  if(selected&&!items.some(item=>item.id===selected))selected=null;
  draw();syncImageTools();syncBgTools();saveToStorage();
  if(focusedId&&focusedField)rich.focusField(focusedId,focusedField,focusedRange);
},onChange:({undo,redo})=>{
  document.getElementById('undo').disabled=!undo;
  document.getElementById('redo').disabled=!redo;
}});
function persist(options){history.commit(options);return saveToStorage()}
function navigateHistory(direction){
  // Edits are already saved on every input event; no pending DOM changes.
  return direction==='undo'?history.undo():history.redo();
}
document.getElementById('undo').onclick=()=>navigateHistory('undo');
document.getElementById('redo').onclick=()=>navigateHistory('redo');
window.addEventListener('keydown',event=>{
  if(!(event.ctrlKey||event.metaKey)||event.altKey)return;
  // Use the physical key in non-Latin layouts (e.g. Russian: Z='я', Y='н').
  const key=(event.key||'').toLowerCase();
  const isZ=key==='z'||event.code==='KeyZ';
  const isY=key==='y'||event.code==='KeyY';
  const action=(isZ&&!event.shiftKey)?'undo':((isZ&&event.shiftKey)||isY)?'redo':null;
  if(!action)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  navigateHistory(action);
},true);
const getItems=()=>items,setItems=value=>{items=value};
const getSelected=()=>selected,clearSelection=()=>{selected=null;canvas.clear()};
// Deleting an embedded text frame must never remove its parent card.
const getSelectionIds=()=>innerCanvas?.hasSelection()?[]:canvas.getIds();
let syncTextBoxTools=()=>{};
let innerCanvas=null;
const rich=createRichText({
  current,select,persist,
  selectText:(element,field)=>{
    const item=getItems().find(v=>v.id===element?.dataset.id);
    if(item?.kind==='textbox')select(element);
    else if(item)innerCanvas?.selectField(item.id,field);
  }
});
const {startBadgeDrag}=createInnerInteractions({select,persist,mm});
const {syncBgTools}=setupCardBackground({current,persist,draw,getItems});
const {syncImageTools}=setupImageTools({current,persist});
const snapping=createSnapSettings();
const canvas=createCanvasControls({pages,getItems,persist,mm,snapping,onSelection:(ids,primary)=>{
  selected=primary;
  if(ids.length){const c=getItems().find(item=>item.id===ids[0]);activePage=c?.page||1;}
  const c=current();
  if(c?.bg&&/^#[0-9a-f]{6}$/i.test(c.bg))document.getElementById('bg').value=c.bg;
  syncImageTools();syncBgTools();syncTextBoxTools();
}});
innerCanvas=createInnerCanvas({
  pages,getItems,persist,mm,
  selectParent:id=>canvas.setSelection([id],id,{keepInner:true})
});
canvas.attachInner(innerCanvas);
{
  const toggle=document.getElementById('snapToggle'),grid=document.getElementById('snapGrid');
  const show=()=>{const s=snapping.get();toggle.checked=s.enabled;grid.value=String(s.gridMm);grid.disabled=!s.enabled};
  toggle.onchange=()=>snapping.set({enabled:toggle.checked});
  grid.onchange=()=>snapping.set({gridMm:Number(grid.value)});
  snapping.onChange(show);show();
}

const pendingEditors=[];
function setField(node,item,f){
  node.className=f+' editable'+(item.kind==='textbox'?' textbox-editor':'');
  node.dataset.field=f;
  pendingEditors.push({node,item,field:f});
}
function draw(){rich.destroy();pendingEditors.length=0;pages.forEach(p=>p.replaceChildren());for(const item of items){const e=document.createElement('div');e.className='el '+(item.kind==='image'?'image-el':item.kind==='shape'?'shape '+(item.shape||'rect'):item.kind);e.dataset.id=item.id;e.style.zIndex=String(item.z||1);e.style.left=mm(item.x);e.style.top=mm(item.y);e.style.width=mm(item.w);e.style.height=mm(item.h);if(item.bg&&item.kind!=='textbox')e.style.backgroundColor=item.bg;if(item.kind==='card'&&item.bgImage){const bi=document.createElement('img');bi.className='card-bg-image';bi.src=item.bgImage;bi.draggable=false;bi.style.objectFit=item.bgFit||'cover';bi.style.opacity=(item.bgOpacity??100)/100;bi.style.transform=`translate(${item.bgX||0}%,${item.bgY||0}%) scale(${(item.bgZoom??100)/100})`;e.append(bi);const shade=document.createElement('div');shade.className='card-bg-shade';shade.style.opacity=(item.bgShade||0)/100;e.append(shade)}if(item.kind==='card'){/* Цветовые полосы отключены */}if(item.kind==='shape'){e.style.backgroundColor=item.bg||'#d8c5ed';if(item.shape==='line')e.style.height='2px'}if(item.kind==='image'){const im=document.createElement('img');im.src=item.src;im.draggable=false;im.style.objectFit=item.fit||'contain';im.style.filter=`brightness(${item.brightness??100}%) contrast(${item.contrast??100}%)`;im.style.transform=`rotate(${item.rotation||0}deg)`;e.style.opacity=(item.opacity??100)/100;e.append(im)}if(item.kind==='textbox'){
  e.classList.toggle('auto-height',!!item.autoHeight);
  e.style.height=item.autoHeight?'auto':mm(item.h);
  e.style.maxHeight=item.autoHeight?mm(297-item.y):'';
  e.style.backgroundColor=item.bgTransparent?'transparent':(item.bg||'#ffffff');
  e.style.border=item.borderVisible?'1px solid '+(item.borderColor||'#745193'):'1px solid transparent';
  const content=document.createElement('div');setField(content,item,'text');
  content.style.fontFamily=item.fontFamily||'Georgia';
  content.style.fontSize=(item.fontSize||12)+'pt';
  content.style.fontWeight=item.textWeight||'normal';
  content.style.textAlign=item.textAlign||'left';
  content.style.color=item.textColor||'#262137';
  e.append(content);
  const grip=document.createElement('span');grip.className='textbox-move';
  grip.textContent='⠿';grip.title='Перетащить текстовую рамку';
  grip.addEventListener('mousedown',ev=>canvas.startDrag(ev,item.id));
  e.append(grip);
}for(const f of ['title','subtitle','meta','detail'])if(item[f]!==undefined){const wrap=document.createElement('div');wrap.className='text-wrap';wrap.dataset.field=f;const pos=(item.textFrames||{})[f]||{};wrap.style.transform=`translate(${pos.x||0}mm, ${pos.y||0}mm)`;if(pos.w)wrap.style.width=mm(pos.w);if(pos.h)wrap.style.height=mm(pos.h);const d=document.createElement('div');setField(d,item,f);wrap.append(d);e.append(wrap)}if(item.level){const badge=document.createElement('div');badge.className='level'+(item.level==='♪'?' item':'');badge.textContent=item.level;badge.contentEditable='true';badge.style.left=item.badgeX!==undefined?mm(item.badgeX):'';badge.style.top=item.badgeY!==undefined?mm(item.badgeY):'';badge.style.right=item.badgeX!==undefined?'auto':'';badge.style.bottom=item.badgeY!==undefined?'auto':'';badge.addEventListener('input',()=>{item.level=badge.textContent;persist({group:'badge:'+item.id})});badge.addEventListener('pointerdown',ev=>startBadgeDrag(ev,item,e,badge));e.append(badge)}pages[(item.page||1)-1].append(e)}pages.forEach((p,i)=>{const n=document.createElement('div');n.className='page-number';n.textContent=(i+1)+' / 2';p.append(n)});if(selected){const s=document.querySelector('.el[data-id="'+selected+'"]');if(s)s.classList.add('selected')}for(const entry of pendingEditors)rich.mount(entry.node,entry.item,entry.field);canvas.afterDraw();innerCanvas.afterDraw();syncTextBoxTools()}
function select(e){canvas.setSelection(e?[e.dataset.id]:[],e?.dataset.id||null)}
function current(){return items.find(x=>x.id===selected)}function addObject(o){const obj={...o,z:Math.max(0,...items.filter(v=>v.page===activePage).map(v=>v.z||0))+1,id:'e'+Date.now()+Math.floor(Math.random()*10000),page:activePage};items.push(obj);persist();draw();select(document.querySelector('[data-id="'+obj.id+'"]'))}
function addCard(copy){const src=copy||{kind:'card',x:12,y:120,w:91,h:23,title:'Новая способность',meta:'Тип · дистанция · длительность',detail:'Кликни, чтобы изменить описание.',level:'1',roles:'support',bg:'#ffffff'};addObject({...structuredClone(src),x:Math.min(115,src.x+5),y:Math.min(270,src.y+5)})}
setupObjects({addCard,addObject,current,getItems,setItems,getSelected,getSelectionIds,clearSelection,persist,draw,syncImageTools,syncBgTools});
({syncTextBoxTools}=setupTextBoxes({addObject,current,persist,draw}));
setupLayers({current,getItems,getSelected,persist,draw,select});
setupFiles({getItems,setItems,getSelected,getSelectionIds,clearSelection,persist,draw,syncImageTools,syncBgTools});
pages.forEach((p,i)=>p.addEventListener('pointerdown',e=>{if(e.target===p)activePage=i+1}));
try{draw()}catch(error){
  // Valid-looking data can still fail to render; recover the same way.
  if(!stored||damagedSave)throw error;
  damagedSave={raw:stored,errors:[error.message]};
  items=structuredClone(embedded);selected=null;
  history.reset();draw();
}
setupToolbarTabs();
reportDamagedSave();
reportFreshness();
