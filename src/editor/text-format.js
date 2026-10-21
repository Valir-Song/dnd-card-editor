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
  // Capture the current range *before* toolbar controls take keyboard focus.
  // Firefox can clear the DOM selection when focusing a number input.
  const toolbar=document.querySelector('.toolbar');
  toolbar?.addEventListener('pointerdown',event=>{
    if(event.target.closest('input,select,button,label'))remember();
  },true);
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
      const atStart=n?.nodeType===1?(n.childNodes[savedRange.startOffset]||n.childNodes[Math.max(0,savedRange.startOffset-1)]||n):n;
      const candidate=atStart?.nodeType===1?atStart:atStart?.parentElement;
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
      if(!first&&offsets.start<next)first=[node,Math.min(node.length,Math.max(0,offsets.start-cursor))];
      if(!last&&offsets.end<=next)last=[node,Math.min(node.length,Math.max(0,offsets.end-cursor))];
      cursor=next;
    }
    if(!first||!last)return null;
    const restored=document.createRange();
    restored.setStart(...first);restored.setEnd(...last);
    return restored;
  }
  function styleSelected(editor,property,value){
    // Editing a saved DOM Range does not require re-focusing contenteditable.
    // This is much more reliable than execCommand('fontSize'), especially in
    // Firefox, where a numeric input steals the editor's text selection.
    const offsets=offsetsFor(editor,savedRange);
    if(!offsets)return;
    const original=savedRange.cloneRange();
    const contents=original.extractContents();
    const wrap=document.createElement('span');
    const propertyNames={fontSize:'font-size',fontFamily:'font-family',textColor:'color'};
    const cssProperty=propertyNames[property];
    for(const descendant of contents.querySelectorAll('*')){
      if(descendant.style)descendant.style.removeProperty(cssProperty);
      if(descendant.tagName==='FONT'){
        if(property==='fontSize')descendant.removeAttribute('size');
        if(property==='fontFamily')descendant.removeAttribute('face');
        if(property==='textColor')descendant.removeAttribute('color');
      }
    }
    wrap.style.setProperty(cssProperty,property==='fontSize'?value+'pt':value);
    wrap.append(contents);
    original.insertNode(wrap);
    const restored=document.createRange();
    restored.selectNodeContents(wrap);
    savedRange=restored;
    const selection=window.getSelection();
    selection.removeAllRanges();selection.addRange(restored);
    editor.dispatchEvent(new CustomEvent('input',{bubbles:true,detail:{history:'format'}}));
    sync(true);
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
    // If the entire independent box is selected, this is a box-wide style:
    // keep the item's own fontSize up to date for the next selection.
    if(item.kind==='textbox'&&hasSelection&&['fontFamily','fontSize','textColor'].includes(property)){
      const region=offsetsFor(editor,savedRange);
      if(region?.start===0&&region.end===editor.textContent.length){
        for(const descendant of editor.querySelectorAll('*')){
          const cssProperty={fontFamily:'font-family',fontSize:'font-size',textColor:'color'}[property];
          descendant.style?.removeProperty(cssProperty);
          if(descendant.tagName==='FONT')descendant.removeAttribute({fontSize:'size',fontFamily:'face',textColor:'color'}[property]);
        }
        item.textHtml=editor.innerHTML;
        changeBlock(item,editor,property,value);
        return;
      }
    }
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
    if(['fontFamily','fontSize','textColor'].includes(property)){
      styleSelected(editor,property,value);
    }else{
      const commands={bold:'bold',italic:'italic',underline:'underline'};
      inlineFormat(editor,commands[property],value);
    }
  }
  for(const button of buttons){
    button.addEventListener('mousedown',e=>e.preventDefault());
    button.onclick=()=>apply(button.id);
  }
  controls.fontFamily.addEventListener('change',e=>apply('fontFamily',e.target.value));
  // 'input' fires for spinner arrows as well as typing; 'change' alone
  // can wait until blur and lose the browser selection in Firefox.
  controls.fontSize.addEventListener('input',e=>{
    const raw=e.target.value;
    if(raw===''||raw==='-'||raw==='.')return;
    const value=Number(raw);
    if(!Number.isFinite(value)||value<6||value>96)return;
    apply('fontSize',value);
  });
  controls.textAlign.addEventListener('change',e=>apply('textAlign',e.target.value));
  controls.textColor.addEventListener('input',e=>apply('textColor',e.target.value));
  return {setFocusedEditor(node){lastEditor=node;remember();sync(true)},syncTextControls:()=>sync(true),isFormatting:()=>formattingDepth>0};
}
