import { createHistory } from './editor/history.js';
import { createInteractions } from './editor/interactions.js';
import { setupCardBackground } from './editor/card-background.js';
import { setupImageTools } from './editor/image-tools.js';
import { setupLayers } from './editor/layers.js';
import { setupTextFormatting } from './editor/text-format.js';
import { setupObjects } from './editor/objects.js';
import { setupFiles } from './editor/files.js';

// State and DOM rendering remain together to minimize v3 regressions.
const key='dnd-card-editor-v3';let items;
const embedded=JSON.parse(document.getElementById('initial').textContent);
try{const s=localStorage.getItem(key);items=s?JSON.parse(s):embedded}catch(e){items=embedded}
let selected=null, activePage=1;
items.forEach((v,i)=>{if(!Number.isFinite(v.z))v.z=i+1});
// Legacy starter cards pinned the circle to the upper right. Switch those
// defaults to the lower-right anchor, without overriding manually moved badges.
let migratedBadges=false;
for(const item of items){
  if(item.kind==='card' && !item.badgeCustomPosition && item.badgeX===81.5 && item.badgeY===1.1){
    delete item.badgeX;delete item.badgeY;migratedBadges=true;
  }
}
if(migratedBadges){try{localStorage.setItem(key,JSON.stringify(items))}catch(e){console.warn('Could not persist badge migration',e)}}
const pages=[document.getElementById('page1'),document.getElementById('page2')];
const mm=v=>v+'mm',esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function saveToStorage(){try{localStorage.setItem(key,JSON.stringify(items))}catch(e){console.warn('Storage limit exceeded: export HTML to save',e)}}
const history=createHistory({read:()=>items,restore:restored=>{
  const focused=document.activeElement?.closest?.('.el');
  const editingField=document.activeElement?.classList?.contains('editable') ? document.activeElement.classList[0] : null;
  const editingId=focused?.dataset.id;
  items=restored;
  if(selected&&!items.some(item=>item.id===selected))selected=null;
  draw();syncImageTools();syncBgTools();saveToStorage();
  if(editingField&&editingId){
    const node=Array.from(document.querySelectorAll('.el')).find(e=>e.dataset.id===editingId)?.querySelector('.'+editingField+'.editable');
    if(node){node.focus();const range=document.createRange();range.selectNodeContents(node);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range)}
  }
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
  // The editor owns Undo/Redo even when focus remains in a toolbar input.
  // Otherwise browser-native text undo masks card history after pointer gestures.
  const key=event.key.toLowerCase();
  const action=(key==='z'&&!event.shiftKey)?'undo':((key==='z'&&event.shiftKey)||key==='y')?'redo':null;
  if(!action)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  navigateHistory(action);
},true);
const getItems=()=>items,setItems=value=>{items=value};
const getSelected=()=>selected,clearSelection=()=>{selected=null};
const {setFocusedEditor}=setupTextFormatting();
const {startDrag,startTextMove,startTextResize,startResize}=createInteractions({select,persist,mm});
const {syncBgTools}=setupCardBackground({current,persist,draw,getItems});
const {syncImageTools}=setupImageTools({current,persist});

