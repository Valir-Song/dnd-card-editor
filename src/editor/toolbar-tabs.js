import { icon, ICONS } from './icons.js';

// The toolbar as a ribbon (3.11 beta.12): tabs sit in the dark top bar next to undo and
// saving; under them every tab is a row of named groups. A group is either big
// buttons (icon above a short label) or up to two rows of small controls.
// Moving original DOM nodes keeps existing listeners and input IDs.
// The ribbon has one fixed height, so switching tabs or selecting objects
// never makes the sheet jump; a ribbon wider than the window scrolls sideways.

// [group name, 'big' | 'rows', ids, hint] — for 'rows' ids is a list of rows.
// A hint stands in for tools shown only with a fitting selection (styles.css).
/** @typedef {[string, 'big', string[]] | [string, 'rows', string[][], string?]} Section */
/** @type {{id: string, label: string, sections: Section[]}[]} */
const GROUPS = [
  {id:'cards', label:'Карточки', sections:[
    ['Добавить', 'big', ['add','addResources']],
    ['Правка', 'big', ['duplicate','delete']],
    ['Ресурсы', 'big', ['addSpellRow','addExtraRow','shortRest','longRest']],
    ['Закрепление', 'big', ['lock','unlockPage']],
    ['Фон карточки', 'rows', [['cardBgTools']], 'Выделите карточку, чтобы поставить ей картинку на фон'],
  ]},
  {id:'appearance', label:'Оформление', sections:[
    ['Тема', 'rows', [['theme'],['themePage','bg']]],
    ['Рамка', 'rows', [['outlineTools']]],
    ['Фон листа', 'rows', [['sheetTools']]],
  ]},
  {id:'text', label:'Текст', sections:[
    ['Добавить', 'big', ['addTextBox']],
    ['Шрифт', 'rows', [['fontFamily','fontSize'],['bold','italic','underline','strike','textcolor']]],
    ['Абзац', 'rows', [['textAlign'],['bulletList','orderedList','clearFormatting']]],
    ['Текстовое поле', 'rows', [['textBoxTools']], 'Выделите текстовое поле: заливка и рамка'],
  ]},
  {id:'figures', label:'Фигуры', sections:[
    ['Фигуры', 'big', ['rect','circle','line']],
    ['Картинка', 'big', ['uploadLabel']],
    ['Настройка картинки', 'rows', [['imageTools']], 'Выделите картинку: прозрачность, яркость, поворот'],
  ]},
  {id:'badges', label:'Кружочки', sections:[
    ['Кружок', 'big', ['addBadge','removeBadge']],
    ['Цвет', 'rows', [['badgeColors']]],
    ['Знак вместо цифры', 'rows', [['badgeSymbols']]],
  ]},
  {id:'layers', label:'Слои', sections:[
    ['Порядок', 'big', ['front','forward','backward','back']],
  ]},
  {id:'align', label:'Выравнивание', sections:[
    ['Выровнять', 'big', ['alignLeft','alignCenter','alignRight','alignTop','alignMiddle','alignBottom']],
    ['Распределить', 'big', ['distributeX','distributeY']],
    ['Размер', 'big', ['sameWidth','sameHeight']],
  ]},
  {id:'files', label:'Файл', sections:[
    ['Файл', 'big', ['newSheet','openFile']],
    ['Браузер', 'big', ['save','layouts']],
    ['Название', 'rows', [['layoutName']]],
    ['Скачать и открыть', 'big', ['export','json','importLabel','print']],
    ['Обслуживание', 'big', ['compressImages','resetStorage']],
  ]},
];
// Small buttons shown by their icon only; the label stays for screen readers.
const ICON_ONLY = new Set(['undo','redo','saveFileAs','bgRemove','resetImage','bold','italic','underline','strike','bulletList','orderedList','clearFormatting']);
const TOP = ['undo','redo','saveFile','saveFileAs','saveState','fileState','snapTools','help'];

// Put the control's own text into one <span class="rb-label"> after its icon,
// so code that renames a button (see setLabel in dom.js) keeps the icon.
/** @param {HTMLElement} node @param {string} id */
function decorate(node, id) {
  const text = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE);
  const label = document.createElement('span');
  label.className = 'rb-label';
  label.textContent = text.map(child => child.textContent).join('').trim();
  for (const child of text) child.remove();
  const svg = icon(id);
  node.prepend(...(svg ? [svg] : []), label);
  if (ICON_ONLY.has(id)) node.classList.add('rb-icon-only');
}

