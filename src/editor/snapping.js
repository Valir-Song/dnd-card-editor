// Snapping in layout millimetres: objects align to other objects' edges and
// centres on the same page, to the sheet's edges, 5 mm frame and centre, and
// optionally to a grid. Pure functions below are shared by the canvas and tests.
const STORE='dnd-card-editor-snap';
export const PAGE_LINES={x:[0,5,105,205,210],y:[0,5,148.5,292,297]};

export function createSnapSettings(){
  /** @type {import('../types/geometry').SnapSettings} */
  const state={enabled:true,gridMm:0};
  try{Object.assign(state,JSON.parse(localStorage.getItem(STORE)||'{}'))}catch(e){}
  /** @type {Set<() => void>} */
  const listeners=new Set();
  return {
    get:()=>({...state}),
    /** @param {Partial<import('../types/geometry').SnapSettings>} next */
    set(next){
      Object.assign(state,next);
      try{localStorage.setItem(STORE,JSON.stringify(state))}catch(e){}
      listeners.forEach(listener=>listener());
    },
    onChange:(/** @type {() => void} */ listener)=>listeners.add(listener)
  };
}

/** @typedef {import('../types/geometry').Box} Box */

// Edges and centres of boxes as snap lines.
/** @param {Box[]} boxes @returns {import('../types/geometry').Lines} */
export function boxLines(boxes){
  return {x:boxes.flatMap(b=>[b.x,b.x+b.w/2,b.x+b.w]),y:boxes.flatMap(b=>[b.y,b.y+b.h/2,b.y+b.h])};
}

// Candidate lines from every other object on the page plus the sheet guides.
/**
 * @param {Array<Box & {id: string, page?: number}>} items @param {number} page @param {Set<string>} excludeIds
 * @returns {import('../types/geometry').Lines}
 */
export function collectLines(items,page,excludeIds){
  const own=boxLines(items.filter(item=>(item.page||1)===page&&!excludeIds.has(item.id)));
  return {x:[...PAGE_LINES.x,...own.x],y:[...PAGE_LINES.y,...own.y]};
}

// Smallest correction that puts one of `edges` on a line within `threshold`;
// otherwise, with a grid, move the first edge onto the nearest grid step.
/** @param {number[]} edges @param {number[]} lines @param {number} threshold @returns {import('../types/geometry').Snap} */
export function snapAxis(edges,lines,threshold,grid=0){
  /** @type {import('../types/geometry').Snap | null} */
  let best=null;
  for(const edge of edges)for(const line of lines){
    const offset=line-edge;
    if(Math.abs(offset)<=threshold&&(!best||Math.abs(offset)<Math.abs(best.offset)))best={offset,line};
  }
  if(best)return best;
  if(grid>0)return {offset:Math.round(edges[0]/grid)*grid-edges[0],line:null};
  return {offset:0,line:null};
}

// ---- equal gaps: keep the spacing of a row (or column) of objects ----
/** @type {Record<'x'|'y', ['x'|'y', 'w'|'h', 'x'|'y', 'w'|'h']>} */
const AXES={x:['x','w','y','h'],y:['y','h','x','w']};
const MIN_GAP=0.5;  // mm: touching or overlapping boxes have no gap to copy
const SAME_GAP=0.05; // mm: gaps this close are equal

/**
 * The row ('x') or column ('y') of `box` among `others` — the boxes that
 * overlap it across the axis — with its nearest neighbour on each side and the
 * gaps already in the row. A gap is measured from a box back to the nearest
 * box that ends before it starts, so a background or a frame around the row,
 * or a small box inside a big one, adds no false gap and hides no real one.
 * @param {Box} box @param {Box[]} others @param {'x'|'y'} axis
 */
function rowOf(box,others,axis){
  const [pos,size,cross,crossSize]=AXES[axis];
  const end=(/** @type {Box} */ b)=>b[pos]+b[size],centre=(/** @type {Box} */ b)=>b[pos]+b[size]/2;
  const row=others.filter(o=>Math.min(o[cross]+o[crossSize],box[cross]+box[crossSize])-Math.max(o[cross],box[cross])>0);
  /** @type {Box | null} */
  let prev=null;
  /** @type {Box | null} */
  let next=null;
  for(const o of row){
    if(end(o)<=centre(box)&&centre(o)<centre(box)&&(!prev||end(o)>end(prev)))prev=o;
    if(o[pos]>=centre(box)&&centre(o)>centre(box)&&(!next||o[pos]<next[pos]))next=o;
  }
  /** @type {Array<{a: Box, b: Box, gap: number}>} */
  const pairs=[];
  for(const o of row){
    /** @type {Box | null} */
    let before=null;
    for(const p of row)if(p!==o&&end(p)<=o[pos]+1e-9&&(!before||end(p)>end(before)))before=p;
    if(before&&o[pos]-end(before)>MIN_GAP)pairs.push({a:before,b:o,gap:o[pos]-end(before)});
  }
  return {prev,next,pairs,pos,size,cross,crossSize,end};
}

