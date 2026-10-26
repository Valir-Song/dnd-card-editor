// Rendering: one element per object, rebuilt only when that object changed.
// Only the store calls draw/markRendered (see store.js); everything else asks
// the store, so every redraw is also an undo step and a save.

import { outlineLook } from './borders.js';

/** @typedef {import('../types/layout').Item} Item */
/** @typedef {'title' | 'subtitle' | 'meta' | 'detail' | 'text'} Field */

import { isSheet, sheetOf, paintSheet } from './sheet.js';
import { isCharacter, findCharacter } from './character.js';
import { buildStats } from './stats-box.js';
import { buildHp, step, damage, heal, setHp, toggleDie, setDice, toggleSave, toggleDice, toggleSaves } from './hp.js';
import { pageCount } from './pages.js';
import { buildPools, toggleCell, changeCount, cycleRest, switchColumn, removePool, setPoolLabel } from './resources.js';

// Geometry that gestures already applied to the node: patch styles, never rebuild.
const GEOMETRY=['x','y','w','h','z','textFrames','badgeX','badgeY','badgeCustomPosition'];

/**
 * @param {{pages: HTMLElement[], getItems: () => Item[], store: import('../types/layout').Store,
 *   rich: {mount: (node: HTMLElement, item: Item, field: Field) => void, rebind: (id: string, item: Item) => void,
 *     unmount: (id: string) => void, destroy: () => void},
 *   startDrag: (event: PointerEvent, id: string) => void,
 *   startBadgeDrag: (event: PointerEvent, item: Item | undefined, element: HTMLElement, badge: HTMLElement, index: number | null) => void,
 *   afterDraw: () => void}} deps
 */
