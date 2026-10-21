// One text toolbar for both card fields and independent text boxes.
export function setupTextFormatting({current,persist}) {
  let lastEditor=null,savedRange=null,formattingDepth=0;
  const fonts=['Georgia','Arial','Times New Roman','Verdana','Courier New'];
  const controls={
    fontFamily:document.getElementById('fontFamily'),
    fontSize:document.getElementById('fontSize'),
    textAlign:document.getElementById('textAlign'),
    textColor:document.getElementById('textcolor')
  };
  const buttons=['bold','italic','underline'].map(id=>document.getElementById(id));
  function currentEditor() {
    const item=current();
    if(!item)return null;
    if(lastEditor&&document.contains(lastEditor)&&lastEditor.closest('.el')?.dataset.id===item.id)return lastEditor;
    if(item.kind==='textbox')return [...document.querySelectorAll('.el.textbox')].find(e=>e.dataset.id===item.id)?.querySelector('.textbox-editor')||null;
    return null;
  }
  function selectionIn(editor) {
    return !!(editor&&savedRange&&editor.contains(savedRange.commonAncestorContainer));
  }
  function remember(){
    const s=window.getSelection();
    if(!s?.rangeCount||document.activeElement?.closest('.toolbar'))return;
    const node=s.anchorNode;
    const editor=(node?.nodeType===1?node:node?.parentElement)?.closest?.('.editable');
    if(editor&&editor.closest('.page')&&s.getRangeAt(0).commonAncestorContainer&&editor.contains(s.getRangeAt(0).commonAncestorContainer)){
      lastEditor=editor;savedRange=s.getRangeAt(0).cloneRange();
      sync();
    }
  }
  document.addEventListener('selectionchange',remember);
  function fontName(value) {
    const name=String(value||'').replace(/["']/g,'').toLowerCase();
    return fonts.find(font=>name.includes(font.toLowerCase()))||'Georgia';
  }
  function sync(force=false) {
    if(!force&&document.activeElement?.closest('.toolbar'))return;
    const item=current(),editor=currentEditor();
    if(!item||!editor)return;
    const isBox=item.kind==='textbox';
    const selectedText=selectionIn(editor)&&!savedRange.collapsed;
    let probe=editor;
    if(selectionIn(editor)){
      const n=savedRange.startContainer;
      const candidate=n?.nodeType===1?n:n?.parentElement;
      if(candidate&&editor.contains(candidate))probe=candidate;
    }
    const css=getComputedStyle(probe);
    const field=isBox?{}:(item.textStyles?.[editor.classList[0]]||{});
    const family=isBox&&!selectedText?item.fontFamily:(field.fontFamily||css.fontFamily);
    const points=isBox&&!selectedText?(item.fontSize||12):(parseFloat(field.fontSize)||parseFloat(css.fontSize)*.75||12);
    controls.fontFamily.value=fontName(family);
    controls.fontSize.value=String(Math.round(points*10)/10);
    controls.textAlign.value=isBox?(item.textAlign||'left'):(field.textAlign||getComputedStyle(editor).textAlign||'left');
    const color=isBox&&!selectedText?(item.textColor||'#262137'):(field.color||css.color);
    const context=document.createElement('span');context.style.color=color;
    document.body.append(context);
    const rgb=getComputedStyle(context).color;
    context.remove();
    const match=rgb.match(/[\d.]+/g);
    if(match?.length>=3)controls.textColor.value='#'+match.slice(0,3).map(x=>Math.round(Number(x)).toString(16).padStart(2,'0')).join('');
    const weight=isBox&&!selectedText?(item.textWeight||'normal'):(field.fontWeight||css.fontWeight);
    const italic=isBox&&!selectedText?(item.fontStyle||'normal'):(field.fontStyle||css.fontStyle);
    const decoration=isBox&&!selectedText?(item.textDecoration||'none'):(field.textDecoration||css.textDecorationLine);
    for(const [i,on] of [Number(weight)>=600||weight==='bold',italic==='italic'||italic==='oblique',String(decoration).includes('underline')].entries()){
      buttons[i].setAttribute('aria-pressed',String(on));
    }
  }
  function restoreSelection(editor) {
    const restored=selectionIn(editor)?savedRange.cloneRange():null;
    if(editor.closest('.textbox')&&editor.contentEditable==='false')editor.contentEditable='true';
    editor.focus();
    if(restored){
      const s=window.getSelection();
      s.removeAllRanges();s.addRange(restored);
      savedRange=restored.cloneRange();
    }
  }
  function changeBlock(item,editor,property,value){
    if(item.kind==='textbox'){
      item[property]=value;
      const styles={fontFamily:'fontFamily',fontSize:'fontSize',textAlign:'textAlign',textColor:'color',textWeight:'fontWeight',fontStyle:'fontStyle',textDecoration:'textDecoration'};
      const cssProperty=styles[property];
      if(cssProperty)editor.style[cssProperty]=property==='fontSize'?value+'pt':value;
    } else {
      const field=editor.classList[0];
      item.textStyles ||= {};
      item.textStyles[field] ||= {};
      const cssProperty=property==='textColor'?'color':property;
      item.textStyles[field][cssProperty]=value;
      editor.style[cssProperty]=property==='fontSize'?value+'pt':value;
    }
    persist();
    sync(true);
  }
  // Track a selection by text offsets: execCommand can replace the selected text
  // nodes, invalidating a cloned DOM Range. This preserves successive commands
  // such as changing size and then color on the same highlighted word.
  function offsetsFor(editor,range){
    if(!range||range.collapsed)return null;
    const before=document.createRange();
    before.selectNodeContents(editor);
    before.setEnd(range.startContainer,range.startOffset);
    const start=before.toString().length;
    return {start,end:start+range.toString().length};
  }
  function rangeFor(editor,offsets){
    if(!offsets)return null;
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);
    let cursor=0,first=null,last=null,node;
    while((node=walker.nextNode())){
      const next=cursor+node.textContent.length;
      if(!first&&offsets.start<=next)first=[node,Math.min(node.length,Math.max(0,offsets.start-cursor))];
      if(!last&&offsets.end<=next)last=[node,Math.min(node.length,Math.max(0,offsets.end-cursor))];
      cursor=next;
    }
    if(!first||!last)return null;
    const restored=document.createRange();
    restored.setStart(...first);restored.setEnd(...last);
    return restored;
  }
  function inlineFormat(editor,cmd,value){
    const textOffsets=offsetsFor(editor,savedRange);
    // execCommand preserves existing nested spans and formats only the selection.
    // HTML font sizes 1–7 are browser presets, so convert the generated size-7
    // wrapper into a precise point value immediately.
    if(cmd==='fontSize'){
      for(const old of editor.querySelectorAll('font[size="7"]')){
        old.style.fontSize=getComputedStyle(old).fontSize;
        old.removeAttribute('size');
      }
    }
    formattingDepth++;
    try {
      restoreSelection(editor);
      document.execCommand(cmd,false,cmd==='fontSize'?'7':value);
      if(cmd==='fontSize'){
        for(const el of editor.querySelectorAll('font[size="7"]')){
          el.style.fontSize=value+'pt';el.removeAttribute('size');
        }
      }
    }finally{formattingDepth--}
    const restored=rangeFor(editor,textOffsets);
    if(restored){
      savedRange=restored;
      const selection=window.getSelection();
      selection.removeAllRanges();selection.addRange(restored);
    }
    editor.dispatchEvent(new CustomEvent('input',{bubbles:true,detail:{history:'format'}}));
    remember();sync(true);
  }
  function apply(property,value){
    const item=current(),editor=currentEditor();if(!item||!editor)return;
    const hasSelection=selectionIn(editor)&&!savedRange.collapsed;
    if(property==='textAlign'){changeBlock(item,editor,'textAlign',value);return}
    const toggles={bold:['textWeight','bold','normal'],italic:['fontStyle','italic','normal'],underline:['textDecoration','underline','none']};
    if(!hasSelection){
      if(toggles[property]){
        const [key,on,off]=toggles[property];
        const existing=item.kind==='textbox'?item[key]:item.textStyles?.[editor.classList[0]]?.[key];
        const computed=getComputedStyle(editor);
        const active=existing??(key==='textWeight'?computed.fontWeight:key==='fontStyle'?computed.fontStyle:computed.textDecorationLine);
        const isOn=key==='textWeight'?(active==='bold'||Number(active)>=600):String(active).includes(on);
        changeBlock(item,editor,key,isOn?off:on);
      }else changeBlock(item,editor,property,value);
      return;
    }
    const commands={bold:'bold',italic:'italic',underline:'underline',fontFamily:'fontName',fontSize:'fontSize',textColor:'foreColor'};
    inlineFormat(editor,commands[property],value);
  }
  for(const button of buttons){
    button.addEventListener('mousedown',e=>e.preventDefault());
    button.onclick=()=>apply(button.id);
  }
  controls.fontFamily.addEventListener('change',e=>apply('fontFamily',e.target.value));
  controls.fontSize.addEventListener('change',e=>{
    const value=Number(e.target.value);
    if(!Number.isFinite(value)||value<6||value>96){sync(true);return}
    apply('fontSize',value);
  });
  controls.textAlign.addEventListener('change',e=>apply('textAlign',e.target.value));
  controls.textColor.addEventListener('input',e=>apply('textColor',e.target.value));
  return {setFocusedEditor(node){lastEditor=node;remember();sync(true)},syncTextControls:()=>sync(true),isFormatting:()=>formattingDepth>0};
}
