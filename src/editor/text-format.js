// Toolbar formatting with preserved selection.
export function setupTextFormatting() {
let lastEditor = null, range = null;
// Preserve selection across toolbar focus changes
function remember(){const s=window.getSelection();if(s&&s.rangeCount&&s.anchorNode?.parentElement?.closest('.editable')){range=s.getRangeAt(0).cloneRange();lastEditor=s.anchorNode.parentElement.closest('.editable')}}
document.addEventListener('selectionchange',remember);
function format(cmd,val){if(!lastEditor||!document.contains(lastEditor))return;lastEditor.focus();if(range){const s=window.getSelection();s.removeAllRanges();s.addRange(range)}document.execCommand(cmd,false,val);lastEditor.dispatchEvent(new Event('input',{bubbles:true}));remember()}
for(const id of ['bold','italic','underline'])document.getElementById(id).addEventListener('mousedown',e=>e.preventDefault());
for(const id of ['bold','italic','underline'])document.getElementById(id).onclick=()=>format(id);
document.getElementById('font').onchange=e=>{if(e.target.value)format('fontSize',e.target.value);e.target.value=''};document.getElementById('textcolor').oninput=e=>format('foreColor',e.target.value);
return { setFocusedEditor(node) { lastEditor = node; } };
}
