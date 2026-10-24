// The only remaining special-case gesture is the spell-level badge.
// All other geometry is on the gesture layer: canvas-controls.js and inner-canvas.js.
/** @param {import('../types/layout').Deps} deps */
export function createInnerInteractions({select,store,mm}) {
  /**
   * @param {PointerEvent} event @param {import('../types/layout').Item | undefined} item
   * @param {HTMLElement} element @param {HTMLElement} badge
   */
  function startBadgeDrag(event,item,element,badge) {
    if(event.button!==0)return;
    // A locked card keeps its badge in place; its text is still edited.
    if(item?.locked){select(element);return}
    // The card may be gone (deleted, or replaced by an undo) by the time of the press.
    const page=element.closest('.page');
    if(!item||!page)return;
    event.preventDefault();event.stopPropagation();
    select(element);
    const scale=210/page.getBoundingClientRect().width;
    const sx=event.clientX,sy=event.clientY;
    const ox=item.badgeX??(item.w-8),oy=item.badgeY??(item.h-8);
    const move=(/** @type {PointerEvent} */ e)=>{
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
