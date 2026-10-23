// Stack order within pages.
/**
 * New bottom-to-top order after moving the chosen objects one step or all the
 * way up or down. A group keeps its own internal order; «forward»/«backward»
 * move each chosen object past its unchosen neighbour, as in drawing programs.
 * @template T
 * @param {T[]} order bottom to top
 * @param {Set<T>} chosen
 * @param {'front' | 'back' | 'forward' | 'backward'} mode
 * @returns {T[]}
 */
export function reorderLayers(order,chosen,mode){
  const picked=order.filter(v=>chosen.has(v)),rest=order.filter(v=>!chosen.has(v));
  if(mode==='front')return [...rest,...picked];
  if(mode==='back')return [...picked,...rest];
  const next=order.slice();
  if(mode==='forward'){for(let i=next.length-2;i>=0;i--)if(chosen.has(next[i])&&!chosen.has(next[i+1]))[next[i],next[i+1]]=[next[i+1],next[i]]}
  else for(let i=1;i<next.length;i++)if(chosen.has(next[i])&&!chosen.has(next[i-1]))[next[i],next[i-1]]=[next[i-1],next[i]];
  return next;
}
/** @param {import('../types/layout').Deps & {current: () => import('../types/layout').Item | undefined, getSelectionIds: () => string[]}} deps */
export function setupLayers({ current, store, getSelected, getSelectionIds, select }) {
// The whole selection moves; a lone selected text frame still means its card.
/** @param {'front' | 'back' | 'forward' | 'backward'} mode */
function changeLayer(mode){const c=current();const ids=getSelectionIds().length?getSelectionIds():c?[c.id]:[];const first=ids.length?store.find(ids[0]):undefined;if(!first)return;const page=first.page;const order=store.items.filter(v=>v.page===page).sort((a,b)=>(a.z||0)-(b.z||0));const chosen=new Set(order.filter(v=>ids.includes(v.id)));store.change(()=>reorderLayers(order,chosen,mode).forEach((v,i)=>v.z=i+1));if(ids.length===1)select(document.querySelector('.el[data-id="'+getSelected()+'"]'))}
for(const k of ['front','forward','backward','back'])document.getElementById(k).onclick=()=>changeLayer(/** @type {'front'|'forward'|'backward'|'back'} */ (k));
}
