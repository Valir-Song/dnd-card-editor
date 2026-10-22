// Background, border and geometry controls for Tiptap-backed text boxes.
// All typography is controlled by the shared Tiptap toolbar.
/** @param {import('../types/layout').Deps} deps */
export function setupTextBoxes({addObject,current,store}) {
  const group=document.getElementById('textBoxTools');
  const fields={
    bg:document.getElementById('boxBgColor'),
    borderColor:document.getElementById('boxBorderColor'),
    bgTransparent:document.getElementById('boxTransparent'),
    borderVisible:document.getElementById('boxBorderVisible'),
    autoHeight:document.getElementById('boxAutoHeight')
  };
  document.getElementById('addTextBox').onclick=()=>addObject({
    kind:'textbox',x:28,y:115,w:72,h:25,
    text:'Кликни, чтобы ввести текст',
    fontFamily:'Georgia',fontSize:12,textAlign:'left',textWeight:'normal',
    textColor:'#262137',bg:'#ffffff',borderColor:'#745193',
    bgTransparent:true,borderVisible:false,autoHeight:false
  });
  const active=()=>{const item=current();return item?.kind==='textbox'?item:null};
  function syncTextBoxTools(){
    const item=active();group.style.display=item?'inline-flex':'none';
    if(!item)return;
    for(const [property,field] of Object.entries(fields)){
      if(field.type==='checkbox')field.checked=!!item[property];
      else field.value=item[property]||({bg:'#ffffff',borderColor:'#745193'}[property]);
    }
    fields.bg.disabled=!!item.bgTransparent;
    fields.borderColor.disabled=!item.borderVisible;
  }
  for(const [property,field] of Object.entries(fields)){
    field.addEventListener(field.type==='checkbox'?'change':'input',()=>{
      const item=active();if(!item)return;
      store.change(()=>{item[property]=field.type==='checkbox'?field.checked:field.value},{group:'textbox-style:'+item.id+':'+property,windowMs:400});
      syncTextBoxTools();
    });
  }
  return {syncTextBoxTools};
}
