// The only remaining special-case gesture is the spell-level badge.
// All other geometry is on the gesture layer: canvas-controls.js and inner-canvas.js.
/** @param {import('../types/layout').Deps<'select' | 'mm'>} deps */
export function createInnerInteractions({select,store,mm}) {
  /**
   * Drag a badge inside its card; a click without moving puts the caret in it
   * with its text selected, so typing replaces it. `index` null is the main
   * badge (level, badgeX/badgeY), a number one of item.badges.
   * @param {PointerEvent} event @param {import('../types/layout').Item | undefined} item
   * @param {HTMLElement} element @param {HTMLElement} badge @param {number | null} [index]
   */
  function startBadgeDrag(event,item,element,badge,index=null) {
    if(event.button!==0)return;
    // The card may be gone (deleted, or replaced by an undo) by the time of the press.
    const page=element.closest('.page');
    if(!item||!page)return;
    event.preventDefault();event.stopPropagation();
    select(element);
    const extra=index===null?null:(Array.isArray(item.badges)?item.badges[index]:null);
    if(index!==null&&!extra)return;
    const scale=210/page.getBoundingClientRect().width;
    const sx=event.clientX,sy=event.clientY;
    const ox=extra?Number(extra.x)||0:item.badgeX??(item.w-8),oy=extra?Number(extra.y)||0:item.badgeY??(item.h-8);
    let moved=false;
    const move=(/** @type {PointerEvent} */ e)=>{
      // A locked card keeps its badges in place; their text is still edited.
      if(item.locked||(!moved&&Math.hypot(e.clientX-sx,e.clientY-sy)<3))return;
      moved=true;
      const x=Math.max(0,Math.min(item.w-8,ox+(e.clientX-sx)*scale)),y=Math.max(0,Math.min(item.h-8,oy+(e.clientY-sy)*scale));
      if(extra){extra.x=x;extra.y=y}else{item.badgeCustomPosition=true;item.badgeX=x;item.badgeY=y}
      badge.style.left=mm(x);badge.style.top=mm(y);
      badge.style.right='auto';badge.style.bottom='auto';
    };
    const finish=()=>{
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',finish);
      if(moved){store.commit();return}
      // Pressing was cancelled above, so focus by hand: the badge is ready for typing.
      badge.focus();
      const range=document.createRange();range.selectNodeContents(badge);
      const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);
    };
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',finish);
  }
  return {startBadgeDrag};
}
