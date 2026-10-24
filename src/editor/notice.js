// Persistent, non-blocking warnings under the toolbar (storage full, damaged save).
// Each notice has an id, so repeated failures update one message instead of stacking.
// A notice the user closed stays hidden until the code clears it (problem resolved).
/** @typedef {{label: string, onClick: () => void}} NoticeAction */
/** @param {HTMLElement} container */
export function createNotices(container){
  /** @type {Map<string, HTMLElement>} */
  const shown=new Map();
  /** @type {Set<string>} */
  const dismissed=new Set();
  /** @param {string} id @param {string} message @param {NoticeAction[]} [actions] */
  function show(id,message,actions=[]){
    if(dismissed.has(id))return;
    let node=shown.get(id);
    if(node?.dataset.message===message)return;
    if(!node){
      node=document.createElement('div');
      node.className='notice';node.dataset.notice=id;node.setAttribute('role','alert');
      container.append(node);shown.set(id,node);
    }
    const text=document.createElement('span');text.textContent=message;
    const buttons=actions.map(({label,onClick})=>{
      const button=document.createElement('button');
      button.type='button';button.textContent=label;button.onclick=onClick;
      return button;
    });
    const close=document.createElement('button');
    close.type='button';close.className='notice-close';close.textContent='×';
    close.title='Скрыть';close.setAttribute('aria-label','Скрыть предупреждение');
    close.onclick=()=>{remove(id);dismissed.add(id)};
    node.dataset.message=message;
    node.replaceChildren(text,...buttons,close);
  }
  /** @param {string} id */
  function remove(id){shown.get(id)?.remove();shown.delete(id)}
  /** @param {string} id */
  function hide(id){remove(id);dismissed.delete(id)}
  return {show,hide,has:(/** @type {string} */ id)=>shown.has(id)};
}
