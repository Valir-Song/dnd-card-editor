// Pure millimetre geometry for canvas gestures: resizing with a fixed opposite
// edge, proportional group scaling and marquee hit tests. No DOM here.
export const PAGE={w:210,h:297};
/** @typedef {import('../types/geometry').Box} Box */

/** @param {Box[]} boxes @returns {Box} */
export function bbox(boxes){
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  return {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};
}

// dir is [-1|0|1, -1|0|1]: which edges move (e.g. [1,1] = bottom-right handle).
// The opposite edge stays fixed; the result stays on the page and above `min`.
/**
 * @param {Box} box @param {import('../types/geometry').Dir} dir @param {number} dx @param {number} dy
 * @param {{min?: {w: number, h: number}, keepRatio?: boolean, page?: {w: number, h: number}}} [options]
 * @returns {Box}
 */
export function resizeBox(box,dir,dx,dy,{min={w:12,h:6},keepRatio=false,page=PAGE}={}){
  let w=box.w+dx*dir[0],h=box.h+dy*dir[1];
  if(keepRatio&&dir[0]&&dir[1]){
    const scale=Math.max(w/box.w,h/box.h);
    w=box.w*scale;h=box.h*scale;
  }
  const right=box.x+box.w,bottom=box.y+box.h;
  // Limit growth by the page edge on the moving side, and shrinking by `min`.
  const maxW=dir[0]<0?right:page.w-box.x, maxH=dir[1]<0?bottom:page.h-box.y;
  w=Math.max(Math.min(w,maxW),Math.min(min.w,maxW));
  h=Math.max(Math.min(h,maxH),Math.min(min.h,maxH));
  if(keepRatio&&dir[0]&&dir[1]){
    const scale=Math.min(w/box.w,h/box.h);
    w=box.w*scale;h=box.h*scale;
  }
  return {x:dir[0]<0?right-w:box.x,y:dir[1]<0?bottom-h:box.y,w,h};
}

// Map each box from the group frame `from` into the resized frame `to`.
/** @param {Box[]} boxes @param {Box} from @param {Box} to @returns {Box[]} */
export function scaleBoxes(boxes,from,to){
  const sx=from.w?to.w/from.w:1,sy=from.h?to.h/from.h:1;
  return boxes.map(b=>({x:to.x+(b.x-from.x)*sx,y:to.y+(b.y-from.y)*sy,w:b.w*sx,h:b.h*sy}));
}

// Boxes covered by the marquee by at least `ratio` of their own area.
/** @template {Box} T @param {Box} rect @param {T[]} boxes @returns {T[]} */
export function marqueeHits(rect,boxes,ratio=0.12){
  return boxes.filter(b=>{
    const w=Math.min(rect.x+rect.w,b.x+b.w)-Math.max(rect.x,b.x);
    const h=Math.min(rect.y+rect.h,b.y+b.h)-Math.max(rect.y,b.y);
    return w>0&&h>0&&w*h>=ratio*Math.max(b.w*b.h,1e-9);
  });
}

/** @param {import('../types/geometry').Point} a @param {import('../types/geometry').Point} b @returns {Box} */
export function rectFromPoints(a,b){
  return {x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),w:Math.abs(a[0]-b[0]),h:Math.abs(a[1]-b[1])};
}

/**
 * Where to put a new box so that it covers nothing: of the spots on a `step` mm
 * grid inside the page frame, the free one closest to `near` (the wished-for
 * top-left corner). `gap` keeps a little air between boxes. On a full page the
 * wish itself is returned, kept on the page.
 * @param {{w: number, h: number}} size
 * @param {Box[]} taken
 * @param {{x: number, y: number}} near
 * @param {{page?: {w: number, h: number}, margin?: number, gap?: number, step?: number}} [options]
 * @returns {{x: number, y: number}}
 */
export function findFreeSpot(size,taken,near,{page=PAGE,margin=5,gap=2,step=2.5}={}){
  const maxX=Math.max(margin,page.w-margin-size.w),maxY=Math.max(margin,page.h-margin-size.h);
  const clamp=(/** @type {number} */ v,/** @type {number} */ hi)=>Math.min(Math.max(v,margin),hi);
  const wish={x:clamp(near.x,maxX),y:clamp(near.y,maxY)};
  /** @param {{x: number, y: number}} p */
  const free=p=>taken.every(b=>p.x>=b.x+b.w+gap||b.x>=p.x+size.w+gap||p.y>=b.y+b.h+gap||b.y>=p.y+size.h+gap);
  if(free(wish))return wish;
  /** @type {Array<{x: number, y: number, d: number}>} */
  const spots=[];
  for(let x=margin;x<=maxX+1e-9;x+=step)for(let y=margin;y<=maxY+1e-9;y+=step)spots.push({x,y,d:Math.hypot(x-wish.x,y-wish.y)});
  spots.sort((a,b)=>a.d-b.d);
  const spot=spots.find(free);
  return spot?{x:spot.x,y:spot.y}:wish;
}

