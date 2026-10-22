// Small embedded controls retained for compatibility with existing layouts.
// Page-level objects are now moved/resized only by canvas-controls.js (Moveable).
// Embedded text frames and level badges are properties of their parent card,
// not independent top-level canvas objects.
export function createInnerInteractions({select,persist,mm}) {
  function attachGesture(event, move) {
    const finish=()=>{
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',finish);
      persist();
    };
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',finish);
  }
  function startBadgeDrag(event,item,element,badge) {
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    select(element);
    const scale=210/element.closest('.page').getBoundingClientRect().width;
    const sx=event.clientX, sy=event.clientY;
    const ox=item.badgeX??(item.w-8), oy=item.badgeY??(item.h-8);
    attachGesture(event,e=>{
      item.badgeCustomPosition=true;
      item.badgeX=Math.max(0,Math.min(item.w-8,ox+(e.clientX-sx)*scale));
      item.badgeY=Math.max(0,Math.min(item.h-8,oy+(e.clientY-sy)*scale));
      badge.style.left=mm(item.badgeX);
      badge.style.top=mm(item.badgeY);
      badge.style.right='auto';
      badge.style.bottom='auto';
    });
  }
  function frame(item,field){
    item.textFrames ||= {};
    item.textFrames[field] ||= {};
    return item.textFrames[field];
  }
  function startTextMove(event,item,element,field,wrap){
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    select(element);
    const position=frame(item,field);
    const sx=event.clientX,sy=event.clientY;
    const scale=210/element.closest('.page').getBoundingClientRect().width;
    const ox=position.x||0,oy=position.y||0;
    attachGesture(event,e=>{
      position.x=ox+(e.clientX-sx)*scale;
      position.y=oy+(e.clientY-sy)*scale;
      wrap.style.transform='translate('+position.x+'mm, '+position.y+'mm)';
    });
  }
  function startTextResize(event,item,element,field,wrap){
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    select(element);
    const position=frame(item,field);
    const scale=210/element.closest('.page').getBoundingClientRect().width;
    const sx=event.clientX, sy=event.clientY;
    const w=position.w||wrap.getBoundingClientRect().width*scale;
    const h=position.h||wrap.getBoundingClientRect().height*scale;
    attachGesture(event,e=>{
      position.w=Math.max(8,w+(e.clientX-sx)*scale);
      position.h=Math.max(3,h+(e.clientY-sy)*scale);
      wrap.style.width=mm(position.w);
      wrap.style.height=mm(position.h);
    });
  }
  return {startBadgeDrag,startTextMove,startTextResize};
}
