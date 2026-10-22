/**
 * In-memory layout history. Each meaningful gesture is one checkpoint.
 * Text typing and sliders can coalesce adjacent updates with a group key.
 * Snapshots are immutable strings, so undo never references a mutated object.
 * Embedded pictures (data: URLs, often megabytes each) are kept once in a pool
 * and snapshots hold a short reference, so the step limit is not eaten by images.
 * @param {object} options
 * @param {() => import('../types/layout').Item[]} options.read
 * @param {(items: import('../types/layout').Item[]) => void} options.restore
 * @param {(status: {undo: boolean, redo: boolean, steps: number}) => void} [options.onChange]
 * @param {number} [options.limit]
 * @param {number} [options.maxBytes]
 * @param {() => number} [options.now]
 */
export function createHistory({read, restore, onChange=()=>{}, limit=60, maxBytes=48*1024*1024, now=()=>Date.now()}) {
  const REF='\u0000image:'; // never occurs in layout text
  const pool=new Map(), refs=new Map(); // ref -> data URL, data URL -> ref
  let nextRef=0;
  const isPicture=value=>typeof value==='string'&&value.length>=1024&&value.startsWith('data:');
  const encode=items=>JSON.stringify(items,(key,value)=>{
    if(!isPicture(value))return value;
    let ref=refs.get(value);
    if(ref===undefined){ref=REF+(nextRef++);refs.set(value,ref);pool.set(ref,value)}
    return ref;
  });
  const decode=text=>JSON.parse(text,(key,value)=>typeof value==='string'&&value.startsWith(REF)?pool.get(value):value);
  // Forget pictures that no remaining snapshot refers to.
  function prune(){
    const used=new Set(snapshots.flatMap(text=>text.match(/\\u0000image:\d+/g)||[]).map(ref=>REF+ref.slice(12)));
    for(const [ref,value] of pool)if(!used.has(ref)){pool.delete(ref);refs.delete(value)}
  }
  let snapshots=[encode(read())];
  let metadata=[null];
  let cursor=0;
  const status=()=>({undo:cursor>0, redo:cursor<snapshots.length-1, steps:cursor});
  function notify(){onChange(status())}
  /** @param {import('../types/layout').CommitOptions} [options] */
  function commit({group=null, windowMs=850}={}) {
    const state=encode(read());
    if(state===snapshots[cursor])return false;
    const at=now();
    const previous=metadata[cursor];
    const coalesce=Boolean(group && cursor>0 && cursor===snapshots.length-1 && previous?.group===group && at-previous.at<windowMs);
    if(coalesce){snapshots[cursor]=state; metadata[cursor]={group,at};}
    else {
      if(snapshots.splice(cursor+1).length)prune();
      metadata.splice(cursor+1);
      snapshots.push(state);
      metadata.push({group,at});
      cursor=snapshots.length-1;
    }
    // Keep the newest action and its previous state, even for large embedded images.
    const size=()=>[...snapshots,...pool.values()].reduce((sum,s)=>sum+s.length*2,0);
    while(snapshots.length>2 && (snapshots.length>limit+1 || size()>maxBytes)){
      snapshots.shift(); metadata.shift(); cursor--; prune();
    }
    notify();
    return true;
  }
  function move(delta){
    const index=cursor+delta;
    if(index<0||index>=snapshots.length)return false;
    cursor=index;
    restore(decode(snapshots[cursor]));
    notify();
    return true;
  }
  // Forget all checkpoints, e.g. after replacing a damaged saved layout at startup.
  function reset(){
    pool.clear(); refs.clear();
    snapshots=[encode(read())]; metadata=[null]; cursor=0;
    notify();
  }
  notify();
  return {commit,undo:()=>move(-1),redo:()=>move(1),reset,status};
}