function setField(node,item,f){node.className=f+' editable';node.contentEditable='true';node.spellcheck=false;node.innerHTML=item[f+'Html']!==undefined?item[f+'Html']:esc(item[f]||'').replace(/\n/g,'<br>');node.addEventListener('input',event=>{item[f+'Html']=node.innerHTML;item[f]=node.innerText;persist(event.detail?.history==='format'?undefined:{group:'text:'+item.id+':'+f})});node.addEventListener('focus',()=>{setFocusedEditor(node);select(node.closest('.el'))});node.addEventListener('pointerdown',ev=>{ev.stopPropagation();select(node.closest('.el'))});}
function draw(){pages.forEach(p=>p.replaceChildren());for(const item of items){const e=document.createElement('div');e.className='el '+(item.kind==='image'?'image-el':item.kind==='shape'?'shape '+(item.shape||'rect'):item.kind);e.dataset.id=item.id;e.style.zIndex=String(item.z||1);e.style.left=mm(item.x);e.style.top=mm(item.y);e.style.width=mm(item.w);e.style.height=mm(item.h);if(item.bg)e.style.backgroundColor=item.bg;if(item.kind==='card'&&item.bgImage){const bi=document.createElement('img');bi.className='card-bg-image';bi.src=item.bgImage;bi.draggable=false;bi.style.objectFit=item.bgFit||'cover';bi.style.opacity=(item.bgOpacity??100)/100;bi.style.transform=`translate(${item.bgX||0}%,${item.bgY||0}%) scale(${(item.bgZoom??100)/100})`;e.append(bi);const shade=document.createElement('div');shade.className='card-bg-shade';shade.style.opacity=(item.bgShade||0)/100;e.append(shade)}if(item.kind==='card'){/* Цветовые полосы отключены */}if(item.kind==='shape'){e.style.backgroundColor=item.bg||'#d8c5ed';if(item.shape==='line')e.style.height='2px'}if(item.kind==='image'){const im=document.createElement('img');im.src=item.src;im.draggable=false;im.style.objectFit=item.fit||'contain';im.style.filter=`brightness(${item.brightness??100}%) contrast(${item.contrast??100}%)`;im.style.transform=`rotate(${item.rotation||0}deg)`;e.style.opacity=(item.opacity??100)/100;e.append(im)}for(const f of ['title','subtitle','meta','detail'])if(item[f]!==undefined){const wrap=document.createElement('div');wrap.className='text-wrap';const pos=(item.textFrames||{})[f]||{};wrap.style.transform=`translate(${pos.x||0}mm, ${pos.y||0}mm)`;if(pos.w)wrap.style.width=mm(pos.w);if(pos.h)wrap.style.height=mm(pos.h);const d=document.createElement('div');setField(d,item,f);wrap.append(d);const grip=document.createElement('span');grip.className='text-grip';grip.title='Перетащить текстовый блок';grip.textContent='⠿';grip.addEventListener('pointerdown',ev=>startTextMove(ev,item,e,f,wrap));wrap.append(grip);const rh=document.createElement('span');rh.className='text-resize';rh.title='Изменить ширину и высоту текста';rh.addEventListener('pointerdown',ev=>startTextResize(ev,item,e,f,wrap));wrap.append(rh);e.append(wrap)}if(item.level){const badge=document.createElement('div');badge.className='level'+(item.level==='♪'?' item':'');badge.textContent=item.level;badge.contentEditable='true';badge.style.left=item.badgeX!==undefined?mm(item.badgeX):'';badge.style.top=item.badgeY!==undefined?mm(item.badgeY):'';badge.style.right=item.badgeX!==undefined?'auto':'';badge.addEventListener('input',()=>{item.level=badge.textContent;persist({group:'badge:'+item.id})});badge.addEventListener('pointerdown',ev=>startDrag(ev,item,e,true,badge));e.append(badge)}const resize=document.createElement('div');resize.className='resize';resize.addEventListener('pointerdown',ev=>startResize(ev,item,e));e.append(resize);e.addEventListener('pointerdown',ev=>{if(ev.target.closest('.editable'))return;startDrag(ev,item,e,false)});pages[(item.page||1)-1].append(e)}pages.forEach((p,i)=>{const n=document.createElement('div');n.className='page-number';n.textContent=(i+1)+' / 2';p.append(n)});if(selected){const s=document.querySelector('.el[data-id="'+selected+'"]');if(s)s.classList.add('selected')}}
function select(e){document.querySelectorAll('.el.selected').forEach(x=>x.classList.remove('selected'));selected=e?.dataset.id||null;if(e){e.classList.add('selected');activePage=+(e.closest('.page')?.dataset.page||1);const c=current();if(c?.bg&&/^#[0-9a-f]{6}$/i.test(c.bg))document.getElementById('bg').value=c.bg;syncImageTools();syncBgTools()}}
function current(){return items.find(x=>x.id===selected)}function addObject(o){const obj={...o,z:Math.max(0,...items.filter(v=>v.page===activePage).map(v=>v.z||0))+1,id:'e'+Date.now()+Math.floor(Math.random()*10000),page:activePage};items.push(obj);persist();draw();select(document.querySelector('[data-id="'+obj.id+'"]'))}
function addCard(copy){const src=copy||{kind:'card',x:12,y:120,w:91,h:23,title:'Новая способность',meta:'Тип · дистанция · длительность',detail:'Измени описание двойным щелчком.',level:'1',roles:'support',bg:'#ffffff'};addObject({...structuredClone(src),x:Math.min(115,src.x+5),y:Math.min(270,src.y+5)})}
setupObjects({addCard,addObject,current,getItems,setItems,getSelected,clearSelection,persist,draw,syncImageTools,syncBgTools});
setupLayers({current,getItems,getSelected,persist,draw,select});
setupFiles({getItems,setItems,getSelected,clearSelection,persist,draw,syncImageTools,syncBgTools});
pages.forEach((p,i)=>p.addEventListener('pointerdown',e=>{if(e.target===p)activePage=i+1}));
draw();
