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
import { chooseStartupLayout, formatStamp, chooseLayout, layoutTitle, isCopy, fileBase } from './editor/freshness.js';
import { setupLayoutsDialog } from './editor/layouts-dialog.js';
import { createSnapSettings } from './editor/snapping.js';
import { findFreeSpot, bbox } from './editor/geometry.js';
import { createStore } from './editor/store.js';
import { openStorage, createSaver } from './editor/storage.js';

// State and DOM rendering remain together to minimize v3 regressions.
// Saves live in IndexedDB (see storage.js), one record per layout. Editors up to
// 3.8 kept one save in localStorage under `legacyKey`: it is moved once into the
// record 'default' and never deleted, so an older editor file still opens it.
const legacyKey='dnd-card-editor-v3',recoveryKey=legacyKey+'-recovery',legacyMetaKey=legacyKey+'-meta',legacyMovedKey=legacyKey+'-moved';
/** @type {import('./types/layout').Item[]} */
let items;
const notices=createNotices(document.getElementById('notices'));
const initialNode=document.getElementById('initial');
const embedded=normalizeLayout(JSON.parse(initialNode.textContent)).items||[];
const embeddedAt=initialNode.dataset.savedAt||null;
// ?storage=local forces the localStorage fallback (tests cover both paths).
const storage=await openStorage({prefer:new URLSearchParams(location.search).get('storage')});
document.documentElement.dataset.storage=storage.kind;
// A damaged save must never lock the user out: fall back to the embedded layout
// and keep the raw data so it can be downloaded and repaired.
/** @type {{raw: string, errors: string[]} | null} */
let damagedSave=null;
/** @param {unknown} data */
const checkSaved=data=>typeof data==='string'?{items:null,errors:['Данные не являются корректным JSON.']}:normalizeLayout(data);
async function moveLegacySave(){
  let raw=null,at=null;
  try{
    if(localStorage.getItem(legacyMovedKey))return;
    raw=localStorage.getItem(legacyKey);
    at=JSON.parse(localStorage.getItem(legacyMetaKey)||'null')?.savedAt||null;
  }catch(e){console.warn('Could not read the save of an older editor',e)}
  if(raw===null)return;
  const markMoved=()=>{try{localStorage.setItem(legacyMovedKey,new Date().toISOString())}catch(e){}};
  let parsed=raw;try{parsed=JSON.parse(raw)}catch(e){}
  const result=checkSaved(parsed);
  if(!result.items){damagedSave={raw,errors:result.errors};markMoved();return}
  try{
    // 3.9.0-beta.1 moved it already, without the mark.
    if(!await storage.load('default'))await storage.put({id:'default',name:layoutTitle(result.items),savedAt:at||new Date().toISOString(),items:result.items});
    markMoved();
  }catch(e){console.warn('Could not move the save of an older editor; will retry next time',e)}
}
await moveLegacySave();
/** @type {import('./types/storage').LayoutMeta[]} */
let saves=[];
try{saves=await storage.list()}catch(e){console.warn('Could not list saved layouts',e)}
const choice=chooseLayout({fileId:initialNode.dataset.layoutId||null,fileAt:embeddedAt,fileText:initialNode.textContent,saves,
  newId:()=>'m-'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)});
