// Present existing toolbar controls as accessible, compact tabs.
// Moving original DOM nodes keeps existing listeners and input IDs.
export function setupToolbarTabs() {
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar || toolbar.dataset.tabsReady === 'true') return;
  toolbar.dataset.tabsReady = 'true';
  const groups = [
    {id:'cards', label:'Карточки', ids:['add','duplicate','delete','lock','unlockPage']},
    {id:'appearance', label:'Оформление', ids:['bg','cardBgTools','imageTools']},
    {id:'text', label:'Текст', ids:['addTextBox','bold','italic','underline','strike','fontFamily','fontSize','textAlign','textcolor','bulletList','orderedList','clearFormatting','textBoxTools']},
    {id:'figures', label:'Фигуры и изображения', ids:['rect','circle','line','upload']},
    {id:'layers', label:'Слои', ids:['front','forward','backward','back']},
    {id:'align', label:'Выравнивание', ids:['alignLeft','alignCenter','alignRight','alignTop','alignMiddle','alignBottom','distributeX','distributeY','sameWidth','sameHeight']},
    {id:'files', label:'Файл', ids:['save','export','json','import','print','layoutName','layouts','compressImages','resetStorage']}
  ];
  const nodes = new Map();
  for(const id of ['undo','redo','saveState','snapTools',...groups.flatMap(group=>group.ids)]) {
    const node=document.getElementById(id);
    if(!node)throw new Error('Missing toolbar control: '+id);
    nodes.set(id,node.closest('label')||node);
  }
  const top=document.createElement('div');top.className='toolbar-top';
  const identity=document.createElement('div');identity.className='toolbar-identity';
  const title=toolbar.querySelector('strong');if(title)identity.append(title);
  top.append(identity);
  const history=document.createElement('div');history.className='toolbar-history';
  for(const id of ['undo','redo','saveState','snapTools'])history.append(nodes.get(id));
  top.append(history);
  const tablist=document.createElement('div');tablist.className='toolbar-tabs';
  tablist.setAttribute('role','tablist');tablist.setAttribute('aria-label','Разделы инструментов');
  const content=document.createElement('div');content.className='toolbar-content';
  const buttons=[],panels=[];
  for(const group of groups){
    const tab=document.createElement('button');
    tab.type='button';tab.className='toolbar-tab';tab.id='tab-'+group.id;
    tab.dataset.tab=group.id;tab.setAttribute('role','tab');
    tab.setAttribute('aria-controls','panel-'+group.id);tab.textContent=group.label;
    const panel=document.createElement('div');panel.className='toolbar-panel';
    panel.id='panel-'+group.id;panel.setAttribute('role','tabpanel');
    panel.setAttribute('aria-labelledby',tab.id);
    for(const id of group.ids)panel.append(nodes.get(id));
    tablist.append(tab);content.append(panel);buttons.push(tab);panels.push(panel);
  }
  const hint=toolbar.querySelector('.hint');
  if(hint){
    const help=document.createElement('details');help.className='toolbar-help';
    const summary=document.createElement('summary');summary.textContent='Подсказки';
    help.append(summary,hint);top.append(help);
  }
  // Keep live multi-selection status when rebuilding the toolbar into tabs.
  const selectionCount=toolbar.querySelector('#selectionCount');
  if(selectionCount)top.append(selectionCount);
  // Warnings live under the tabs so they stay visible with the sticky toolbar.
  const notices=toolbar.querySelector('#notices');
  toolbar.replaceChildren(top,tablist,content,...(notices?[notices]:[]));
  function activate(index,focus=false){
    buttons.forEach((button,i)=>{
      const active=i===index;
      button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
      panels[i].hidden=!active;
    });
    if(focus)buttons[index].focus();
  }
  buttons.forEach((tab,i)=>{
    tab.addEventListener('click',()=>activate(i));
    tab.addEventListener('keydown',event=>{
      const delta=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
      if(!delta&&event.key!=='Home'&&event.key!=='End')return;
      event.preventDefault();
      activate(event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+delta+buttons.length)%buttons.length,true);
    });
  });
  activate(0);
}
