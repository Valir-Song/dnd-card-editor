// Shape/card tools and image uploads.
import { target, errorText } from './dom.js';
import { readCompressed, loadImage } from './images.js';
import { bbox } from './geometry.js';
/** @typedef {import('../types/layout').Item} Item */
/** @param {import('../types/layout').Deps<'addCard' | 'addObject' | 'addObjects' | 'current' | 'getSelectionIds' | 'removeObjects'>} deps */
export function setupObjects({ addCard, addObject, addObjects, current, getSelectionIds, removeObjects, store }) {
// The selection, or the one selected object (a text of a card means its card).
const selection=()=>{const ids=getSelectionIds(),one=current();return ids.length?ids:one?[one.id]:[]};
const selectedItems=()=>selection().map(id=>store.find(id)).filter(/** @returns {item is Item} */ item=>!!item);
document.getElementById('add').onclick=()=>addCard();// The whole selection is copied, laid out as before, right under itself (or in the nearest free spot).
document.getElementById('duplicate').onclick=()=>{const list=selectedItems();if(!list.length)return;const box=bbox(list);addObjects(list,{x:box.x,y:box.y+box.h+2})};document.getElementById('delete').onclick=()=>{if(getSelectionIds().length)removeObjects(getSelectionIds())};document.getElementById('bg').oninput=e=>{const ids=selection(),list=selectedItems();if(!list.length)return;const color=target(e).value;for(const c of list){c.bg=color;const node=document.querySelector('.el[data-id="'+c.id+'"]');if(node)node.style.backgroundColor=color}store.shown(list,{group:'color:'+ids.join(','),windowMs:1200})};
document.getElementById('rect').onclick=()=>addObject({kind:'shape',shape:'rect',w:35,h:22,bg:'#d8c5ed'});document.getElementById('circle').onclick=()=>addObject({kind:'shape',shape:'circle',w:25,h:25,bg:'#d8c5ed'});document.getElementById('line').onclick=()=>addObject({kind:'shape',shape:'line',w:55,h:2,bg:'#8e6eb0'});
// Pictures are shrunk before they enter the layout (see images.js).
/** @param {File | null | undefined} file */
async function addImage(file){if(!file||!file.type.startsWith('image/'))return;try{const src=await readCompressed(file),img=await loadImage(src);const w=55,h=Math.min(80,55*img.naturalHeight/img.naturalWidth);addObject({kind:'image',src,w,h})}catch(err){alert('Картинку не удалось добавить: '+errorText(err))}}
document.getElementById('upload').onchange=e=>{addImage(target(e).files?.[0]);target(e).value=''};
document.addEventListener('paste',e=>{const file=[...(e.clipboardData?.items||[])].find(x=>x.type.startsWith('image/'));if(file){e.preventDefault();addImage(file.getAsFile())}});
}
