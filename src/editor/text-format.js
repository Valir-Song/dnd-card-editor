// Shared card/textbox typography. Selection is retained independently of input focus.
// A live formatting span is updated in place instead of nesting a new span
// for every click on the font-size spinner.
export function setupTextFormatting({current,persist}) {
  const fonts=['Georgia','Arial','Times New Roman','Verdana','Courier New'];
  const controls={
    family:document.getElementById('fontFamily'),
    size:document.getElementById('fontSize'),
    align:document.getElementById('textAlign'),
    color:document.getElementById('textcolor')
  };
  const buttons=['bold','italic','underline'].map(id=>document.getElementById(id));
  let editor=null,range=null,liveSpan=null;
  const pageEditor=element=>element?.closest?.('.editable')?.closest('.page')?element.closest('.editable'):null;
  const contains=(root,node)=>!!(root&&node&&root.contains(node));
  const selectionBelongs=()=>!!(editor&&range&&contains(editor,range.commonAncestorContainer));
  const isSelected=()=>selectionBelongs()&&!range.collapsed;
  function forgetRange(){
    liveSpan?.classList.remove('format-target');
    liveSpan=null;range=null;
  }
  function editorForSelected(){
    const item=current();
    if(!item)return null;
    if(editor&&document.contains(editor)&&editor.closest('.el')?.dataset.id===item.id)return editor;
    const el=[...document.querySelectorAll('.el')].find(el=>el.dataset.id===item.id);
    if(!el)return null;
    return item.kind==='textbox'?el.querySelector('.textbox-editor'):null;
  }
  function capture(){
    const s=window.getSelection();if(!s?.rangeCount)return;
    const r=s.getRangeAt(0);
    const anchor=s.anchorNode?.nodeType===1?s.anchorNode:s.anchorNode?.parentElement;
    const next=pageEditor(anchor);
    if(!next||!contains(next,s.focusNode)||!contains(next,r.commonAncestorContainer))return;
    if(next!==editor){forgetRange();editor=next}
    const currentText=r.toString();
    if(liveSpan&&(!contains(next,liveSpan)||currentText!==liveSpan.textContent)) {
      liveSpan.classList.remove('format-target');liveSpan=null;
    }
    range=r.cloneRange();
    if(r.collapsed&&liveSpan){liveSpan.classList.remove('format-target');liveSpan=null}
    sync();
  }
  document.addEventListener('selectionchange',()=>{
    // The browser often moves its Selection to a number input. That must not
    // replace the saved editing range.
    if(document.activeElement?.closest('.toolbar'))return;
    capture();
  });
  document.querySelector('.toolbar')?.addEventListener('pointerdown',e=>{
    if(e.target.closest('input,select,button,label'))capture();
  },true);
  document.querySelector('.stage')?.addEventListener('pointerup',()=>queueMicrotask(capture));
  document.querySelector('.stage')?.addEventListener('keyup',()=>queueMicrotask(capture));
  function cssProbe(active) {
    if(liveSpan&&document.contains(liveSpan)&&contains(active,liveSpan))return liveSpan;
    if(!selectionBelongs())return active;
    let node=range.startContainer;
    if(node?.nodeType===1)node=node.childNodes[range.startOffset]||node.childNodes[Math.max(0,range.startOffset-1)]||node;
    while(node?.nodeType===1&&node.firstChild)node=node.firstChild;
    return (node?.nodeType===3?node.parentElement:node)||active;
  }
  function rgbHex(color) {
    const numbers=String(color).match(/[\d.]+/g);
    return numbers?.length>=3?'#'+numbers.slice(0,3).map(v=>Math.max(0,Math.min(255,Math.round(Number(v)))).toString(16).padStart(2,'0')).join(''):'#262137';
  }
  const normalizeFont=val=>fonts.find(font=>String(val).replace(/["']/g,'').toLowerCase().includes(font.toLowerCase()))||fonts[0];
  function sync(){
    const item=current(),node=editorForSelected();if(!item||!node)return;
    const box=item.kind==='textbox', selected=isSelected();
    const computed=getComputedStyle(cssProbe(node));
    const rootCss=getComputedStyle(node);
    const props=box?{}:(item.textStyles?.[node.classList[0]]||{});
    const family=selected?computed.fontFamily:(box?item.fontFamily:(props.fontFamily||rootCss.fontFamily));
    const size=selected?parseFloat(computed.fontSize)*.75:(box?item.fontSize:(parseFloat(props.fontSize)||parseFloat(rootCss.fontSize)*.75));
    controls.family.value=normalizeFont(family);
    // Do not overwrite the value the user is currently typing or spinning.
    if(document.activeElement!==controls.size&&Number.isFinite(size))
      controls.size.value=String(Math.round(size*10)/10);
    controls.align.value=box?(item.textAlign||'left'):(props.textAlign||rootCss.textAlign||'left');
    controls.color.value=rgbHex(selected?computed.color:(box?(item.textColor||'#262137'):(props.color||rootCss.color)));
    const weight=selected?computed.fontWeight:(box?(item.textWeight||'normal'):(props.fontWeight||rootCss.fontWeight));
    const italic=selected?computed.fontStyle:(box?(item.fontStyle||'normal'):(props.fontStyle||rootCss.fontStyle));
    const deco=selected?computed.textDecorationLine:(box?(item.textDecoration||'none'):(props.textDecoration||rootCss.textDecorationLine));
    [Number(weight)>=600||weight==='bold',italic==='italic'||italic==='oblique',String(deco).includes('underline')].forEach((on,i)=>buttons[i].setAttribute('aria-pressed',String(on)));
  }
  function persistFormatted(node,item,prop){
    const field=node.classList[0];
    item[field+'Html']=node.innerHTML;
    item[field]=node.innerText;
    persist({group:'format:'+item.id+':'+field+':'+prop,windowMs:350});
    sync();
  }
  function changeBlock(item,node,prop,value){
    if(item.kind==='textbox'){
      item[prop]=value;
    }else {
      const field=node.classList[0];
      item.textStyles ||= {};item.textStyles[field] ||= {};
      item.textStyles[field][prop==='textColor'?'color':prop]=value;
    }
    const cssName=prop==='textColor'?'color':prop;
    node.style[cssName]=prop==='fontSize'?value+'pt':value;
    persist({group:'format:'+item.id+':'+node.classList[0]+':'+prop,windowMs:350});
    sync();
  }
  function wrapSelection(){
    if(liveSpan&&document.contains(liveSpan)&&contains(editor,liveSpan))return liveSpan;
    if(!isSelected())return null;
    const saved=range.cloneRange();
    const fragment=saved.extractContents();
    const span=document.createElement('span');span.append(fragment);
    saved.insertNode(span);
    range=document.createRange();range.selectNodeContents(span);
    liveSpan=span;
    return span;
  }
  function selectedStyle(item,node,prop,value){
    const span=wrapSelection();if(!span)return;
    const cssProp=prop==='textColor'?'color':prop;
    // The selected value has precedence over older styling nested within it.
    const cssAttr=prop==='fontSize'?'font-size':prop==='fontFamily'?'font-family':prop==='textColor'?'color':cssProp.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
    for(const descendant of span.querySelectorAll('*')){
      descendant.style?.removeProperty(cssAttr);
      if(descendant.tagName==='FONT'){
        const attr={fontSize:'size',fontFamily:'face',textColor:'color'}[prop];
        if(attr)descendant.removeAttribute(attr);
      }
    }
    if(prop==='bold'||prop==='italic'||prop==='underline'){
      const css=getComputedStyle(span);
      const on=prop==='bold'?(css.fontWeight==='bold'||Number(css.fontWeight)>=600):prop==='italic'?css.fontStyle==='italic':css.textDecorationLine.includes('underline');
      const key={bold:'fontWeight',italic:'fontStyle',underline:'textDecoration'}[prop];
      span.style[key]=on?({fontWeight:'normal',fontStyle:'normal',textDecoration:'none'}[key]):({fontWeight:'bold',fontStyle:'italic',textDecoration:'underline'}[key]);
    }else span.style[cssProp]=prop==='fontSize'?value+'pt':value;
    // Maintain an explicit highlight while the numeric input has focus.
    span.classList.add('format-target');
    range=document.createRange();range.selectNodeContents(span);
    persistFormatted(node,item,prop);
  }
  function apply(prop,value){
    const item=current();const node=editorForSelected();if(!item||!node)return;
    editor=node;
    if(prop==='textAlign'){changeBlock(item,node,prop,value);return}
    if(isSelected()){
      if(item.kind==='textbox'&&range.toString()===node.textContent&&['fontSize','fontFamily','textColor'].includes(prop)){
        // Whole-box formatting must update the model's default too.
        if(liveSpan){liveSpan.classList.remove('format-target');liveSpan=null}
        range=null;
        if(prop==='fontSize')for(const child of node.querySelectorAll('*'))child.style?.removeProperty('font-size');
        changeBlock(item,node,prop,value);
      }else selectedStyle(item,node,prop,value);
    }else if(['bold','italic','underline'].includes(prop)){
      const computed=getComputedStyle(node);
      const key={bold:'fontWeight',italic:'fontStyle',underline:'textDecoration'}[prop];
      const old=key==='fontWeight'?computed.fontWeight:key==='fontStyle'?computed.fontStyle:computed.textDecorationLine;
      const on=prop==='bold'?(old==='bold'||Number(old)>=600):prop==='italic'?old==='italic':old.includes('underline');
      const newValue=on?({fontWeight:'normal',fontStyle:'normal',textDecoration:'none'}[key]):({fontWeight:'bold',fontStyle:'italic',textDecoration:'underline'}[key]);
      changeBlock(item,node,key,newValue);
    }else changeBlock(item,node,prop,value);
  }
  for(const button of buttons){
    button.addEventListener('mousedown',e=>e.preventDefault());
    button.addEventListener('click',()=>apply(button.id));
  }
  controls.family.addEventListener('change',e=>apply('fontFamily',e.target.value));
  controls.size.addEventListener('input',e=>{
    const v=e.target.value;if(v===''||v==='-'||v==='.')return;
    const n=Number(v);if(n<6||n>96||!Number.isFinite(n))return;
    apply('fontSize',n);
  });
  controls.align.addEventListener('change',e=>apply('textAlign',e.target.value));
  controls.color.addEventListener('input',e=>apply('textColor',e.target.value));
  return {
    setFocusedEditor(node){
      if(editor!==node){forgetRange();editor=node}
      capture();sync();
    },
    syncTextControls:sync,
    isFormatting:()=>false
  };
}