export function createRenderer({pages,getItems,store,rich,startDrag,startBadgeDrag,afterDraw}){
  /** @param {number} v */
  const mm=v=>v+'mm';
  /** @type {Array<{node: HTMLElement, item: Item, field: Field}>} */
  const pendingEditors=[];
  /** @param {HTMLElement} node @param {Item} item @param {Field} f */
  function setField(node,item,f){
    node.className=f+' editable'+(item.kind==='textbox'?' textbox-editor':'');
    node.dataset.field=f;
    pendingEditors.push({node,item,field:f});
  }
  /** @type {Map<string, {node: HTMLElement, snap: string}>} */
  const rendered=new Map();
  /** @param {string} id */
  const itemById=id=>getItems().find(x=>x.id===id);
  // A stats box shows the character's numbers: they are part of what it looks like.
  /** @param {Item} item */
  const view=item=>item.kind==='stats'?{...item,character:findCharacter(getItems())?.character}:item;
  /** @param {Item} item */
  const snapOf=item=>JSON.stringify(view(item));
  /** @param {Item} item */
  const withoutGeometry=item=>JSON.stringify(item,(k,v)=>GEOMETRY.includes(k)?undefined:v);
  // Text edited in Tiptap (or the badge) is already on screen: just record it.
  /** @param {Item} item */
  function markRendered(item){const r=rendered.get(item.id);if(r)r.snap=snapOf(item)}
  /** The element's classes: kind (or shape), lock, card look, theme. @param {Item} item */
  function elementClass(item){
    const kind=item.kind==='image'?'image-el':item.kind==='shape'?'shape '+(item.shape||'rect'):item.kind;
    const locked=item.locked?' locked':'';
    const look=item.kind==='card'&&(item.cardLook==='compact'||item.cardLook==='full')?' card-'+item.cardLook:'';
    const theme=/^[a-z-]+$/.test(item.theme??'')?' theme-'+item.theme:'';
    return 'el '+kind+locked+look+theme;
  }
  /** The frame drawn over the element's edge (borders.js). @param {HTMLElement} e @param {Item} item */
  function addOutline(e,item){
    const frame=outlineLook(item);
    if(!frame)return;
    e.classList.add(frame.className);
    e.style.setProperty('--o-width',frame.width);
    if(frame.color)e.style.setProperty('--o-color',frame.color);
  }
  /** Position and size on the sheet; a textbox or a line changes its height later. @param {HTMLElement} e @param {Item} item */
  function placeElement(e,item){
    e.style.zIndex=String(item.z||1);
    e.style.left=mm(item.x);
    e.style.top=mm(item.y);
    e.style.width=mm(item.w);
    e.style.height=mm(item.h);
  }
  /** A card's own picture, with a shade over it, under the texts. @param {HTMLElement} e @param {Item} item */
  function addCardBackground(e,item){
    if(!item.bgImage)return;
    const image=document.createElement('img');
    image.className='card-bg-image';
    image.src=item.bgImage;
    image.draggable=false;
    image.style.objectFit=item.bgFit||'cover';
    image.style.opacity=String((item.bgOpacity??100)/100);
    image.style.transform=`translate(${item.bgX||0}%,${item.bgY||0}%) scale(${(item.bgZoom??100)/100})`;
    e.append(image);
    const shade=document.createElement('div');
    shade.className='card-bg-shade';
    shade.style.opacity=String((item.bgShade||0)/100);
    e.append(shade);
  }
  /** @param {HTMLElement} e @param {Item} item */
  function styleShape(e,item){
    e.style.backgroundColor=item.bg||'#d8c5ed';
    if(item.shape==='line')e.style.height='2px';
  }
  /** @param {HTMLElement} e @param {Item} item */
  function addImage(e,item){
    const image=document.createElement('img');
    image.src=/** @type {string} */ (item.src);
    image.draggable=false;
    image.style.objectFit=item.fit||'contain';
    image.style.filter=`brightness(${item.brightness??100}%) contrast(${item.contrast??100}%)`;
    image.style.transform=`rotate(${item.rotation||0}deg)`;
    e.style.opacity=String((item.opacity??100)/100);
    e.append(image);
  }
  /** A text frame: one editor for its text, and a grip to drag it by. @param {HTMLElement} e @param {Item} item */
  function addTextbox(e,item){
    e.classList.toggle('auto-height',!!item.autoHeight);
    e.style.height=item.autoHeight?'auto':mm(item.h);
    e.style.maxHeight=item.autoHeight?mm(297-item.y):'';
    e.style.backgroundColor=item.bgTransparent?'transparent':(item.bg||'#ffffff');
    e.style.border=item.borderVisible?'1px solid '+(item.borderColor||'#745193'):'1px solid transparent';
    const content=document.createElement('div');
    setField(content,item,'text');
    content.style.fontFamily=item.fontFamily||'Georgia';
    content.style.fontSize=(item.fontSize||12)+'pt';
    content.style.fontWeight=item.textWeight||'normal';
    content.style.textAlign=item.textAlign||'left';
    content.style.color=item.textColor||'#262137';
    e.append(content);
    const grip=document.createElement('span');
    grip.className='textbox-move';
    grip.textContent='⠿';
    grip.title='Перетащить текстовую рамку';
    grip.addEventListener('pointerdown',ev=>startDrag(ev,item.id));
    e.append(grip);
  }
  /** Where a text sits inside its element (textFrames); also used by patchGeometry. @param {HTMLElement} wrap @param {import('../types/layout').Frame} pos */
  function placeTextFrame(wrap,pos){
    wrap.style.transform=`translate(${pos.x||0}mm, ${pos.y||0}mm)`;
    wrap.style.width=pos.w?mm(pos.w):'';
    wrap.style.height=pos.h?mm(pos.h):'';
    wrap.classList.toggle('sized',!!pos.h);
  }
  /** Card-style texts that are present, each in its own movable frame. @param {HTMLElement} e @param {Item} item */
  function addTextFields(e,item){
    for(const f of /** @type {const} */ (['title','subtitle','meta','detail'])){
      if(item[f]===undefined)continue;
      const wrap=document.createElement('div');
      wrap.className='text-wrap';
      wrap.dataset.field=f;
      placeTextFrame(wrap,(item.textFrames||{})[f]||{});
      const text=document.createElement('div');
      setField(text,item,f);
      wrap.append(text);
      e.append(wrap);
    }
  }
  /** A box's own controls (resources, stats, hit points) go right under its title. @param {HTMLElement} e @param {HTMLElement} body */
  function addBody(e,body){
    const title=e.querySelector(':scope > .text-wrap[data-field="title"]');
    if(title)title.after(body);
    else e.append(body);
  }
  // A card from the spell reference: «📖» opens its full text (spell-picker.js); never printed.
  /** @param {HTMLElement} e */
  function addSpellInfo(e){
    const info=document.createElement('button');
    info.type='button';
    info.className='spell-info';
    info.textContent='📖';
    info.title='Полное описание заклинания';
    info.setAttribute('aria-label',info.title);
    e.append(info);
  }
  /** The main badge sits in its corner unless it was moved (badgeX/badgeY). @param {HTMLElement} badge @param {Item} item */
  function placeMainBadge(badge,item){
    badge.style.left=item.badgeX!==undefined?mm(item.badgeX):'';
    badge.style.top=item.badgeY!==undefined?mm(item.badgeY):'';
    badge.style.right=item.badgeX!==undefined?'auto':'';
    badge.style.bottom=item.badgeY!==undefined?'auto':'';
  }
  /** The main badge (level) and the extra ones (badges). @param {HTMLElement} e @param {Item} item */
  function addBadges(e,item){
    if(item.level){
      const badge=makeBadge(e,item,item.level,item.badgeColor,null);
      placeMainBadge(badge,item);
      e.append(badge);
    }
    // More badges (3.11): placed by their own x/y; changing one rebuilds the element.
    (Array.isArray(item.badges)?item.badges:[]).forEach((b,i)=>{
      if(!b||typeof b!=='object')return;
      const badge=makeBadge(e,item,String(b.text??''),b.color,i);
      badge.classList.add('extra');
      badge.style.left=mm(Number(b.x)||0);
      badge.style.top=mm(Number(b.y)||0);
      badge.style.right='auto';
      badge.style.bottom='auto';
      e.append(badge);
    });
  }
  /**
   * A badge node: typing is recorded as shown, a press drags it.
   * @param {HTMLElement} e @param {Item} item @param {string} text @param {string | undefined} color
   * @param {number | null} index null for the main badge, else its place in badges
   */
  function makeBadge(e,item,text,color,index){
    const badge=document.createElement('div');
    badge.className='level'+(text==='♪'?' item':'');
    if(index!==null)badge.dataset.index=String(index);
    badge.textContent=text;
    badge.contentEditable='true';
    if(color)badge.style.background=color;
    badge.addEventListener('input',()=>{
      const it=itemById(item.id);
      if(!it)return;
      if(index===null)it.level=badge.textContent??'';
      else if(Array.isArray(it.badges)&&it.badges[index])it.badges[index].text=badge.textContent??'';
      store.shown(it,{group:'badge:'+it.id+':'+index});
    });
    badge.addEventListener('pointerdown',ev=>startBadgeDrag(ev,itemById(item.id),e,badge,index));
    return badge;
  }
  /** One object's element, its parts added bottom to top. @param {Item} item */
  function buildElement(item){
    const e=document.createElement('div');
    e.className=elementClass(item);
    addOutline(e,item);
    e.dataset.id=item.id;
    placeElement(e,item);
    if(item.bg&&item.kind!=='textbox')e.style.backgroundColor=item.bg;
    if(item.kind==='card')addCardBackground(e,item);
    if(item.kind==='shape')styleShape(e,item);
    if(item.kind==='image')addImage(e,item);
    if(item.kind==='textbox')addTextbox(e,item);
    addTextFields(e,item);
    // Resources rows: a press on them edits, never drags.
    if(item.kind==='resources'&&Array.isArray(item.pools))addBody(e,buildPools(item,poolActions(item.id)));
    if(item.kind==='stats')addBody(e,buildStats(item,getItems()));
    if(item.kind==='hp')addBody(e,buildHp(item,hpActions(item.id)));
    if(item.kind==='card'&&item.spellText)addSpellInfo(e);
    addBadges(e,item);
    return e;
  }
  /** What a click in the resources rows does. @param {string} id @returns {import('./resources.js').PoolActions} */
  function poolActions(id){
    /** @param {(item: Item) => void} edit */
    const change=edit=>{const it=itemById(id);if(it)store.change(()=>edit(it))};
    return {
      toggle:(i,cell)=>change(it=>toggleCell(it,i,cell)),
      count:(i,delta)=>change(it=>changeCount(it,i,delta)),
      rest:i=>change(it=>cycleRest(it,i)),
      column:i=>change(it=>switchColumn(it,i)),
      remove:i=>change(it=>removePool(it,i)),
      // Typing is already on screen: record it without rebuilding the box.
      label:(i,text)=>{const it=itemById(id);if(!it)return;setPoolLabel(it,i,text);store.shown(it,{group:'pool:'+id+':'+i})}
    };
  }
  /** What the controls of a hit points box do. @param {string} id @returns {import('./hp.js').HpActions} */
  function hpActions(id){
    /** @param {(item: Item) => void} edit */
    const change=edit=>{const it=itemById(id);if(it)store.change(()=>edit(it))};
    return {
      step:delta=>change(it=>step(it,delta)),
      damage:n=>change(it=>damage(it,n)),
      heal:n=>change(it=>heal(it,n)),
      set:(key,value)=>change(it=>setHp(it,key,value)),
      die:cell=>change(it=>toggleDie(it,cell)),
      dice:c=>change(it=>setDice(it,c)),
      save:(kind,cell)=>change(it=>toggleSave(it,kind,cell)),
      hide:row=>change(it=>row==='dice'?toggleDice(it,false):toggleSaves(it,false))
    };
  }
  /** @param {HTMLElement} e @param {Item} item */
  function patchGeometry(e,item){
    e.style.zIndex=String(item.z||1);e.style.left=mm(item.x);e.style.top=mm(item.y);e.style.width=mm(item.w);
    if(item.kind==='textbox'){e.style.height=item.autoHeight?'auto':mm(item.h);e.style.maxHeight=item.autoHeight?mm(297-item.y):''}
    else if(!(item.kind==='shape'&&item.shape==='line'))e.style.height=mm(item.h);
    for(const wrap of e.querySelectorAll(':scope > .text-wrap')){
      if(!(wrap instanceof HTMLElement))continue;
      placeTextFrame(wrap,(item.textFrames||{})[wrap.dataset.field??'']||{});
    }
    const badge=e.querySelector(':scope > .level:not(.extra)');
    if(badge instanceof HTMLElement)placeMainBadge(badge,item);
  }
  // 4.2: one .page per page of the layout; page N is always the Nth sheet on screen.
  /** @param {number} count */
  function addPages(count){
    while(pages.length<count){const n=pages.length+1,p=document.createElement('div');p.className='page';p.dataset.page=String(n);p.id='page'+n;pages[pages.length-1].after(p);pages.push(p)}
  }
  function draw(){
    pendingEditors.length=0;
    const count=pageCount(getItems());
    addPages(count);
    /** @type {Set<string>} */
    const seen=new Set();
    /** @type {Map<HTMLElement, HTMLElement>} */
    const last=new Map(); // page -> previous node, to keep DOM order = data order
    for(const item of getItems()){
      if(isSheet(item))continue; // drawn on the page itself, below
      if(isCharacter(item))continue; // stats are shown in their window, never on the sheet
      seen.add(item.id);
      const page=pages[(item.page||1)-1],snap=snapOf(item),r=rendered.get(item.id);
      // Gestures move nodes directly, so geometry is re-applied even when unchanged.
      if(r&&r.snap===snap){rich.rebind(item.id,item);patchGeometry(r.node,item)}
      else if(r&&withoutGeometry(view(item))===withoutGeometry(JSON.parse(r.snap))){rich.rebind(item.id,item);patchGeometry(r.node,item);r.snap=snap}
      else{
        if(r){rich.unmount(item.id);r.node.remove()}
        rendered.set(item.id,{node:buildElement(item),snap});
      }
      const node=/** @type {{node: HTMLElement}} */ (rendered.get(item.id)).node,prev=last.get(page);
      const wanted=prev?prev.nextSibling:page.firstChild;
      if(node!==wanted)page.insertBefore(node,wanted);
      last.set(page,node);
    }
    pages.forEach((p,i)=>paintSheet(p,sheetOf(getItems(),i+1)));
    for(const [id,r] of rendered)if(!seen.has(id)){rich.unmount(id);r.node.remove();rendered.delete(id)}
    while(pages.length>count)pages.pop()?.remove();
    pages.forEach((p,i)=>{let n=p.querySelector(':scope > .page-number');if(!n){n=document.createElement('div');n.className='page-number';p.append(n)}n.textContent=(i+1)+' / '+count});
    for(const entry of pendingEditors)rich.mount(entry.node,entry.item,entry.field);
    afterDraw()}
  // Throw away every element and editor (recovery paths, before replacing all data).
  function resetRender(){rich.destroy();for(const r of rendered.values())r.node.remove();rendered.clear()}
  return {draw,markRendered,resetRender};
}
