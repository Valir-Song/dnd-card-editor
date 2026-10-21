import { createHistory } from './editor/history.js';
import { createInteractions } from './editor/interactions.js';
import { setupCardBackground } from './editor/card-background.js';
import { setupImageTools } from './editor/image-tools.js';
import { setupLayers } from './editor/layers.js';
import { createRichText } from './editor/rich-text.js';
import { setupObjects } from './editor/objects.js';
import { setupFiles } from './editor/files.js';
import { setupToolbarTabs } from './editor/toolbar-tabs.js';
import { setupTextBoxes } from './editor/text-boxes.js';

// State and DOM rendering remain together to minimize v3 regressions.
const key='dnd-card-editor-v3';let items;
const embedded=JSON.parse(document.getElementById('initial').textContent);
try{const s=localStorage.getItem(key);items=s?JSON.parse(s):embedded}catch(e){items=embedded}
let selected=null, activePage=1;
items.forEach((v,i)=>{if(!Number.isFinite(v.z))v.z=i+1});

// Convert the old top-right default on saved cards; preserve manual positions.
let migratedBadges=false;
for(const item of items){
  if(item.kind==='card' && !item.badgeCustomPosition && item.badgeX===81.5 && item.badgeY===1.1){
    delete item.badgeX;delete item.badgeY;migratedBadges=true;
  }
}
if(migratedBadges){try{localStorage.setItem(key,JSON.stringify(items))}catch(e){console.warn('Could not save badge migration',e)}}

const pages=[document.getElementById('page1'),document.getElementById('page2')];
const mm=v=>v+'mm',esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function saveToStorage(){try{localStorage.setItem(key,JSON.stringify(items))}catch(e){console.warn('Storage limit exceeded: export HTML to save',e)}}
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
function persist(options){history.commit(options);saveToStorage()}
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
const getSelected=()=>selected,clearSelection=()=>{selected=null};
let syncTextBoxTools=()=>{};
const rich=createRichText({current,select,persist});
const {startDrag,startTextMove,startTextResize,startResize}=createInteractions({select,persist,mm});
const {syncBgTools}=setupCardBackground({current,persist,draw,getItems});
const {syncImageTools}=setupImageTools({current,persist});

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
  grip.addEventListener('pointerdown',ev=>startDrag(ev,item,e,false));
  e.append(grip);
}for(const f of ['title','subtitle','meta','detail'])if(item[f]!==undefined){const wrap=document.createElement('div');wrap.className='text-wrap';const pos=(item.textFrames||{})[f]||{};wrap.style.transform=`translate(${pos.x||0}mm, ${pos.y||0}mm)`;if(pos.w)wrap.style.width=mm(pos.w);if(pos.h)wrap.style.height=mm(pos.h);const d=document.createElement('div');setField(d,item,f);wrap.append(d);const grip=document.createElement('span');grip.className='text-grip';grip.title='Перетащить текстовый блок';grip.textContent='⠿';grip.addEventListener('pointerdown',ev=>startTextMove(ev,item,e,f,wrap));wrap.append(grip);const rh=document.createElement('span');rh.className='text-resize';rh.title='Изменить ширину и высоту текста';rh.addEventListener('pointerdown',ev=>startTextResize(ev,item,e,f,wrap));wrap.append(rh);e.append(wrap)}if(item.level){const badge=document.createElement('div');badge.className='level'+(item.level==='♪'?' item':'');badge.textContent=item.level;badge.contentEditable='true';badge.style.left=item.badgeX!==undefined?mm(item.badgeX):'';badge.style.top=item.badgeY!==undefined?mm(item.badgeY):'';badge.style.right=item.badgeX!==undefined?'auto':'';badge.style.bottom=item.badgeY!==undefined?'auto':'';badge.addEventListener('input',()=>{item.level=badge.textContent;persist({group:'badge:'+item.id})});badge.addEventListener('pointerdown',ev=>startDrag(ev,item,e,true,badge));e.append(badge)}const resize=document.createElement('div');resize.className='resize';resize.addEventListener('pointerdown',ev=>startResize(ev,item,e));e.append(resize);e.addEventListener('pointerdown',ev=>{if(ev.target.closest('.editable'))return;startDrag(ev,item,e,false)});pages[(item.page||1)-1].append(e)}pages.forEach((p,i)=>{const n=document.createElement('div');n.className='page-number';n.textContent=(i+1)+' / 2';p.append(n)});if(selected){const s=document.querySelector('.el[data-id="'+selected+'"]');if(s)s.classList.add('selected')}for(const entry of pendingEditors)rich.mount(entry.node,entry.item,entry.field);syncTextBoxTools()}
function select(e){document.querySelectorAll('.el.selected').forEach(x=>x.classList.remove('selected'));selected=e?.dataset.id||null;if(e){e.classList.add('selected');activePage=+(e.closest('.page')?.dataset.page||1);const c=current();if(c?.bg&&/^#[0-9a-f]{6}$/i.test(c.bg))document.getElementById('bg').value=c.bg;syncImageTools();syncBgTools();syncTextBoxTools()}}
function current(){return items.find(x=>x.id===selected)}function addObject(o){const obj={...o,z:Math.max(0,...items.filter(v=>v.page===activePage).map(v=>v.z||0))+1,id:'e'+Date.now()+Math.floor(Math.random()*10000),page:activePage};items.push(obj);persist();draw();select(document.querySelector('[data-id="'+obj.id+'"]'))}
function addCard(copy){const src=copy||{kind:'card',x:12,y:120,w:91,h:23,title:'Новая способность',meta:'Тип · дистанция · длительность',detail:'Измени описание двойным щелчком.',level:'1',roles:'support',bg:'#ffffff'};addObject({...structuredClone(src),x:Math.min(115,src.x+5),y:Math.min(270,src.y+5)})}
setupObjects({addCard,addObject,current,getItems,setItems,getSelected,clearSelection,persist,draw,syncImageTools,syncBgTools});
({syncTextBoxTools}=setupTextBoxes({addObject,current,persist,draw}));
setupLayers({current,getItems,getSelected,persist,draw,select});
setupFiles({getItems,setItems,getSelected,clearSelection,persist,draw,syncImageTools,syncBgTools});
pages.forEach((p,i)=>p.addEventListener('pointerdown',e=>{if(e.target===p)activePage=i+1}));
draw();
setupToolbarTabs();
