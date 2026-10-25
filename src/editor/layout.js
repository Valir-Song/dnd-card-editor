// Layout validation shared by startup, JSON import and tests.
// A layout is accepted only if every object can be drawn on one of the A4 pages;
// small, unambiguous defects (missing id/page/z, duplicate ids) are repaired.
import { migrateResources } from './resources.js';
import { MAX_PAGES } from './pages.js';

export const KINDS=['header','note','resources','section','card','shape','image','textbox','sheet'];
const GEOMETRY=['x','y','w','h'];
const MAX_ERRORS=5;

// Version of the layout format. A bare array (every editor up to 3.11.0 beta.12) is
// version 1; since beta.13 JSON files, saves and the clipboard say {formatVersion, items}.
// A change to the meaning of a field adds a step to MIGRATIONS and raises the version;
// an editor refuses a newer version instead of guessing (it would lose fields).
export const FORMAT_VERSION=3;
export const FORMAT_MARK='dnd-card-editor/layout';

/** @typedef {Record<string, any>} RawItem */
/**
 * MIGRATIONS[n] turns one object of version n into version n+1, in place;
 * true when it changed something (the result is then saved at once).
 * @type {Record<number, (item: RawItem) => boolean>}
 */
export const MIGRATIONS={
  // 1 → 2: up to 3.4 the card badge sat top right at 81.5/1.1 mm; now that spot is the
  // default (no fields). A badge moved by hand keeps its place (badgeCustomPosition).
  1:item=>{
    if(item.kind!=='card'||item.badgeCustomPosition||item.badgeX!==81.5||item.badgeY!==1.1)return false;
    delete item.badgeX;delete item.badgeY;return true;
  },
  // 2 → 3: resources typed as «Ячейки 1: □ □ □» become rows of boxes (resources.js).
  2:migrateResources
};

/**
 * The layout as a file stores it: the format version, then the objects.
 * @param {import('../types/layout').Item[]} items
 * @param {Record<string, unknown>} [about] name, time, editor version: for people reading the file
 */
export const wrapLayout=(items,about={})=>({format:FORMAT_MARK,formatVersion:FORMAT_VERSION,...about,items});

/**
 * Objects and format version of stored data: a bare array is version 1.
 * @param {unknown} data
 * @returns {{list: any[], version: number} | {list: null, error: string}}
 */
export function unwrapLayout(data){
  if(Array.isArray(data))return {list:data,version:1};
  const wrapped=/** @type {{formatVersion?: unknown, items?: unknown}} */ (data&&typeof data==='object'?data:{});
  const version=wrapped.formatVersion;
  if(!Array.isArray(wrapped.items)||typeof version!=='number')return {list:null,error:'Файл должен содержать массив объектов макета.'};
  if(!Number.isInteger(version)||version<1)return {list:null,error:'Неизвестная версия формата макета: '+JSON.stringify(version)+'.'};
  if(version>FORMAT_VERSION)return {list:null,error:'Макет сохранён более новой версией редактора (формат '+version+', этот редактор понимает до '+FORMAT_VERSION+'). Откройте его в новой версии редактора.'};
  return {list:wrapped.items,version};
}

/**
 * @param {unknown} data parsed JSON from a file, the browser save or the template:
 *   a bare array (format 1) or {formatVersion, items}; older formats are migrated
 * @param {{makeId?: (seen: Set<string>) => string, migrations?: Record<number, (item: RawItem) => boolean>, latest?: number}} [options]
 * @returns {{items: import('../types/layout').Item[], errors: string[], migrated: boolean} | {items: null, errors: string[], migrated: false}}
 */
export function normalizeLayout(data,{makeId=defaultId,migrations=MIGRATIONS,latest=FORMAT_VERSION}={}){
  const unwrapped=unwrapLayout(data);
  if('error' in unwrapped)return {items:null,errors:[unwrapped.error],migrated:false};
  // Migrate copies (never the caller's objects), then check the result like any layout.
  let migrated=false;
  const from=unwrapped.version;
  const list=unwrapped.list.map(source=>{
    if(!source||typeof source!=='object'||Array.isArray(source))return source;
    const item={...source};
    for(let version=from;version<latest;version++)if(migrations[version]?.(item))migrated=true;
    return item;
  });
  /** @type {string[]} */
  const errors=[];
  /** @type {Set<string>} */
  const seen=new Set();
  /** @type {import('../types/layout').Item[]} */
  const items=[];
  list.forEach((source,index)=>{
    const label='Объект №'+(index+1);
    if(!source||typeof source!=='object'||Array.isArray(source)){errors.push(label+': ожидается объект.');return}
    const item={...source};
    if(!KINDS.includes(item.kind))errors.push(label+': неизвестный тип «'+item.kind+'».');
    item.page=item.page??1;
    if(!Number.isInteger(item.page)||item.page<1||item.page>MAX_PAGES)
      errors.push(label+': страница '+JSON.stringify(source.page)+', а листов в макете не больше '+MAX_PAGES+'.');
    for(const key of GEOMETRY)if(!Number.isFinite(item[key]))errors.push(label+': поле «'+key+'» должно быть числом.');
    if(Number.isFinite(item.w)&&item.w<=0||Number.isFinite(item.h)&&item.h<=0)errors.push(label+': ширина и высота должны быть больше нуля.');
    if(typeof item.id!=='string'||!item.id||seen.has(item.id))item.id=makeId(seen);
    seen.add(item.id);
    if(!Number.isFinite(item.z))item.z=index+1;
    items.push(item);
  });
  if(errors.length>MAX_ERRORS)errors.splice(MAX_ERRORS,errors.length,'…и ещё ошибок: '+(errors.length-MAX_ERRORS)+'.');
  return errors.length?{items:null,errors,migrated:false}:{items,errors,migrated};
}

/** @param {Set<string>} seen */
function defaultId(seen){
  let id;
  do id='e'+Date.now()+Math.floor(Math.random()*10000);while(seen.has(id));
  return id;
}
