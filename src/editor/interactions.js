// The only remaining special-case gesture is the spell-level badge.
// All other geometry is on the gesture layer: canvas-controls.js and inner-canvas.js.
/** @param {import('../types/layout').Deps} deps */
export function createInnerInteractions({select,store,mm}) {
  function startBadgeDrag(event,item,element,badge) {
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    select(element);
    const page=element.closest('.page');
    const scale=210/page.getBoundingClientRect().width;
    const sx=event.clientX,sy=event.clientY;
    const ox=item.badgeX??(item.w-8),oy=item.badgeY??(item.h-8);
    const move=e=>{
      item.badgeCustomPosition=true;
      item.badgeX=Math.max(0,Math.min(item.w-8,ox+(e.clientX-sx)*scale));
      item.badgeY=Math.max(0,Math.min(item.h-8,oy+(e.clientY-sy)*scale));
      badge.style.left=mm(item.badgeX);
      badge.style.top=mm(item.badgeY);
      badge.style.right='auto';badge.style.bottom='auto';
    };
    const finish=()=>{
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',finish);
      store.commit();
    };
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',finish);
  }
  return {startBadgeDrag};
}
