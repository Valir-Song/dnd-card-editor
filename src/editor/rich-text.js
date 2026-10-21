// Unified rich-text editing for every document field, powered by Tiptap/ProseMirror.
// The layout editor owns object positions and undo/redo; Tiptap owns selections,
// marks, paragraphs and formatting. All editors share one toolbar.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';

const extensions=[
  StarterKit.configure({undoRedo:false}),
  TextStyleKit,
  TextAlign.configure({types:['paragraph','heading']})
];
const fonts=['Georgia','Arial','Times New Roman','Verdana','Courier New'];
const safeText=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const pxToPoints=px=>Math.round(parseFloat(px)*0.75*10)/10;

export function createRichText({current,select,persist,selectText=select}){
  const mounted=new Map();
  let activeKey=null,selection=null,silent=false;
  const controls={
    family:document.getElementById('fontFamily'),
    size:document.getElementById('fontSize'),
    color:document.getElementById('textcolor'),
    align:document.getElementById('textAlign')
  };
  const btns={
    bold:document.getElementById('bold'),
    italic:document.getElementById('italic'),
    underline:document.getElementById('underline'),
    strike:document.getElementById('strike'),
    bulletList:document.getElementById('bulletList'),
    orderedList:document.getElementById('orderedList')
  };
  const key=(id,field)=>id+':'+field;
  const active=()=>activeKey?mounted.get(activeKey):null;
  function clearState(){
    activeKey=null;selection=null;
    for(const button of Object.values(btns))button?.setAttribute('aria-pressed','false');
  }
  function destroy(){
    for(const mountedEditor of mounted.values())mountedEditor.editor.destroy();
    mounted.clear();clearState();
  }
  function makeHTML(item,field){
    let html=item[field+'Html'];
    if(typeof html!=='string')html=safeText(item[field]||'').replace(/\n/g,'<br>');
    // Legacy contenteditable data may contain <font face/color/size>.
    // Convert obsolete HTML formatting to marks that Tiptap can parse without
    // losing historical card styles. Only the text engine owns this conversion.
    const template=document.createElement('template');
    template.innerHTML=html;
    const oldSizes={1:'8pt',2:'10pt',3:'12pt',4:'14pt',5:'18pt',6:'24pt',7:'32pt'};
    for(const legacy of template.content.querySelectorAll('font')){
      const span=document.createElement('span');
      span.style.cssText=legacy.getAttribute('style')||'';
      if(legacy.hasAttribute('face')&&!span.style.fontFamily)span.style.fontFamily=legacy.getAttribute('face');
      if(legacy.hasAttribute('color')&&!span.style.color)span.style.color=legacy.getAttribute('color');
      if(legacy.hasAttribute('size')&&!span.style.fontSize)
        span.style.fontSize=oldSizes[legacy.getAttribute('size')]||'12pt';
      while(legacy.firstChild)span.append(legacy.firstChild);
      legacy.replaceWith(span);
    }
    html=template.innerHTML;
    if(!/^\s*<(p|div|ul|ol|h[1-6]|blockquote|pre)\b/i.test(html))html='<p>'+html+'</p>';
    return html;
  }
  function focusField(id,field,range){
    const record=mounted.get(key(id,field));
    if(!record)return;
    activeKey=key(id,field);
    const docSize=record.editor.state.doc.content.size;
    const to=Math.max(1,docSize-1);
    const original=range&&Number.isFinite(range.from)?range:{from:to,to};
    record.editor.commands.setTextSelection({
      from:Math.min(Math.max(1,original.from),to),
      to:Math.min(Math.max(1,original.to),to)
    });
    record.editor.commands.focus();
    selection={key:activeKey,from:record.editor.state.selection.from,to:record.editor.state.selection.to};
    sync();
  }
  function mount(node,item,field){
    const id=item.id,fieldKey=key(id,field);
    const editor=new Editor({
      element:node,
      extensions,
      content:makeHTML(item,field),
      injectCSS:false,
      editorProps:{
        attributes:{
          class:'tiptap-content',
          spellcheck:'false',
          'aria-label':'Редактировать '+field
        }
      },
      onFocus:({editor:instance})=>{
        activeKey=fieldKey;
        const element=node.closest('.el');
        if(element)selectText(element,field);
        selection={key:fieldKey,from:instance.state.selection.from,to:instance.state.selection.to};
        sync();
      },
      onSelectionUpdate:({editor:instance})=>{
        if(activeKey!==fieldKey||silent)return;
        selection={key:fieldKey,from:instance.state.selection.from,to:instance.state.selection.to};
        sync();
      },
      onUpdate:({editor:instance})=>{
        if(silent)return;
        item[field+'Html']=instance.getHTML();
        item[field]=instance.getText({blockSeparator:'\n'});
        if(item.kind==='textbox'&&item.autoHeight){
          const box=node.closest('.el');
          const page=box?.closest('.page');
          if(box&&page){
            const factor=210/page.getBoundingClientRect().width;
            item.h=Math.max(8,Math.min(297-item.y,box.getBoundingClientRect().height*factor));
          }
        }
        persist({group:'text:'+id+':'+field,windowMs:650});
        sync();
      }
    });
    mounted.set(fieldKey,{editor,item,field,node});
    // On a canvas redraw the previous editor is destroyed. The next pointer
    // interaction must nominate the replacement editor even if browser focus
    // events are suppressed by overlay controls or a previously focused field.
    node.addEventListener('pointerdown',e=>{
      e.stopPropagation();
      activeKey=fieldKey;
      const state=editor.state.selection;
      selection={key:fieldKey,from:state.from,to:state.to};
      sync();
    });
    // Editing a Tiptap textbox begins with a click; object movement remains on
    // the separate handle. Both boxed and card text use exactly this editor.
    return editor;
  }
  function ensureTarget(){
    const a=active();if(!a)return null;
    const ed=a.editor;
    if(selection?.key===activeKey){
      const {from,to}=selection;
      const max=ed.state.doc.content.size;
      const lo=Math.min(Math.max(1,from),max-1);
      const hi=Math.min(Math.max(lo,to),max-1);
      if(ed.state.selection.from!==lo||ed.state.selection.to!==hi){
        silent=true;
        try{ed.commands.setTextSelection({from:lo,to:hi})}
        finally{silent=false}
      }
    }
    return a;
  }
  function run(command,styleKey,value){
    const a=ensureTarget();if(!a)return;
    const ed=a.editor;
    const before=ed.state.selection;
    const collapsed=before.empty;
    // A caret or object selection formats its entire text field, so existing
    // characters visibly change immediately rather than just future typing.
    silent=true;
    try{
      if(collapsed)ed.commands.selectAll();
      switch(command){
        case 'fontSize':ed.commands.setFontSize(value+'pt');break;
        case 'fontFamily':ed.commands.setFontFamily(value);break;
        case 'color':ed.commands.setColor(value);break;
        case 'textAlign':ed.commands.setTextAlign(value);break;
        case 'bold':ed.commands.toggleBold();break;
        case 'italic':ed.commands.toggleItalic();break;
        case 'underline':ed.commands.toggleUnderline();break;
        case 'strike':ed.commands.toggleStrike();break;
        case 'bulletList':ed.commands.toggleBulletList();break;
        case 'orderedList':ed.commands.toggleOrderedList();break;
        case 'clear':ed.commands.unsetAllMarks();break;
      }
      if(collapsed){
        const pos=Math.min(before.from,ed.state.doc.content.size-1);
        ed.commands.setTextSelection(Math.max(1,pos));
      }
    }finally{silent=false}
    // Transactions happened while notifications were paused; persist exactly
    // one final state and preserve the text engine's own selected range.
    a.item[a.field+'Html']=ed.getHTML();
    a.item[a.field]=ed.getText({blockSeparator:'\n'});
    persist({group:'format:'+a.item.id+':'+a.field+':'+(styleKey||command),windowMs:450});
    selection={key:activeKey,from:ed.state.selection.from,to:ed.state.selection.to};
    sync();
  }
  function readSize(a){
    const fromMarks=a.editor.getAttributes('textStyle').fontSize;
    if(fromMarks){
      const numeric=parseFloat(fromMarks);
      return String(fromMarks).endsWith('px')?pxToPoints(numeric):numeric;
    }
    const root=a.editor.view.dom;
    const selection=a.editor.state.selection;
    if(!selection.empty){
      const node=a.editor.view.nodeDOM(selection.from);
      const element=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
      const marker=element?.closest('[style*="font-size"]');
      if(marker&&root.contains(marker))return pxToPoints(getComputedStyle(marker).fontSize);
    }
    return pxToPoints(getComputedStyle(root).fontSize);
  }
  function sync(){
    const a=active();if(!a)return;
    const ed=a.editor;
    const family=ed.getAttributes('textStyle').fontFamily||getComputedStyle(ed.view.dom).fontFamily;
    controls.family.value=fonts.find(x=>family.toLowerCase().includes(x.toLowerCase()))||'Georgia';
    const size=readSize(a);
    if(document.activeElement!==controls.size&&Number.isFinite(size))
      controls.size.value=String(Math.round(size*10)/10);
    const color=ed.getAttributes('textStyle').color||getComputedStyle(ed.view.dom).color;
    const rgb=color.match(/[\d.]+/g);
    if(color.startsWith('#')&&/^#[0-9a-f]{6}$/i.test(color))controls.color.value=color;
    else if(rgb?.length>=3)controls.color.value='#'+rgb.slice(0,3).map(n=>Math.round(Number(n)).toString(16).padStart(2,'0')).join('');
    controls.align.value=ed.getAttributes('paragraph').textAlign||'left';
    for(const [mark,button] of Object.entries(btns))button?.setAttribute('aria-pressed',String(ed.isActive(mark)));
  }
  for(const [name,button] of Object.entries(btns)){
    if(!button)continue;
    button.addEventListener('pointerdown',e=>e.preventDefault());
    button.addEventListener('click',()=>run(name,name));
  }
  controls.family.addEventListener('change',()=>run('fontFamily','fontFamily',controls.family.value));
  controls.color.addEventListener('change',()=>run('color','color',controls.color.value));
  controls.align.addEventListener('change',()=>run('textAlign','textAlign',controls.align.value));
  controls.size.addEventListener('input',()=>{
    const raw=controls.size.value;
    if(raw===''||raw==='-'||raw==='.')return;
    const numeric=Number(raw);
    if(!Number.isFinite(numeric)||numeric<6||numeric>96)return;
    run('fontSize','fontSize',numeric);
  });
  document.getElementById('clearFormatting')?.addEventListener('click',()=>run('clear','clear'));
  return {mount,destroy,focusField,sync,active,clearState};
}