/**
 * The part of a move by (dx, dy) that keeps every box on the page (a group
 * stops as a whole when one of its boxes reaches an edge).
 * @param {Box[]} boxes @param {number} dx @param {number} dy @param {{w: number, h: number}} [page]
 * @returns {{dx: number, dy: number}}
 */
export function clampMove(boxes,dx,dy,page=PAGE){
  const clip=(/** @type {number} */ v,/** @type {number} */ min,/** @type {number} */ max)=>Math.max(min,Math.min(v,Math.max(min,max)));
  return {
    dx:clip(dx,Math.max(...boxes.map(b=>-b.x)),Math.min(...boxes.map(b=>page.w-b.x-b.w))),
    dy:clip(dy,Math.max(...boxes.map(b=>-b.y)),Math.min(...boxes.map(b=>page.h-b.y-b.h)))
  };
}

/**
 * Distance from `value` to the next grid line in `direction` (1 or -1): a value
 * between lines goes to the nearest one that way, a value on a line a full step.
 * @param {number} value @param {number} direction @param {number} grid
 */
export function gridStep(value,direction,grid){
  const k=value/grid,eps=1e-6;
  const next=direction>0?Math.floor(k+eps)+1:Math.ceil(k-eps)-1;
  return next*grid-value;
}

// A single object aligns to the sheet's 5 mm frame.
export const PAGE_FRAME={x:5,y:5,w:200,h:287};
/** Layout values are kept to 0.01 mm: equal gaps of 33.333… mm stay readable. @param {number} v */
const tidy=v=>Math.round(v*100)/100;

/**
 * Align boxes to an edge or centre line of `frame` (the selection's bounding
 * box, or PAGE_FRAME for one object). Only x or only y changes.
 * @param {Box[]} boxes @param {'left'|'center'|'right'|'top'|'middle'|'bottom'} mode @param {Box} frame
 * @returns {Box[]}
 */
export function alignBoxes(boxes,mode,frame){
  return boxes.map(b=>{
    if(mode==='left')return {...b,x:tidy(frame.x)};
    if(mode==='center')return {...b,x:tidy(frame.x+(frame.w-b.w)/2)};
    if(mode==='right')return {...b,x:tidy(frame.x+frame.w-b.w)};
    if(mode==='top')return {...b,y:tidy(frame.y)};
    if(mode==='middle')return {...b,y:tidy(frame.y+(frame.h-b.h)/2)};
    return {...b,y:tidy(frame.y+frame.h-b.h)};
  });
}

/**
 * Equal gaps along an axis: the first box (smallest start) and the end of the
 * last one stay, the others are spaced evenly in their order along the axis.
 * Fewer than three boxes stay as they are. Result in the input order.
 * @param {Box[]} boxes @param {'x'|'y'} axis @returns {Box[]}
 */
export function distributeBoxes(boxes,axis){
  const out=boxes.map(b=>({...b}));
  if(boxes.length<3)return out;
  const size=axis==='x'?'w':'h';
  const centre=(/** @type {Box} */ b)=>b[axis]+b[size]/2;
  const order=boxes.map((b,i)=>i).sort((i,j)=>boxes[i][axis]-boxes[j][axis]||centre(boxes[i])-centre(boxes[j]));
  const first=boxes[order[0]],last=boxes[order[order.length-1]];
  const total=boxes.reduce((sum,b)=>sum+b[size],0);
  const gap=(last[axis]+last[size]-first[axis]-total)/(boxes.length-1);
  let at=first[axis];
  for(const i of order){out[i][axis]=tidy(at);at+=boxes[i][size]+gap}
  return out;
}

/**
 * Give every box the width (dim 'w') or height ('h') of `ref`, keeping its
 * top-left corner; a box never grows past the page edge.
 * @param {Box[]} boxes @param {Box} ref @param {'w'|'h'} dim @param {{w: number, h: number}} [page]
 * @returns {Box[]}
 */
export function matchSize(boxes,ref,dim,page=PAGE){
  return boxes.map(b=>dim==='w'?{...b,w:tidy(Math.min(ref.w,page.w-b.x))}:{...b,h:tidy(Math.min(ref.h,page.h-b.y))});
}
