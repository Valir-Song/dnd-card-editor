// Shape/card tools and image uploads.
import { target } from './dom.js';
/** @param {import('../types/layout').Deps} deps */
export function setupObjects({ addCard, addObject, current, getSelectionIds, clearSelection, store, syncImageTools, syncBgTools }) {
document.getElementById('add').onclick=()=>addCard();document.getElementById('duplicate').onclick=()=>{const c=current();if(c)addCard(c)};document.getElementById('delete').onclick=()=>{if(!getSelectionIds().length)return;const deleted=new Set(getSelectionIds());clearSelection();store.change(items=>items.filter(x=>!deleted.has(x.id)));syncImageTools();syncBgTools()};document.getElementById('bg').oninput=e=>{const c=current();if(!c)return;c.bg=target(e).value;document.querySelector('.el.selected').style.backgroundColor=c.bg;store.shown(c,{group:'color:'+c.id,windowMs:1200})};
document.getElementById('rect').onclick=()=>addObject({kind:'shape',shape:'rect',x:35,y:110,w:35,h:22,bg:'#d8c5ed'});document.getElementById('circle').onclick=()=>addObject({kind:'shape',shape:'circle',x:35,y:110,w:25,h:25,bg:'#d8c5ed'});document.getElementById('line').onclick=()=>addObject({kind:'shape',shape:'line',x:35,y:110,w:55,h:2,bg:'#8e6eb0'});
function addImage(file){if(!file||!file.type.startsWith('image/'))return;const reader=new FileReader();reader.onload=()=>{const src=String(reader.result),img=new Image();img.onload=()=>{let w=55,h=Math.min(80,55*img.height/img.width);addObject({kind:'image',src,x:75,y:110,w,h})};img.src=src};reader.readAsDataURL(file)}
document.getElementById('upload').onchange=e=>{addImage(target(e).files[0]);target(e).value=''};
document.addEventListener('paste',e=>{const file=[...(e.clipboardData?.items||[])].find(x=>x.type.startsWith('image/'));if(file){e.preventDefault();addImage(file.getAsFile())}});
}
