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
import { formatStamp, layoutTitle, isCopy, fileBase } from './editor/freshness.js';
import { setupLayoutsDialog } from './editor/layouts-dialog.js';
import { setupClipboard } from './editor/clipboard.js';
import { setupLock, isLocked } from './editor/lock.js';
import { setupNudge } from './editor/nudge.js';
import { setupAlign } from './editor/align.js';
import { createSnapSettings } from './editor/snapping.js';
import { findFreeSpot, bbox } from './editor/geometry.js';
import { createStore } from './editor/store.js';
import { openStorage, createSaver } from './editor/storage.js';
import { loadStartupLayout, checkSaved, newLayoutId, RECOVERY_KEY } from './editor/startup.js';
import { createRenderer } from './editor/render.js';

// Saves live in IndexedDB (see storage.js), one record per layout; startup.js
// picks the one this file opens with.
const notices=createNotices(document.getElementById('notices'));
const initialNode=document.getElementById('initial');
const embedded=normalizeLayout(JSON.parse(initialNode.textContent)).items||[];
const embeddedAt=initialNode.dataset.savedAt||null;
// ?storage=local forces the localStorage fallback (tests cover both paths).
const storage=await openStorage({prefer:new URLSearchParams(location.search).get('storage')});
document.documentElement.dataset.storage=storage.kind;
const startup=await loadStartupLayout({storage,initialNode,embedded,embeddedAt});
const {choice,saves,saved,storedAt,freshness}=startup;
/** @type {import('./types/layout').Item[]} */
let items=startup.items;
let {damagedSave,saveAtStart}=startup;
// The layout this file stands for; «Мои макеты» can switch the editor to another one.
const fileLayoutId=choice.layoutId;
let layoutId=fileLayoutId,layoutName=startup.layoutName;
let selected=null, activePage=1;

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
    layoutId=clean?newLayoutId():fileLayoutId;
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
  try{localStorage.setItem(RECOVERY_KEY,damagedSave.raw)}catch(e){console.warn('Could not keep a copy of the damaged layout (it can still be downloaded from the notice)',e)}
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
const store=createStore({get:()=>items,set:value=>{items=value},history,save:saveToStorage,render:()=>renderer.draw(),mark:item=>renderer.markRendered(item)});
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
/** @type {ReturnType<typeof setupLock> | null} */
let lock=null;
/** @type {ReturnType<typeof setupAlign> | null} */
let align=null;
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
  syncImageTools();syncBgTools();syncTextBoxTools();lock?.sync();align?.sync();notices.hide('locked');
}});
innerCanvas=createInnerCanvas({
  pages,store,mm,
  selectParent:id=>canvas.setSelection([id],id,{keepInner:true})
});
canvas.attachInner(innerCanvas);
setupNudge({canvas,innerCanvas,snapping});
align=setupAlign({canvas,innerCanvas});
{
  const toggle=document.getElementById('snapToggle'),grid=document.getElementById('snapGrid');
  // The grid is drawn faintly on the sheets while it is on (screen only, see styles.css).
  const stage=document.querySelector('.stage');
  const show=()=>{const s=snapping.get();toggle.checked=s.enabled;grid.value=String(s.gridMm);grid.disabled=!s.enabled;
    if(s.enabled&&s.gridMm>0)stage.dataset.grid=String(s.gridMm);else delete stage.dataset.grid};
  toggle.onchange=()=>snapping.set({enabled:toggle.checked});
  grid.onchange=()=>snapping.set({gridMm:Number(grid.value)});
  snapping.onChange(show);show();
}

const renderer=createRenderer({pages,getItems:()=>items,store,rich,
  startDrag:(event,id)=>canvas.startDrag(event,id),startBadgeDrag,
  afterDraw:()=>{canvas.afterDraw();innerCanvas.afterDraw();syncTextBoxTools();lock?.sync();align?.sync()}});
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
  // Copies start unlocked, so they can be put in place.
  const sources=list.map(o=>{const c={x:0,y:0,...structuredClone(o)};delete c.locked;return c}).sort((a,b)=>(a.z||0)-(b.z||0));
  const box=bbox(sources),spot=placeNew({w:box.w,h:box.h},wish);
  let z=Math.max(0,...items.filter(v=>v.page===activePage).map(v=>v.z||0));
  const added=sources.map(o=>({...o,x:o.x-box.x+spot.x,y:o.y-box.y+spot.y,z:++z,id:newId(),page:activePage}));
  store.change(items=>{items.push(...added)});
  canvas.setSelection(added.map(o=>o.id),added[0].id);
  return added;
}
/** @param {object} o @param {{x: number, y: number}} [wish] */
function addObject(o,wish){addObjects([o],wish)}
// Delete objects as one undo step. Locked ones stay, selected, with a notice
// that offers to unlock them (Delete, «Удалить» and cut all come here).
/** @param {string[]} ids */
function removeObjects(ids){
  const list=ids.map(id=>store.find(id)).filter(Boolean),kept=list.filter(isLocked).map(x=>x.id);
  const gone=new Set(list.filter(x=>!isLocked(x)).map(x=>x.id));
  if(gone.size){canvas.setSelection(kept);store.change(items=>items.filter(x=>!gone.has(x.id)));syncImageTools();syncBgTools()}
  if(kept.length)notices.show('locked',(kept.length>1?'Закреплённые объекты не удалены':'Закреплённый объект не удалён')+': закрепление защищает от случайного удаления и сдвига.',[
    {label:'Открепить',onClick:()=>{lock?.setLocked(kept,false);notices.hide('locked')}}
  ]);
  return gone.size;
}
function addCard(){addObject({kind:'card',w:91,h:23,title:'Новая способность',meta:'Тип · дистанция · длительность',detail:'Кликни, чтобы изменить описание.',level:'1',roles:'support',bg:'#ffffff'})}
setupObjects({addCard,addObject,addObjects,current,getSelectionIds,removeObjects,store});
({syncTextBoxTools}=setupTextBoxes({addObject,current,store}));
setupLayers({current,store,getSelected,getSelectionIds,select});
setupClipboard({store,getSelectionIds,addObjects,removeObjects});
lock=setupLock({store,getSelectionIds,current});
setupFiles({store,getSelectionIds,removeObjects,clearSelection,syncImageTools,syncBgTools,flushSave:()=>saver.flush(),identity:()=>({id:layoutId,name:layoutName})});
pages.forEach((p,i)=>p.addEventListener('pointerdown',e=>{if(e.target===p)activePage=i+1}));
try{renderer.draw()}catch(error){
  // Valid-looking data can still fail to render; recover the same way.
  if(!saved||freshness?.source!=='browser'||damagedSave)throw error;
  damagedSave={raw:JSON.stringify(saved.items),errors:[error.message]};saveAtStart=false;
  items=structuredClone(embedded);selected=null;
  history.reset();renderer.resetRender();renderer.draw();
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
