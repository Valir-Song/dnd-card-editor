// Moveable geometry for text fields INSIDE a card/section/note.
// A field belongs to its parent: offsets and optional dimensions are stored
// exclusively under item.textFrames[field], never as new top-level objects.
// Tiptap owns the editable content; this module owns geometry and selection.
import Moveable from 'moveable';
import Selecto from 'selecto';

export function createInnerCanvas({pages,getItems,persist,mm,selectParent}) {
  let parentId=null,fields=[],gesture=null,anchor=null;
  const pxToMM=page=>210/page.getBoundingClientRect().width;
  const unique=values=>[...new Set(values)];
  const parentFor=id=>getItems().find(item=>item.id===id);
  const parentNode=id=>[...pages].flatMap(p=>[...p.querySelectorAll('.el')]).find(el=>el.dataset.id===id);
  const nodeFor=(id,field)=>[...(parentNode(id)?.querySelectorAll('.text-wrap')||[])].find(el=>el.dataset.field===field);
  const validFields=id=>[...(parentNode(id)?.querySelectorAll('.text-wrap')||[])].map(el=>el.dataset.field);
  const currentTargets=()=>fields.map(field=>nodeFor(parentId,field)).filter(Boolean);
  const frame=(item,field)=>{item.textFrames ||= {};item.textFrames[field] ||= {};return item.textFrames[field]};
  const selected=()=>fields.length>0;
  const moveable=new Moveable(document.body,{
    target:[],draggable:true,resizable:true,origin:false,
    edge:true,edgeDraggable:true,keepRatio:false,snappable:false,
    throttleDrag:0,throttleResize:0,
    renderDirections:['nw','n','ne','w','e','sw','s','se'],
    className:'dnd-inner-moveable'
  });
  const selectos=[];
  function sync() {
    const chosen=new Set(fields);
    for(const page of pages)for(const wrap of page.querySelectorAll('.text-wrap')){
      const owner=wrap.closest('.el')?.dataset.id;
      wrap.classList.toggle('inner-selected',owner===parentId&&chosen.has(wrap.dataset.field));
    }
    const targets=currentTargets();
    moveable.target=targets.length===1?targets[0]:targets;
    moveable.updateRect();
    const status=document.getElementById('selectionCount');
    if(selected()&&status)status.textContent=fields.length>1?'Текстовых блоков: '+fields.length:'Выбран текстовый блок';
    selectos.forEach((selecto,i)=>selecto.setSelectedTargets(targets.filter(node=>node.closest('.page')===pages[i])));
  }
  function clear(){
    if(!selected())return;
    parentId=null;fields=[];sync();
  }
  function setFields(id,next) {
    const parent=parentFor(id),valid=validFields(id);
    if(!parent||!valid.length)return;
    const names=unique(next).filter(field=>valid.includes(field));
    if(!names.length){clear();return;}
    parentId=id;fields=names;
    // Parent remains the selected data record, but its Moveable handles are
    // hidden while one or more of its child text frames own the handles.
    selectParent(id);
    sync();
  }
  function selectField(id,field){setFields(id,[field])}
  function toggleField(id,field){
    setFields(id===parentId?id:id,id===parentId
      ?(fields.includes(field)?fields.filter(f=>f!==field):[...fields,field])
      :[field]);
  }
  function begin(){
    const owner=parentFor(parentId);
    const chosen=currentTargets();
    if(!owner||!chosen.length){gesture=null;return;}
    const scale=pxToMM(chosen[0].closest('.page'));
    gesture={
      scale,records:chosen.map(node=>{
        const f=node.dataset.field,p=frame(owner,f),rect=node.getBoundingClientRect();
        return {
          node,field:f,item:owner,position:p,
          x:p.x||0,y:p.y||0,
          w:p.w||rect.width*scale,h:p.h||rect.height*scale,
          pixelW:rect.width,pixelH:rect.height
        };
      })
    };
  }
  function drag(dist){
    if(!gesture||!dist)return;
    const [dx,dy]=dist.map(v=>v*gesture.scale);
    for(const r of gesture.records){
      r.position.x=r.x+dx;
      r.position.y=r.y+dy;
      r.node.style.transform='translate('+mm(r.position.x)+', '+mm(r.position.y)+')';
    }
  }
  function resize(e){
    if(!gesture)return;
    const r=gesture.records.find(x=>x.node===e.target);
    if(!r)return;
    const dir=e.direction||[1,1],scale=gesture.scale;
    const width=Math.max(8,r.w+(e.dist?.[0]??(e.width-r.pixelW))*scale);
    const height=Math.max(3,r.h+(e.dist?.[1]??(e.height-r.pixelH))*scale);
    const x=dir[0]<0?r.x+r.w-width:r.x;
    const y=dir[1]<0?r.y+r.h-height:r.y;
    Object.assign(r.position,{x,y,w:width,h:height});
    r.node.style.transform='translate('+mm(x)+', '+mm(y)+')';
    r.node.style.width=mm(width);
    r.node.style.height=mm(height);
  }
  function finish(){
    if(!gesture)return;
    gesture=null;
    persist(); // A combined gesture is one undo checkpoint.
    requestAnimationFrame(()=>moveable.updateRect());
  }
  moveable.on('dragStart',begin)
    .on('drag',e=>drag(e.beforeDist||e.dist))
    .on('dragEnd',finish)
    .on('dragGroupStart',begin)
    .on('dragGroup',e=>drag(e.events?.[0]?.beforeDist||e.events?.[0]?.dist))
    .on('dragGroupEnd',finish)
    .on('resizeStart',e=>{
      begin();
      const r=gesture?.records.find(x=>x.node===e.target);
      if(r)e.set([r.pixelW,r.pixelH]);
    })
    .on('resize',resize)
    .on('resizeEnd',finish)
    .on('resizeGroupStart',e=>{
      begin();
      for(const event of e.events||[]){
        const r=gesture?.records.find(x=>x.node===event.target);
        if(r)event.set([r.pixelW,r.pixelH]);
      }
    })
    .on('resizeGroup',e=>{for(const event of e.events||[])resize(event)})
    .on('resizeGroupEnd',finish);
  // Alt+drag from a blank area INSIDE a card selects multiple sibling text
  // frames. The main Selecto remains restricted to page-level objects.
  for(const page of pages){
    const selecto=new Selecto({
      container:document.body,dragContainer:page,
      selectableTargets:['#'+page.id+' .text-wrap'],
      selectByClick:false,selectFromInside:false,continueSelect:false,
      hitRate:8,preventDefault:false,ratio:0
    });
    selectos.push(selecto);
    selecto.on('dragStart',event=>{
      const input=event.inputEvent,target=input?.target;
      const parent=target?.closest?.('.el');
      if(!input?.altKey||!parent||parent.closest('.page')!==page||
          target.closest('.text-wrap,.editable,[contenteditable],.level,.moveable-control-box')){
        anchor=null;event.stop();return;
      }
      anchor=parent.dataset.id;
    });
    selecto.on('selectEnd',event=>{
      if(!anchor||event.isDragStartEnd){anchor=null;return;}
      const found=event.selected.filter(node=>node.closest('.el')?.dataset.id===anchor)
        .map(node=>node.dataset.field);
      if(found.length)setFields(anchor,found);
      anchor=null;
    });
  }
  function afterDraw(){
    if(parentId){
      const valid=validFields(parentId);
      fields=fields.filter(f=>valid.includes(f));
      if(!fields.length)parentId=null;
    }
    sync();
  }
  return {
    clear,setFields,selectField,toggleField,afterDraw,
    hasSelection:selected,
    belongsTo:id=>selected()&&parentId===id,
    count:()=>fields.length,
    getFields:()=>fields.slice(),
    getParentId:()=>parentId
  };
}