export function setupToolbarTabs() {
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar || toolbar.dataset.tabsReady === 'true') return;
  toolbar.dataset.tabsReady = 'true';
  /** @type {Map<string, HTMLElement>} */
  const nodes = new Map();
  const ids = [...TOP, ...GROUPS.flatMap(group => group.sections.flatMap(([, kind, list]) => kind === 'big' ? list : list.flat()))];
  for (const id of ids) {
    const node = document.getElementById(id);
    if (!node) throw new Error('Missing toolbar control: ' + id);
    nodes.set(id, node.closest('label') || node);
  }
  const top = document.createElement('div'); top.className = 'toolbar-top';
  const identity = document.createElement('div'); identity.className = 'toolbar-identity';
  const title = toolbar.querySelector('strong');
  if (title) {
    // «Ричард · редактор 3.11 beta»: the name stays, the version becomes a tooltip.
    const [name, version] = (title.textContent || '').split(' · ');
    title.textContent = name;
    if (version) identity.title = version;
    const d20 = icon('d20');
    if (d20) identity.append(d20);
    identity.append(title);
  }
  const tablist = document.createElement('div'); tablist.className = 'toolbar-tabs';
  tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', 'Разделы инструментов');
  top.append(identity, tablist);
  const history = document.createElement('div'); history.className = 'toolbar-history';
  for (const id of ['undo','redo','saveFile','saveFileAs','help']) {
    const node = /** @type {HTMLElement} */ (nodes.get(id));
    decorate(node, id); node.classList.add('rb-top');
  }
  const save = document.createElement('span'); save.className = 'rb-save';
  save.append(/** @type {HTMLElement} */ (nodes.get('saveFile')), /** @type {HTMLElement} */ (nodes.get('saveFileAs')));
  history.append(/** @type {HTMLElement} */ (nodes.get('undo')), /** @type {HTMLElement} */ (nodes.get('redo')), save);
  for (const id of ['saveState','fileState','snapTools']) history.append(/** @type {HTMLElement} */ (nodes.get(id)));
  // Snapping and the grid: icon pills; the checkbox stays the real control.
  const snapTools = /** @type {HTMLElement} */ (nodes.get('snapTools'));
  snapTools.querySelectorAll('label').forEach((label, i) => { decorate(label, i ? 'grid' : 'snap'); label.classList.add('rb-icon-only'); });
  history.append(/** @type {HTMLElement} */ (nodes.get('help')));
  top.append(history);
  const content = document.createElement('div'); content.className = 'toolbar-content';
  /** @type {HTMLButtonElement[]} */
  const buttons = [];
  /** @type {HTMLElement[]} */
  const panels = [];
  for (const group of GROUPS) {
    const tab = document.createElement('button');
    tab.type = 'button'; tab.className = 'toolbar-tab'; tab.id = 'tab-' + group.id;
    tab.dataset.tab = group.id; tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'panel-' + group.id); tab.textContent = group.label;
    const panel = document.createElement('div'); panel.className = 'toolbar-panel';
    panel.id = 'panel-' + group.id; panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    for (const [name, kind, list, hint] of group.sections) {
      const section = document.createElement('div'); section.className = 'rb-group';
      const body = document.createElement('div'); body.className = 'rb-body rb-' + kind;
      if (hint) body.dataset.hint = hint;
      const caption = document.createElement('div'); caption.className = 'rb-name'; caption.textContent = name;
      const rows = kind === 'big' ? [list] : /** @type {string[][]} */ (list);
      for (const row of rows) {
        const line = kind === 'big' ? body : document.createElement('div');
        if (line !== body) { line.className = 'rb-row'; body.append(line); }
        for (const id of row) {
          const node = /** @type {HTMLElement} */ (nodes.get(id));
          const plain = node.tagName === 'BUTTON' || (node.tagName === 'LABEL' && !!node.querySelector('input[type=file]'));
          if (plain) { decorate(node, id); node.classList.add(kind === 'big' ? 'rb-large' : 'rb-small'); }
          else if (node.tagName === 'LABEL') node.classList.add('rb-field');
          // Buttons inside a tool group get their icon too (when there is one).
          else for (const button of node.querySelectorAll('button[id]')) if (ICONS[button.id]) decorate(/** @type {HTMLElement} */ (button), button.id);
          line.append(node);
        }
      }
      section.append(body, caption);
      panel.append(section);
    }
    tablist.append(tab); content.append(panel); buttons.push(tab); panels.push(panel);
  }
  // Keep live multi-selection status when rebuilding the toolbar into tabs.
  const selectionCount = toolbar.querySelector('#selectionCount');
  if (selectionCount) history.prepend(selectionCount);
  // Warnings live under the ribbon so they stay visible with the sticky toolbar.
  const notices = toolbar.querySelector('#notices');
  toolbar.replaceChildren(top, content, ...(notices ? [notices] : []));
  /** @param {number} index */
  function activate(index, focus = false) {
    buttons.forEach((button, i) => {
      const active = i === index;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      panels[i].hidden = !active;
    });
    if (focus) buttons[index].focus();
  }
  buttons.forEach((tab, i) => {
    tab.addEventListener('click', () => activate(i));
    tab.addEventListener('keydown', event => {
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!delta && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      activate(event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (i + delta + buttons.length) % buttons.length, true);
    });
  });
  activate(0);
}
