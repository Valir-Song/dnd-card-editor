// Snapping in layout millimetres: objects align to other objects' edges and
// centres on the same page, to the sheet's edges, 5 mm frame and centre, and
// optionally to a grid. Pure functions below are shared by the canvas and tests.
const STORE='dnd-card-editor-snap';
export const PAGE_LINES={x:[0,5,105,205,210],y:[0,5,148.5,292,297]};

export function createSnapSettings(){
  const state={enabled:true,gridMm:0};
  try{Object.assign(state,JSON.parse(localStorage.getItem(STORE)||'{}'))}catch(e){}
  const listeners=new Set();
  return {
    get:()=>({...state}),
    set(next){
      Object.assign(state,next);
      try{localStorage.setItem(STORE,JSON.stringify(state))}catch(e){}
      listeners.forEach(listener=>listener());
    },
    onChange:listener=>listeners.add(listener)
  };
}

// Candidate lines from every other object on the page plus the sheet guides.
export function collectLines(items,page,excludeIds){
  const lines={x:[...PAGE_LINES.x],y:[...PAGE_LINES.y]};
  for(const item of items){
    if((item.page||1)!==page||excludeIds.has(item.id))continue;
    lines.x.push(item.x,item.x+item.w/2,item.x+item.w);
    lines.y.push(item.y,item.y+item.h/2,item.y+item.h);
  }
  return lines;
}

// Smallest correction that puts one of `edges` on a line within `threshold`;
// otherwise, with a grid, move the first edge onto the nearest grid step.
export function snapAxis(edges,lines,threshold,grid=0){
  let best=null;
  for(const edge of edges)for(const line of lines){
    const offset=line-edge;
    if(Math.abs(offset)<=threshold&&(!best||Math.abs(offset)<Math.abs(best.offset)))best={offset,line};
  }
  if(best)return best;
  if(grid>0)return {offset:Math.round(edges[0]/grid)*grid-edges[0],line:null};
  return {offset:0,line:null};
}

// Snap a moving box (its left/centre/right and top/middle/bottom) after a raw move.
export function snapMove(box,dx,dy,lines,{threshold,grid=0}){
  const x=box.x+dx,y=box.y+dy;
  const sx=snapAxis([x,x+box.w/2,x+box.w],lines.x,threshold,grid);
  const sy=snapAxis([y,y+box.h/2,y+box.h],lines.y,threshold,grid);
  return {dx:dx+sx.offset,dy:dy+sy.offset,guides:{x:sx.line,y:sy.line}};
}
