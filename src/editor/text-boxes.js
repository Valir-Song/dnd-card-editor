// Independent text boxes share the editor's object, layer, history and file systems.
export function setupTextBoxes({addObject,current,persist,draw}) {
  const controls=document.getElementById('textBoxTools');
  // Typography is shared with card text in text-format.js.
  const fields={
    bg:document.getElementById('boxBgColor'),
    borderColor:document.getElementById('boxBorderColor'),
    bgTransparent:document.getElementById('boxTransparent'),
    borderVisible:document.getElementById('boxBorderVisible'),
    autoHeight:document.getElementById('boxAutoHeight')
  };
  document.getElementById('addTextBox').onclick=()=>addObject({
    kind:'textbox',x:28,y:115,w:72,h:25,
    text:'Двойной щелчок — ввести текст',
    fontFamily:'Georgia',fontSize:12,textAlign:'left',textWeight:'normal',
    textColor:'#262137',fontStyle:'normal',textDecoration:'none',bg:'#ffffff',borderColor:'#745193',
    bgTransparent:true,borderVisible:false,autoHeight:false
  });
  const active=()=>{const c=current();return c?.kind==='textbox'?c:null};
  const update=()=>{const c=active();if(!c)return;persist();draw();
    const element=Array.from(document.querySelectorAll('.el.textbox')).find(e=>e.dataset.id===c.id);
    if(element)element.classList.add('selected');
  };
  function syncTextBoxTools(){
    const c=active();controls.style.display=c?'inline-flex':'none';
    if(!c)return;
    for(const [key,input] of Object.entries(fields)){
      if(['bgTransparent','borderVisible','autoHeight'].includes(key))input.checked=!!c[key];
      else input.value=c[key]??({fontFamily:'Georgia',fontSize:12,textAlign:'left',textColor:'#262137',bg:'#ffffff',borderColor:'#745193'}[key]||'');
    }
    fields.bg.disabled=!!c.bgTransparent;
    fields.borderColor.disabled=!c.borderVisible;
  }
  for(const [key,input] of Object.entries(fields)){
    const handler=()=>{
      const c=active();if(!c)return;
      if(['bgTransparent','borderVisible','autoHeight'].includes(key))c[key]=input.checked;
       else c[key]=input.value;
      update();syncTextBoxTools();
    };
    input.addEventListener(input.type==='checkbox'?'change':'input',handler);
  }
  return {syncTextBoxTools};
}