/**
 * The smallest correction within `threshold` that makes the gap between `box`
 * and its nearest neighbour equal to a gap already in its row, or centres it
 * between its two neighbours; null when none is that close.
 * @param {Box} box @param {Box[]} others @param {'x'|'y'} axis @param {number} threshold
 * @returns {{offset: number, gap: number} | null}
 */
export function gapSnap(box,others,axis,threshold){
  const {prev,next,pairs,pos,size,end}=rowOf(box,others,axis);
  /** @type {{offset: number, gap: number} | null} */
  let best=null;
  const consider=(/** @type {number} */ target,/** @type {number} */ gap)=>{
    const offset=target-box[pos];
    if(gap>MIN_GAP&&Math.abs(offset)<=threshold&&(!best||Math.abs(offset)<Math.abs(best.offset)))best={offset,gap};
  };
  if(prev&&next)consider((end(prev)+next[pos]-box[size])/2,(next[pos]-end(prev)-box[size])/2);
  for(const {gap} of pairs){
    if(prev)consider(end(prev)+gap,gap);
    if(next)consider(next[pos]-gap-box[size],gap);
  }
  return best;
}

/**
 * Gaps to highlight when `box` sits `gap` mm from a neighbour: those next to
 * it and the equal ones already in its row. Empty if no neighbour is at `gap`.
 * @param {Box} box @param {Box[]} others @param {'x'|'y'} axis @param {number} gap
 * @returns {import('../types/geometry').GapMark[]}
 */
export function gapMarks(box,others,axis,gap){
  const {prev,next,pairs,pos,cross,crossSize,end}=rowOf(box,others,axis);
  /** @param {Box} a @param {Box} b @returns {import('../types/geometry').GapMark} */
  const mark=(a,b)=>{
    const lo=Math.max(a[cross],b[cross]),hi=Math.min(a[cross]+a[crossSize],b[cross]+b[crossSize]);
    return {axis,from:end(a),to:b[pos],at:(lo+hi)/2};
  };
  /** @type {import('../types/geometry').GapMark[]} */
  const marks=[];
  if(prev&&Math.abs(box[pos]-end(prev)-gap)<SAME_GAP)marks.push(mark(prev,box));
  if(next&&Math.abs(next[pos]-end(box)-gap)<SAME_GAP)marks.push(mark(box,next));
  if(!marks.length)return marks;
  for(const pair of pairs)if(Math.abs(pair.gap-gap)<SAME_GAP)marks.push(mark(pair.a,pair.b));
  return marks;
}

// Snap a moving box (its left/centre/right and top/middle/bottom) after a raw
// move: to lines within `threshold`, or — with `others`, the boxes that stay —
// to the spacing of its row; the closer one wins. With neither, to the grid.
/**
 * @param {Box} box @param {number} dx @param {number} dy @param {import('../types/geometry').Lines} lines
 * @param {{threshold: number, grid?: number, others?: Box[] | null}} options
 */
export function snapMove(box,dx,dy,lines,{threshold,grid=0,others=null}){
  const x=box.x+dx,y=box.y+dy,moved={...box,x,y};
  /** @param {'x'|'y'} axis @param {number[]} edges */
  const snap=(axis,edges)=>{
    const line=snapAxis(edges,lines[axis],threshold);
    const gap=others?gapSnap(moved,others,axis,threshold):null;
    if(line.line!==null&&(!gap||Math.abs(line.offset)<=Math.abs(gap.offset)))
      return {...line,gap:gap&&Math.abs(gap.offset-line.offset)<0.01?gap.gap:null};
    if(gap)return {offset:gap.offset,line:null,gap:gap.gap};
    return {...snapAxis(edges,[],threshold,grid),gap:null};
  };
  const sx=snap('x',[x,x+box.w/2,x+box.w]),sy=snap('y',[y,y+box.h/2,y+box.h]);
  const placed={...box,x:x+sx.offset,y:y+sy.offset};
  const gaps=others?[
    ...(sx.gap!==null?gapMarks(placed,others,'x',sx.gap):[]),
    ...(sy.gap!==null?gapMarks(placed,others,'y',sy.gap):[])
  ]:[];
  return {dx:dx+sx.offset,dy:dy+sy.offset,guides:{x:sx.line,y:sy.line},gaps};
}
