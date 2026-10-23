// Persistence, import/export, and delete shortcuts.
import { target } from './dom.js';
import { compressImage } from './images.js';
import { fileBase } from './freshness.js';
import { normalizeLayout } from './layout.js';
/** @param {import('../types/layout').Deps} deps */
export function setupFiles({ store, getSelectionIds, removeObjects, clearSelection, syncImageTools, syncBgTools, flushSave, identity }) {
// Snapshot unmodified source DOM once, before dynamic panels and Tiptap mount.
// Exporting the live DOM would serialize editor internals and break reloading.
const pristine=document.documentElement.cloneNode(true);
// The gesture layers are attached while the editor starts, before this snapshot. Strip them so each exported generation
// starts from the same clean markup instead of accumulating stale copies.
const RUNTIME_NODES='.gesture-layer, #notices > *';
function cleanExport(doc){doc.querySelectorAll(RUNTIME_NODES).forEach(node=>node.remove());doc.querySelector('.stage')?.removeAttribute('data-grid');return doc}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000)}
document.getElementById('save').onclick=async()=>{store.commit();alert(await flushSave()?'Сохранено в браузере. Для надёжного переноса нажми «Скачать HTML».':'Не удалось сохранить в браузере: макет не помещается в хранилище. Нажми «Скачать HTML» или «JSON», чтобы не потерять работу.')};
document.getElementById('export').onclick=()=>{store.commit();const doc=cleanExport(pristine.cloneNode(true));// Rebuild tab listeners when a downloaded copy opens again.
// The pristine source already contains original toolbar nodes.
for(const id of ['cardBgTools','imageTools']){const node=doc.querySelector('#'+id);if(node)node.style.display='none'}
for(const id of ['undo','redo']){const node=doc.querySelector('#'+id);if(node)node.disabled=true}
const initial=doc.querySelector('#initial');initial.textContent=JSON.stringify(store.items).replace(/</g,'\\u003c');initial.dataset.savedAt=new Date().toISOString();const {id,name}=identity();initial.dataset.layoutId=id;initial.dataset.layoutName=name;doc.querySelectorAll('.page').forEach(p=>p.replaceChildren());const version=(doc.querySelector('meta[name="editor-version"]')?.content||'3').replace(/[^0-9a-z]+/gi,'_');download(fileBase(identity().name)+'_'+version+'.html','<!doctype html>\n'+doc.outerHTML,'text/html;charset=utf-8')};
document.getElementById('json').onclick=()=>download(fileBase(identity().name)+'.json',JSON.stringify(store.items,null,2),'application/json');
// Validate and render an imported layout before it replaces the current one or
// reaches localStorage; a bad file must leave the editor exactly as it was.
document.getElementById('import').onchange=async e=>{const f=target(e).files[0];if(!f)return;try{
  let data;
  try{data=JSON.parse(await f.text())}catch(err){throw Error('Файл не является корректным JSON.')}
  const {items,errors}=normalizeLayout(data);
  if(!items)throw Error(errors.join('\n'));
  const previous=store.items;
  clearSelection();
  // A layout that fails to render is neither recorded nor saved; put the old one back.
  try{store.change(()=>items)}catch(err){store.replace(previous);store.render();throw Error('Макет не удалось отрисовать: '+err.message)}
  syncImageTools();syncBgTools()
}catch(err){alert('Импорт отменён, текущий макет не изменён.\n\n'+err.message)}finally{target(e).value=''}};
document.getElementById('print').onclick=()=>window.print();
// Shrink pictures that entered the layout before upload compression existed.
const compressButton=document.getElementById('compressImages');
compressButton.onclick=async()=>{
  const fields=['src','bgImage'],shrunk=new Map();
  const pictures=new Set(store.items.flatMap(item=>fields.map(f=>item[f]).filter(v=>typeof v==='string'&&v.startsWith('data:image/'))));
  if(!pictures.size){alert('В макете нет загруженных картинок.');return}
  const label=compressButton.textContent;compressButton.disabled=true;compressButton.textContent='Сжимаю…';
  try{for(const src of pictures)shrunk.set(src,await compressImage(src).catch(()=>src))}
  finally{compressButton.disabled=false;compressButton.textContent=label}
  const mb=n=>(n*0.75/1048576).toFixed(1).replace('.',',')+' МБ'; // base64 → bytes
  const before=[...pictures].reduce((s,p)=>s+p.length,0),after=[...shrunk.values()].reduce((s,p)=>s+p.length,0);
  if(after>=before){alert('Картинки уже сжаты: '+mb(before)+'.');return}
  store.change(items=>{for(const item of items)for(const f of fields)if(shrunk.has(item[f]))item[f]=shrunk.get(item[f])});
  alert('Картинки сжаты: было '+mb(before)+', стало '+mb(after)+'. Ctrl+Z вернёт прежние.');
};
document.addEventListener('keydown',e=>{if((e.key==='Delete'||e.key==='Backspace')&&getSelectionIds().length&&!target(e).isContentEditable&&!['INPUT','TEXTAREA','SELECT'].includes(target(e).tagName))removeObjects(getSelectionIds())});
}
