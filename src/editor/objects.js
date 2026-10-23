// Shape/card tools and image uploads.
import { target } from './dom.js';
import { readCompressed, loadImage } from './images.js';
/** @param {import('../types/layout').Deps} deps */
export function setupObjects({ addCard, addObject, current, getSelectionIds, clearSelection, store, syncImageTools, syncBgTools }) {
document.getElementById('add').onclick=()=>addCard();document.getElementById('duplicate').onclick=()=>{const c=current();if(c)addCard(c)};document.getElementById('delete').onclick=()=>{if(!getSelectionIds().length)return;const deleted=new Set(getSelectionIds());clearSelection();store.change(items=>items.filter(x=>!deleted.has(x.id)));syncImageTools();syncBgTools()};document.getElementById('bg').oninput=e=>{const c=current();if(!c)return;c.bg=target(e).value;document.querySelector('.el.selected').style.backgroundColor=c.bg;store.shown(c,{group:'color:'+c.id,windowMs:1200})};
document.getElementById('rect').onclick=()=>addObject({kind:'shape',shape:'rect',w:35,h:22,bg:'#d8c5ed'});document.getElementById('circle').onclick=()=>addObject({kind:'shape',shape:'circle',w:25,h:25,bg:'#d8c5ed'});document.getElementById('line').onclick=()=>addObject({kind:'shape',shape:'line',w:55,h:2,bg:'#8e6eb0'});
// Pictures are shrunk before they enter the layout (see images.js).
async function addImage(file){if(!file||!file.type.startsWith('image/'))return;try{const src=await readCompressed(file),img=await loadImage(src);const w=55,h=Math.min(80,55*img.naturalHeight/img.naturalWidth);addObject({kind:'image',src,w,h})}catch(err){alert('Картинку не удалось добавить: '+err.message)}}
document.getElementById('upload').onchange=e=>{addImage(target(e).files[0]);target(e).value=''};
document.addEventListener('paste',e=>{const file=[...(e.clipboardData?.items||[])].find(x=>x.type.startsWith('image/'));if(file){e.preventDefault();addImage(file.getAsFile())}});
}
