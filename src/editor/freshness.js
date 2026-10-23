// Which layout to open when the browser already holds a save.
// Chrome shares one localStorage between ALL local HTML files, so a newer
// downloaded editor would otherwise always show whatever was saved last.
// Exported files carry their export time; saves carry their save time.
/**
 * @param {{storedItems: unknown[] | null, storedAt: string | null, embeddedItems: unknown[], embeddedAt: string | null}} layouts
 * @returns {{source: 'file' | 'browser', conflict: boolean}}
 */
export function chooseStartupLayout({storedItems,storedAt,embeddedItems,embeddedAt}){
  if(!storedItems)return {source:'file',conflict:false};
  if(JSON.stringify(storedItems)===JSON.stringify(embeddedItems))return {source:'browser',conflict:false};
  // A release/template file has no export time: keep the user's own work.
  if(!embeddedAt)return {source:'browser',conflict:false};
  const fileTime=Date.parse(embeddedAt),browserTime=Date.parse(storedAt??''); // no save time → NaN → the file wins
  if(!Number.isFinite(browserTime)||fileTime>browserTime)return {source:'file',conflict:true};
  return {source:'browser',conflict:true};
}

/** @param {string | null} iso */
export function formatStamp(iso){
  const time=Date.parse(iso??'');
  return Number.isFinite(time)?new Date(time).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}):'дата неизвестна';
}

/** Short stable fingerprint of a text (FNV-1a, 32 bit) as hex. @param {string} text */
export function hashText(text){
  let hash=0x811c9dc5;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,0x01000193)>>>0}
  return hash.toString(16).padStart(8,'0');
}

// Ids with ':' are kept copies (e.g. 'L:previous'), never the save a file continues.
/** @param {string} id */
export const isCopy=id=>id.includes(':');

/**
 * Which saved layout this file continues. Files exported by 3.9+ carry their id.
 * Files exported by 3.3–3.8 carry only an export time: their id is derived from
 * their content, so every opening finds the same save. A clean editor file
 * (release or template) has neither and continues the most recently saved layout,
 * so updating the editor never hides the user's work.
 * @param {{fileId: string | null, fileAt: string | null, fileText: string,
 *   saves: import('../types/storage').LayoutMeta[], newId: () => string}} input
 * @returns {{layoutId: string, hasSave: boolean, newer: import('../types/storage').LayoutMeta | null}}
 *   newer — for a 3.3–3.8 file without a save of its own: a save made after the
 *   file was exported (the old editors kept all work in one save, so it may be there).
 */
export function chooseLayout({fileId,fileAt,fileText,saves,newId}){
  const own=saves.filter(save=>!isCopy(save.id));
  /** @type {import('../types/storage').LayoutMeta | null} */
  let latest=null;
  for(const save of own)if(!latest||Date.parse(save.savedAt)>Date.parse(latest.savedAt))latest=save;
  if(!fileId&&!fileAt)return latest?{layoutId:latest.id,hasSave:true,newer:null}:{layoutId:newId(),hasSave:false,newer:null};
  const layoutId=fileId||'f-'+hashText(fileText+fileAt);
  const hasSave=own.some(save=>save.id===layoutId);
  const newer=!fileId&&!hasSave&&latest&&Date.parse(latest.savedAt)>Date.parse(fileAt??'')?latest:null;
  return {layoutId,hasSave,newer};
}

/** Name for a layout without one: the sheet's heading, if any. @param {Array<{kind: string, title?: string}>} items */
export function layoutTitle(items){
  const heading=items.find(item=>item.kind==='header'&&item.title?.trim());
  return heading?.title?.trim().replace(/\s+/g,' ').slice(0,60)||'Макет без названия';
}

/** Download name stem for a layout: its name in letters and digits, or the editor's name. @param {string} name */
export function fileBase(name){
  const stem=name==='Макет без названия'?'':name.replace(/[^\p{L}\p{N}]+/gu,'_').replace(/^_+|_+$/g,'').slice(0,40);
  return stem||'DND_Card_Editor';
}
