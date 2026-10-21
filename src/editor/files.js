// Persistence, import/export, and delete shortcuts.
export function setupFiles({ getItems, setItems, getSelected, getSelectionIds, clearSelection, persist, draw, syncImageTools, syncBgTools }) {
// Snapshot unmodified source DOM once, before dynamic panels and Tiptap mount.
// Exporting the live DOM would serialize editor internals and break reloading.
const pristine=document.documentElement.cloneNode(true);
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000)}
document.getElementById('save').onclick=()=>{persist();alert('Сохранено в браузере. Для надёжного переноса нажми «Скачать HTML».')};
document.getElementById('export').onclick=()=>{persist();const doc=pristine.cloneNode(true);// Rebuild tab listeners when a downloaded copy opens again.
// The pristine source already contains original toolbar nodes.
for(const id of ['cardBgTools','imageTools']){const node=doc.querySelector('#'+id);if(node)node.style.display='none'}
for(const id of ['undo','redo']){const node=doc.querySelector('#'+id);if(node)node.disabled=true}
doc.querySelector('#initial').textContent=JSON.stringify(getItems()).replace(/</g,'\\u003c');doc.querySelectorAll('.page').forEach(p=>p.replaceChildren());download('DND_Card_Editor_3_2_Stable.html','<!doctype html>\n'+doc.outerHTML,'text/html;charset=utf-8')};
document.getElementById('json').onclick=()=>download('Ричард_макет_2.json',JSON.stringify(getItems(),null,2),'application/json');
document.getElementById('import').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data))throw Error('Нужен массив элементов');setItems(data);clearSelection();persist();draw();syncImageTools();syncBgTools()}catch(err){alert('Ошибка: '+err.message)}finally{e.target.value=''}};
document.getElementById('print').onclick=()=>window.print();
document.addEventListener('keydown',e=>{if((e.key==='Delete'||e.key==='Backspace')&&getSelectionIds().length&&!e.target.isContentEditable&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){const deleted=new Set(getSelectionIds());setItems(getItems().filter(x=>!deleted.has(x.id)));clearSelection();persist();draw();syncImageTools();syncBgTools()}});
}