// The layout this file stands for; «Мои макеты» can switch the editor to another one.
const fileLayoutId=choice.layoutId;
let layoutId=fileLayoutId,layoutName=initialNode.dataset.layoutName||'';
/** @type {import('./types/storage').StoredLayout | null} */
let saved=null;
let storedAt=null,freshness=null;
if(choice.hasSave)try{saved=await storage.load(layoutId)}catch(e){console.warn('Could not read the saved layout',e)}
if(saved){
  storedAt=saved.savedAt||null;
  layoutName=saved.name||layoutName;
  const result=checkSaved(saved.items);
  if(result.items){
    freshness={...chooseStartupLayout({storedItems:result.items,storedAt,embeddedItems:embedded,embeddedAt}),storedItems:result.items};
    if(freshness.source==='browser')items=result.items;
    // The newer file wins, but the older browser save must survive the next autosave.
    else storage.put({id:layoutId+':previous',name:(saved.name||layoutTitle(result.items))+' — до открытия файла',savedAt:storedAt||new Date().toISOString(),items:result.items})
      .catch(e=>console.warn('Could not keep the previous browser layout',e));
  }
  else damagedSave={raw:typeof saved.items==='string'?saved.items:JSON.stringify(saved.items),errors:result.errors};
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
layoutName||=layoutTitle(items);
// Written once the saver exists (below).
let saveAtStart=!damagedSave&&migratedBadges;

const pages=[document.getElementById('page1'),document.getElementById('page2')];
const mm=v=>v+'mm',esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Autosave runs in the background; the indicator next to undo/redo shows its state.
const saveIndicator=document.getElementById('saveState');
saveIndicator.title=storage.kind==='indexeddb'?'Макет сохраняется в базе браузера (IndexedDB)':storage.kind==='localstorage'?'Макет сохраняется в localStorage браузера (до ~5 МБ на все файлы)':'Браузер не даёт этой странице сохранять: скачивайте HTML';
const saver=createSaver({backend:storage,describe:()=>({id:layoutId,name:layoutName,items}),onState:(state,error)=>{
  document.documentElement.dataset.saveState=state;
  saveIndicator.dataset.state=state;
  saveIndicator.textContent=state==='saved'?'✓ Сохранено':state==='saving'?'Сохраняю…':'⚠ Не сохранено';
  if(state==='saved')notices.hide('storage');
  if(state!=='error')return;
  console.warn('Autosave failed: export HTML to keep the work',error);
  const full=/** @type {{name?: string}} */ (error)?.name==='QuotaExceededError';
  notices.show('storage',(full?'Макет не помещается в хранилище браузера (обычно из-за крупных картинок)':'Браузер не дал сохранить макет')+', поэтому последние изменения не сохранены: после перезагрузки откроется предыдущая версия. Скачайте HTML или JSON, чтобы не потерять работу.',[
    {label:'Скачать HTML',onClick:()=>document.getElementById('export').click()},
    {label:'Скачать JSON',onClick:()=>document.getElementById('json').click()}
  ]);
}});
document.documentElement.dataset.saveState=saver.state;
function saveToStorage(){saver.request();return true}
// Closing the tab while a write is running (or after one failed) would lose edits.
window.addEventListener('beforeunload',event=>{if(saver.state!=='saved'){event.preventDefault();event.returnValue=''}});
function downloadJSON(name,data){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
// Replace the whole layout as one undoable step (Ctrl+Z brings the old one back).
function switchLayout(next){
  clearSelection();store.change(()=>structuredClone(next));syncImageTools();syncBgTools();
  notices.hide('freshness');
}
function reportFreshness(){
  if(!freshness?.conflict)return;
  const fileStamp=formatStamp(embeddedAt),browserStamp=formatStamp(storedAt);
  if(freshness.source==='file')notices.show('freshness','Открыт макет из этого файла (сохранён '+fileStamp+'): он новее макета, сохранённого в браузере ('+browserStamp+'). Макет из браузера не потерян.',[
    {label:'Открыть макет из браузера',onClick:()=>switchLayout(freshness.storedItems)},
    {label:'Скачать его JSON',onClick:()=>downloadJSON(fileBase(layoutName)+'_из_браузера.json',freshness.storedItems)}
  ]);
  else notices.show('freshness','Открыт макет, сохранённый в браузере '+browserStamp+': он новее макета в этом файле ('+fileStamp+').',[
    {label:'Открыть макет из файла',onClick:()=>switchLayout(embedded)}
  ]);
}
document.getElementById('resetStorage').onclick=()=>{
  if(!confirm('Сбросить сохранение браузера и открыть макет, записанный в этом файле?\n\nТекущий макет будет скачан как резервная копия JSON, а Ctrl+Z вернёт его.'))return;
  downloadJSON(fileBase(layoutName)+'_резервная_копия.json',items);
  // A clean editor file opens its template as a new layout: the saved one stays in «Мои макеты».
  const clean=!initialNode.dataset.layoutId&&!embeddedAt;
  if(clean||layoutId!==fileLayoutId){
    layoutId=clean?'m-'+Date.now().toString(36)+Math.random().toString(36).slice(2,7):fileLayoutId;
    layoutName=initialNode.dataset.layoutName||layoutTitle(embedded);syncLayoutIdentity();
  }
  switchLayout(embedded);
};
// ---- which layout is open: id and name; «Мои макеты» switches to another saved one ----
const baseTitle=document.title;
const nameInput=document.getElementById('layoutName');
function syncLayoutIdentity(){
  document.documentElement.dataset.layoutId=layoutId;
  nameInput.value=layoutName;
  document.title=layoutName+' · '+baseTitle;
}
// The name is not part of the layout: no undo step, just saved with it.
nameInput.addEventListener('input',()=>{layoutName=nameInput.value.trim()||layoutTitle(items);document.title=layoutName+' · '+baseTitle;saver.request()});
/** @param {string} id */
async function openSaved(id){
  await saver.flush();
  let record=null;
  try{record=await storage.load(id)}catch(e){console.warn('Could not read the saved layout',e)}
  const result=record?checkSaved(record.items):{items:null,errors:['Сохранение не найдено.']};
  if(!record||!result.items){alert('Этот макет не открывается:\n'+result.errors.join('\n'));return}
  // Like opening another file: its own undo history starts here.
  layoutId=id;layoutName=record.name||layoutTitle(result.items);syncLayoutIdentity();
  clearSelection();store.replace(result.items);history.reset();store.render();syncImageTools();syncBgTools();
  for(const id of ['freshness','newer','layouts','damaged'])notices.hide(id);
}
/** @param {string} id */
async function downloadSaved(id){
  const record=await storage.load(id).catch(()=>null);
  if(record)downloadJSON(fileBase(record.name||'')+'.json',record.items);
}
const layoutsDialog=setupLayoutsDialog({dialog:/** @type {HTMLDialogElement} */ (/** @type {unknown} */ (document.getElementById('layoutsDialog'))),
  storage,currentId:()=>layoutId,open:openSaved,download:downloadSaved});
document.getElementById('layouts').onclick=()=>layoutsDialog.show();
function reportLayoutChoice(){
  const newer=choice.newer,others=saves.filter(save=>!isCopy(save.id)).length;
  if(newer)notices.show('newer','В браузере есть макет «'+(newer.name||'Макет без названия')+'», сохранённый '+formatStamp(newer.savedAt)+' — позже, чем скачан этот файл ('+formatStamp(embeddedAt)+'). Возможно, там ваши последние правки.',[
    {label:'Открыть его',onClick:()=>openSaved(newer.id)},
    {label:'Мои макеты',onClick:()=>layoutsDialog.show()}
  ]);
  else if(!initialNode.dataset.layoutId&&!embeddedAt&&choice.hasSave&&others>1)notices.show('layouts','Открыт последний сохранённый макет «'+layoutName+'» ('+formatStamp(storedAt)+'). Остальные макеты этого браузера — в «Файл → Мои макеты».',[
    {label:'Мои макеты',onClick:()=>layoutsDialog.show()}
  ]);
}
function reportDamagedSave(){
  if(!damagedSave)return;
  try{localStorage.setItem(recoveryKey,damagedSave.raw)}catch(e){console.warn('Could not keep a copy of the damaged layout (it can still be downloaded from the notice)',e)}
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
  store.replace(restored);
  if(selected&&!items.some(item=>item.id===selected))selected=null;
  store.render();syncImageTools();syncBgTools();saveToStorage();
  if(focusedId&&focusedField)rich.focusField(focusedId,focusedField,focusedRange);
},onChange:({undo,redo})=>{
  document.getElementById('undo').disabled=!undo;
  document.getElementById('redo').disabled=!redo;
}});
// Every layout edit goes through the store: redraw, undo step, save — see store.js.
const store=createStore({get:()=>items,set:value=>{items=value},history,save:saveToStorage,render:draw,mark:item=>markRendered(item)});
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
const getSelected=()=>selected,clearSelection=()=>{selected=null;canvas.clear()};
// Deleting an embedded text frame must never remove its parent card.
const getSelectionIds=()=>innerCanvas?.hasSelection()?[]:canvas.getIds();
let syncTextBoxTools=()=>{};
let innerCanvas=null;
const rich=createRichText({
  current,select,store,
  selectText:(element,field)=>{
    const item=store.find(element?.dataset.id);
    if(item?.kind==='textbox')select(element);
    else if(item)innerCanvas?.selectField(item.id,field);
  }
});
const {startBadgeDrag}=createInnerInteractions({select,store,mm});
const {syncBgTools}=setupCardBackground({current,store});
const {syncImageTools}=setupImageTools({current,store});
const snapping=createSnapSettings();
const canvas=createCanvasControls({pages,store,mm,snapping,onSelection:(ids,primary)=>{
  selected=primary;
  if(ids.length){const c=store.find(ids[0]);activePage=c?.page||1;}
  const c=current();
  if(c?.bg&&/^#[0-9a-f]{6}$/i.test(c.bg))document.getElementById('bg').value=c.bg;
  syncImageTools();syncBgTools();syncTextBoxTools();
}});
innerCanvas=createInnerCanvas({
  pages,store,mm,
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
// ---- rendering: one element per object, rebuilt only when that object changed ----
const rendered=new Map(); // id -> {node, snap}
const itemById=id=>items.find(x=>x.id===id);
// Geometry that gestures already applied to the node: patch styles, never rebuild.
const GEOMETRY=['x','y','w','h','z','textFrames','badgeX','badgeY','badgeCustomPosition'];
const snapOf=item=>JSON.stringify(item);
const withoutGeometry=item=>JSON.stringify(item,(k,v)=>GEOMETRY.includes(k)?undefined:v);
// Text edited in Tiptap (or the badge) is already on screen: just record it.
function markRendered(item){const r=rendered.get(item.id);if(r)r.snap=snapOf(item)}
function buildElement(item){const e=document.createElement('div');e.className='el '+(item.kind==='image'?'image-el':item.kind==='shape'?'shape '+(item.shape||'rect'):item.kind);e.dataset.id=item.id;e.style.zIndex=String(item.z||1);e.style.left=mm(item.x);e.style.top=mm(item.y);e.style.width=mm(item.w);e.style.height=mm(item.h);if(item.bg&&item.kind!=='textbox')e.style.backgroundColor=item.bg;if(item.kind==='card'&&item.bgImage){const bi=document.createElement('img');bi.className='card-bg-image';bi.src=item.bgImage;bi.draggable=false;bi.style.objectFit=item.bgFit||'cover';bi.style.opacity=String((item.bgOpacity??100)/100);bi.style.transform=`translate(${item.bgX||0}%,${item.bgY||0}%) scale(${(item.bgZoom??100)/100})`;e.append(bi);const shade=document.createElement('div');shade.className='card-bg-shade';shade.style.opacity=String((item.bgShade||0)/100);e.append(shade)}if(item.kind==='card'){/* Цветовые полосы отключены */}if(item.kind==='shape'){e.style.backgroundColor=item.bg||'#d8c5ed';if(item.shape==='line')e.style.height='2px'}if(item.kind==='image'){const im=document.createElement('img');im.src=item.src;im.draggable=false;im.style.objectFit=item.fit||'contain';im.style.filter=`brightness(${item.brightness??100}%) contrast(${item.contrast??100}%)`;im.style.transform=`rotate(${item.rotation||0}deg)`;e.style.opacity=String((item.opacity??100)/100);e.append(im)}if(item.kind==='textbox'){
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
  grip.addEventListener('pointerdown',ev=>canvas.startDrag(ev,item.id));
  e.append(grip);
}for(const f of ['title','subtitle','meta','detail'])if(item[f]!==undefined){const wrap=document.createElement('div');wrap.className='text-wrap';wrap.dataset.field=f;const pos=(item.textFrames||{})[f]||{};wrap.style.transform=`translate(${pos.x||0}mm, ${pos.y||0}mm)`;if(pos.w)wrap.style.width=mm(pos.w);if(pos.h){wrap.style.height=mm(pos.h);wrap.classList.add('sized')}const d=document.createElement('div');setField(d,item,f);wrap.append(d);e.append(wrap)}if(item.level){const badge=document.createElement('div');badge.className='level'+(item.level==='♪'?' item':'');badge.textContent=item.level;badge.contentEditable='true';badge.style.left=item.badgeX!==undefined?mm(item.badgeX):'';badge.style.top=item.badgeY!==undefined?mm(item.badgeY):'';badge.style.right=item.badgeX!==undefined?'auto':'';badge.style.bottom=item.badgeY!==undefined?'auto':'';badge.addEventListener('input',()=>{const it=itemById(item.id);if(!it)return;it.level=badge.textContent;store.shown(it,{group:'badge:'+it.id})});badge.addEventListener('pointerdown',ev=>startBadgeDrag(ev,itemById(item.id),e,badge));e.append(badge)}return e}
function patchGeometry(e,item){
  e.style.zIndex=String(item.z||1);e.style.left=mm(item.x);e.style.top=mm(item.y);e.style.width=mm(item.w);
  if(item.kind==='textbox'){e.style.height=item.autoHeight?'auto':mm(item.h);e.style.maxHeight=item.autoHeight?mm(297-item.y):''}
  else if(!(item.kind==='shape'&&item.shape==='line'))e.style.height=mm(item.h);
  for(const wrap of e.querySelectorAll(':scope > .text-wrap')){
    const pos=(item.textFrames||{})[wrap.dataset.field]||{};
    wrap.style.transform=`translate(${pos.x||0}mm, ${pos.y||0}mm)`;wrap.style.width=pos.w?mm(pos.w):'';wrap.style.height=pos.h?mm(pos.h):'';wrap.classList.toggle('sized',!!pos.h);
  }
  const badge=e.querySelector(':scope > .level');
  if(badge){badge.style.left=item.badgeX!==undefined?mm(item.badgeX):'';badge.style.top=item.badgeY!==undefined?mm(item.badgeY):'';badge.style.right=item.badgeX!==undefined?'auto':'';badge.style.bottom=item.badgeY!==undefined?'auto':''}
}
function draw(){
  pendingEditors.length=0;
  const seen=new Set(),last=new Map(); // page -> previous node, to keep DOM order = data order
  for(const item of items){
    seen.add(item.id);
    const page=pages[(item.page||1)-1],snap=snapOf(item),r=rendered.get(item.id);
    // Gestures move nodes directly, so geometry is re-applied even when unchanged.
    if(r&&r.snap===snap){rich.rebind(item.id,item);patchGeometry(r.node,item)}
    else if(r&&withoutGeometry(item)===withoutGeometry(JSON.parse(r.snap))){rich.rebind(item.id,item);patchGeometry(r.node,item);r.snap=snap}
    else{
      if(r){rich.unmount(item.id);r.node.remove()}
      rendered.set(item.id,{node:buildElement(item),snap});
    }
    const node=rendered.get(item.id).node,prev=last.get(page);
    const wanted=prev?prev.nextSibling:page.firstChild;
    if(node!==wanted)page.insertBefore(node,wanted);
    last.set(page,node);
  }
  for(const [id,r] of rendered)if(!seen.has(id)){rich.unmount(id);r.node.remove();rendered.delete(id)}
  pages.forEach((p,i)=>{if(!p.querySelector(':scope > .page-number')){const n=document.createElement('div');n.className='page-number';n.textContent=(i+1)+' / 2';p.append(n)}});
  for(const entry of pendingEditors)rich.mount(entry.node,entry.item,entry.field);
  canvas.afterDraw();innerCanvas.afterDraw();syncTextBoxTools()}
// Throw away every element and editor (recovery paths, before replacing all data).
function resetRender(){rich.destroy();for(const r of rendered.values())r.node.remove();rendered.clear()}
function select(e){canvas.setSelection(e?[e.dataset.id]:[],e?.dataset.id||null)}
function current(){return items.find(x=>x.id===selected)}// Where a new object goes: the free spot nearest to a wish — under the selected
// object, or the middle of the part of the active page that is on screen.
function visibleMiddle(size){
  const page=pages[activePage-1],r=page.getBoundingClientRect(),k=210/r.width;
  const top=Math.max(r.top,document.querySelector('.toolbar')?.getBoundingClientRect().bottom||0),bottom=Math.min(r.bottom,innerHeight);
  const y=bottom>top?((top+bottom)/2-r.top)*k:148.5;
  const half=v=>Math.round(v*2)/2; // tidy numbers in the layout
  return {x:half(105-size.w/2),y:half(y-size.h/2)};
}
function placeNew(size,wish){
  const anchor=current();
  wish||=anchor&&anchor.page===activePage?{x:anchor.x,y:anchor.y+anchor.h+2}:visibleMiddle(size);
  return findFreeSpot(size,items.filter(v=>(v.page||1)===activePage),wish);
}
let idSeq=0;
const newId=()=>'e'+Date.now()+String(++idSeq).padStart(3,'0');
// Add objects to the active page as one undoable step, keeping their layout among
// themselves: the group goes to the free spot nearest the wish, on top of the
// page, and becomes the selection.
/** @param {object[]} list @param {{x: number, y: number}} [wish] */
function addObjects(list,wish){
  const sources=list.map(o=>({x:0,y:0,...structuredClone(o)})).sort((a,b)=>(a.z||0)-(b.z||0));
  const box=bbox(sources),spot=placeNew({w:box.w,h:box.h},wish);
  let z=Math.max(0,...items.filter(v=>v.page===activePage).map(v=>v.z||0));
  const added=sources.map(o=>({...o,x:o.x-box.x+spot.x,y:o.y-box.y+spot.y,z:++z,id:newId(),page:activePage}));
  store.change(items=>{items.push(...added)});
  canvas.setSelection(added.map(o=>o.id),added[0].id);
  return added;
}
/** @param {object} o @param {{x: number, y: number}} [wish] */
function addObject(o,wish){addObjects([o],wish)}
function addCard(){addObject({kind:'card',w:91,h:23,title:'Новая способность',meta:'Тип · дистанция · длительность',detail:'Кликни, чтобы изменить описание.',level:'1',roles:'support',bg:'#ffffff'})}
setupObjects({addCard,addObject,addObjects,current,getSelectionIds,clearSelection,store,syncImageTools,syncBgTools});
({syncTextBoxTools}=setupTextBoxes({addObject,current,store}));
setupLayers({current,store,getSelected,getSelectionIds,select});
setupFiles({store,getSelectionIds,clearSelection,syncImageTools,syncBgTools,flushSave:()=>saver.flush(),identity:()=>({id:layoutId,name:layoutName})});
pages.forEach((p,i)=>p.addEventListener('pointerdown',e=>{if(e.target===p)activePage=i+1}));
try{draw()}catch(error){
  // Valid-looking data can still fail to render; recover the same way.
  if(!saved||freshness?.source!=='browser'||damagedSave)throw error;
  damagedSave={raw:JSON.stringify(saved.items),errors:[error.message]};saveAtStart=false;
  items=structuredClone(embedded);selected=null;
  history.reset();resetRender();draw();
}
setupToolbarTabs();
syncLayoutIdentity();
reportDamagedSave();
reportFreshness();
reportLayoutChoice();
saveIndicator.textContent=storage.kind==='none'?'⚠ Без сохранения':'✓ Сохранено';saveIndicator.dataset.state=storage.kind==='none'?'error':'saved';
if(saveAtStart)saver.request();
if(storage.kind==='none')notices.show('storage','Браузер не даёт этой странице сохранять макет (например, в приватном окне). Изменения пропадут при закрытии вкладки: сохраняйте работу кнопкой «Скачать HTML».',[
  {label:'Скачать HTML',onClick:()=>document.getElementById('export').click()}
]);
