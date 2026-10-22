// Which layout to open when the browser already holds a save.
// Chrome shares one localStorage between ALL local HTML files, so a newer
// downloaded editor would otherwise always show whatever was saved last.
// Exported files carry their export time; saves carry their save time.
export function chooseStartupLayout({storedItems,storedAt,embeddedItems,embeddedAt}){
  if(!storedItems)return {source:'file',conflict:false};
  if(JSON.stringify(storedItems)===JSON.stringify(embeddedItems))return {source:'browser',conflict:false};
  // A release/template file has no export time: keep the user's own work.
  if(!embeddedAt)return {source:'browser',conflict:false};
  const fileTime=Date.parse(embeddedAt),browserTime=Date.parse(storedAt);
  if(!Number.isFinite(browserTime)||fileTime>browserTime)return {source:'file',conflict:true};
  return {source:'browser',conflict:true};
}

export function formatStamp(iso){
  const time=Date.parse(iso);
  return Number.isFinite(time)?new Date(time).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}):'дата неизвестна';
}
