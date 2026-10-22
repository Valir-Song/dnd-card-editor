// Pure millimetre geometry for canvas gestures: resizing with a fixed opposite
// edge, proportional group scaling and marquee hit tests. No DOM here.
export const PAGE={w:210,h:297};

export function bbox(boxes){
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  return {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};
}

// dir is [-1|0|1, -1|0|1]: which edges move (e.g. [1,1] = bottom-right handle).
// The opposite edge stays fixed; the result stays on the page and above `min`.
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
export function scaleBoxes(boxes,from,to){
  const sx=from.w?to.w/from.w:1,sy=from.h?to.h/from.h:1;
  return boxes.map(b=>({x:to.x+(b.x-from.x)*sx,y:to.y+(b.y-from.y)*sy,w:b.w*sx,h:b.h*sy}));
}

// Boxes covered by the marquee by at least `ratio` of their own area.
export function marqueeHits(rect,boxes,ratio=0.12){
  return boxes.filter(b=>{
    const w=Math.min(rect.x+rect.w,b.x+b.w)-Math.max(rect.x,b.x);
    const h=Math.min(rect.y+rect.h,b.y+b.h)-Math.max(rect.y,b.y);
    return w>0&&h>0&&w*h>=ratio*Math.max(b.w*b.h,1e-9);
  });
}

export function rectFromPoints(a,b){
  return {x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),w:Math.abs(a[0]-b[0]),h:Math.abs(a[1]-b[1])};
}
