// Persistence, import/export, and delete shortcuts.
import { normalizeLayout } from './layout.js';
export function setupFiles({ store, getSelectionIds, clearSelection, syncImageTools, syncBgTools }) {
// Snapshot unmodified source DOM once, before dynamic panels and Tiptap mount.
// Exporting the live DOM would serialize editor internals and break reloading.
const pristine=document.documentElement.cloneNode(true);
// The gesture layers are attached while the editor starts, before this snapshot. Strip them so each exported generation
// starts from the same clean markup instead of accumulating stale copies.
const RUNTIME_NODES='.gesture-layer, #notices > *';
function cleanExport(doc){doc.querySelectorAll(RUNTIME_NODES).forEach(node=>node.remove());return doc}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000)}
document.getElementById('save').onclick=()=>{alert(store.commit()?'Сохранено в браузере. Для надёжного переноса нажми «Скачать HTML».':'Не удалось сохранить в браузере: макет не помещается в хранилище. Нажми «Скачать HTML» или «JSON», чтобы не потерять работу.')};
document.getElementById('export').onclick=()=>{store.commit();const doc=cleanExport(pristine.cloneNode(true));// Rebuild tab listeners when a downloaded copy opens again.
// The pristine source already contains original toolbar nodes.
for(const id of ['cardBgTools','imageTools']){const node=doc.querySelector('#'+id);if(node)node.style.display='none'}
for(const id of ['undo','redo']){const node=doc.querySelector('#'+id);if(node)node.disabled=true}
const initial=doc.querySelector('#initial');initial.textContent=JSON.stringify(store.items).replace(/</g,'\\u003c');initial.dataset.savedAt=new Date().toISOString();doc.querySelectorAll('.page').forEach(p=>p.replaceChildren());const version=(doc.querySelector('meta[name="editor-version"]')?.content||'3').replace(/[^0-9a-z]+/gi,'_');download('DND_Card_Editor_'+version+'.html','<!doctype html>\n'+doc.outerHTML,'text/html;charset=utf-8')};
document.getElementById('json').onclick=()=>download('Ричард_макет_2.json',JSON.stringify(store.items,null,2),'application/json');
// Validate and render an imported layout before it replaces the current one or
// reaches localStorage; a bad file must leave the editor exactly as it was.
document.getElementById('import').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{
  let data;
  try{data=JSON.parse(await f.text())}catch(err){throw Error('Файл не является корректным JSON.')}
  const {items,errors}=normalizeLayout(data);
  if(!items)throw Error(errors.join('\n'));
  const previous=store.items;
  clearSelection();
  // A layout that fails to render is neither recorded nor saved; put the old one back.
  try{store.change(()=>items)}catch(err){store.replace(previous);store.render();throw Error('Макет не удалось отрисовать: '+err.message)}
  syncImageTools();syncBgTools()
}catch(err){alert('Импорт отменён, текущий макет не изменён.\n\n'+err.message)}finally{e.target.value=''}};
document.getElementById('print').onclick=()=>window.print();
document.addEventListener('keydown',e=>{if((e.key==='Delete'||e.key==='Backspace')&&getSelectionIds().length&&!e.target.isContentEditable&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){const deleted=new Set(getSelectionIds());clearSelection();store.change(items=>items.filter(x=>!deleted.has(x.id)));syncImageTools();syncBgTools()}});
}
