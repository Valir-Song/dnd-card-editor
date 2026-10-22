// Layout validation shared by startup, JSON import and tests.
// A layout is accepted only if every object can be drawn on one of the A4 pages;
// small, unambiguous defects (missing id/page/z, duplicate ids) are repaired.
export const PAGE_COUNT=2;
export const KINDS=['header','note','resources','section','card','shape','image','textbox'];
const GEOMETRY=['x','y','w','h'];
const MAX_ERRORS=5;

export function normalizeLayout(data,{makeId=defaultId}={}){
  if(!Array.isArray(data))return {items:null,errors:['Файл должен содержать массив объектов макета.']};
  const errors=[],seen=new Set(),items=[];
  data.forEach((source,index)=>{
    const label='Объект №'+(index+1);
    if(!source||typeof source!=='object'||Array.isArray(source)){errors.push(label+': ожидается объект.');return}
    const item={...source};
    if(!KINDS.includes(item.kind))errors.push(label+': неизвестный тип «'+item.kind+'».');
    item.page=item.page??1;
    if(!Number.isInteger(item.page)||item.page<1||item.page>PAGE_COUNT)
      errors.push(label+': страница '+JSON.stringify(source.page)+', а в редакторе страниц '+PAGE_COUNT+'.');
    for(const key of GEOMETRY)if(!Number.isFinite(item[key]))errors.push(label+': поле «'+key+'» должно быть числом.');
    if(Number.isFinite(item.w)&&item.w<=0||Number.isFinite(item.h)&&item.h<=0)errors.push(label+': ширина и высота должны быть больше нуля.');
    if(typeof item.id!=='string'||!item.id||seen.has(item.id))item.id=makeId(seen);
    seen.add(item.id);
    if(!Number.isFinite(item.z))item.z=index+1;
    items.push(item);
  });
  if(errors.length>MAX_ERRORS)errors.splice(MAX_ERRORS,errors.length,'…и ещё ошибок: '+(errors.length-MAX_ERRORS)+'.');
  return errors.length?{items:null,errors}:{items,errors};
}

function defaultId(seen){
  let id;
  do id='e'+Date.now()+Math.floor(Math.random()*10000);while(seen.has(id));
  return id;
}
