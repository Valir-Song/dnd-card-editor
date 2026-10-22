// Stack order within pages.
export function setupLayers({ current, store, getSelected, select }) {
function changeLayer(mode){const c=current();if(!c)return;const group=store.items.filter(v=>v.page===c.page).sort((a,b)=>(a.z||0)-(b.z||0));const index=group.indexOf(c);if(index<0)return;group.splice(index,1);let target=mode==='front'?group.length:mode==='back'?0:mode==='forward'?Math.min(group.length,index+1):Math.max(0,index-1);group.splice(target,0,c);store.change(()=>group.forEach((v,i)=>v.z=i+1));select(document.querySelector('.el[data-id="'+getSelected()+'"]'))}
for(const k of ['front','forward','backward','back'])document.getElementById(k).onclick=()=>changeLayer(k);
}
