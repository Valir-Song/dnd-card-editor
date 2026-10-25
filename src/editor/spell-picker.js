// «Заклинание…» on the «Карточки» tab: pick spells from the reference (spells.js) and get
// cards in the style of the owner's sheet. The reference is fetched from the editor's site
// when the dialog opens (library.js); the cards keep their full text, so «📖» on a card works
// offline and in a file from disk.
import { readSpells, spellCards, filterSpells, readDc, spellMeta, withDc, boldPieces, MAX_AT_ONCE, CLASSES } from './spells.js';
import { errorText, target } from './dom.js';

/** @typedef {import('./spells.js').Spell} Spell */

const DC_KEY = 'dnd-card-editor-spell-dc';
const CLASS_KEY = 'dnd-card-editor-spell-class';

/**
 * @param {import('../types/layout').Deps<'addObjects'> & {dialog: HTMLDialogElement, infoDialog: HTMLDialogElement,
 *   button: HTMLElement, library: ReturnType<typeof import('./library.js').createLibrary>}} deps
 */
export function setupSpellPicker({dialog, infoDialog, button, library, addObjects, store}) {
  /** @param {string} tag @param {string} [className] @param {string} [text] */
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  /** @param {string} label @param {() => void} onClick */
  const action = (label, onClick) => {
    const node = /** @type {HTMLButtonElement} */ (el('button', '', label));
    node.type = 'button'; node.onclick = onClick;
    return node;
  };
  /** @type {{spells: Spell[], attribution: string} | null} */
  let reference = null;
  /** @type {Set<string>} */
  const chosen = new Set();
  let query = '', level = /** @type {number | null} */ (null);
  let dcText = '';
  let cls = '';
  try { dcText = localStorage.getItem(DC_KEY) || ''; cls = localStorage.getItem(CLASS_KEY) || ''; } catch { /* storage may be off: nothing remembered */ }
  if (!CLASSES.some(c => c.id === cls)) cls = '';

  const search = /** @type {HTMLInputElement} */ (el('input'));
  search.type = 'search'; search.placeholder = 'Поиск по названию'; search.className = 'spell-search';
  const levels = /** @type {HTMLSelectElement} */ (el('select'));
  levels.className = 'spell-level';
  levels.append(new Option('Все круги', ''), new Option('Заговоры', '0'), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => new Option(n + ' круг', String(n))));
  const classes = /** @type {HTMLSelectElement} */ (el('select'));
  classes.className = 'spell-class';
  classes.title = 'Список заклинаний класса. Мистический рыцарь и Мистический ловкач берут заклинания из списка волшебника (до 4 круга).';
  classes.append(new Option('Все классы', ''), ...CLASSES.map(c => new Option(c.label, c.id)));
  classes.value = cls;
  const dc = /** @type {HTMLInputElement} */ (el('input'));
  dc.type = 'number'; dc.min = '1'; dc.max = '30'; dc.className = 'spell-dc'; dc.placeholder = '—';
  dc.title = 'Сложность спасброска ваших заклинаний: на карточку попадёт «Мудрость СЛ 14» вместо «Спасбросок Мудрости». Пусто — без числа.';
  const list = el('ul', 'layouts-list spell-list');
  const insert = action('Вставить', () => insertChosen());
  insert.className = 'spell-insert';
  const status = el('span', 'spell-status');
  const body = el('div', 'spell-body');
  const footer = el('p', 'spell-source');

  function renderList() {
    if (!reference) return;
    const shown = filterSpells(reference.spells, {query, level, cls});
    const number = readDc(dcText);
    list.replaceChildren(...shown.map(spell => {
      const row = el('li');
      row.dataset.spell = spell.id;
      const box = /** @type {HTMLInputElement} */ (el('input'));
      box.type = 'checkbox'; box.checked = chosen.has(spell.id);
      box.setAttribute('aria-label', spell.name);
      box.onchange = () => { if (box.checked) chosen.add(spell.id); else chosen.delete(spell.id); syncInsert(); };
      const label = el('label', 'spell-row');
      const info = el('div', 'layouts-info');
      const title = el('strong', '', spell.name);
      title.append(' ', el('span', 'spell-en', spell.nameEn));
      info.append(title, el('small', 'spell-meta', spellMeta(spell)), el('small', '', withDc(spell.short, number)));
      label.append(box, info);
      row.append(label);
      return row;
    }));
    if (!shown.length) list.replaceChildren(el('li', 'layouts-empty', 'Ничего не нашлось.'));
    syncInsert();
  }
  function syncInsert() {
    insert.disabled = !chosen.size || chosen.size > MAX_AT_ONCE;
    insert.textContent = chosen.size ? 'Вставить (' + chosen.size + ')' : 'Вставить';
    status.textContent = chosen.size > MAX_AT_ONCE ? 'Не больше ' + MAX_AT_ONCE + ' за раз' : '';
  }
  function insertChosen() {
    if (!reference || !chosen.size || chosen.size > MAX_AT_ONCE) return;
    const spells = filterSpells(reference.spells, {query: '', level: null}).filter(spell => chosen.has(spell.id));
    addObjects(spellCards(spells, readDc(dcText)));
    chosen.clear();
    dialog.close();
  }
  async function load() {
    if (reference) { renderList(); return; }
    list.replaceChildren(el('li', 'layouts-hint', 'Загружаю справочник…'));
    try {
      reference = readSpells(await library.spells());
      if (!reference) throw Error('справочник повреждён');
    } catch (error) {
      console.warn('Could not load the spell reference from ' + library.base, error);
      list.replaceChildren(el('li', 'layouts-empty', 'Справочник не загрузился (' + errorText(error) + '): он лежит на сайте редактора, и в первый раз нужен интернет.'));
      const again = action('Попробовать ещё раз', () => void load());
      list.append(again);
      return;
    }
    footer.textContent = 'Перевод System Reference Document 5.2 (Wizards of the Coast), лицензия CC-BY 4.0.';
    footer.title = reference.attribution;
    renderList();
  }
  search.oninput = () => { query = search.value; renderList(); };
  levels.onchange = () => { level = levels.value === '' ? null : Number(levels.value); renderList(); };
  classes.onchange = () => {
    cls = classes.value;
    try { localStorage.setItem(CLASS_KEY, cls); } catch { /* not remembered: fine */ }
    renderList();
  };
  dc.value = dcText;
  dc.oninput = () => {
    dcText = dc.value;
    try { localStorage.setItem(DC_KEY, dcText); } catch { /* not remembered: fine */ }
    renderList();
  };
  const dcLabel = el('label', 'spell-dc-label', 'Моя СЛ ');
  dcLabel.append(dc);
  const filters = el('div', 'spell-filters');
  filters.append(search, classes, levels, dcLabel);
  body.append(list);
  const close = action('Закрыть', () => dialog.close());
  close.className = 'layouts-close';
  const actions = el('div', 'spell-actions');
  actions.append(status, insert, close);

  button.onclick = () => {
    dialog.replaceChildren(
      el('h2', '', 'Заклинание из справочника'),
      el('p', 'layouts-hint', 'Отметьте заклинания — каждое станет карточкой: круг, дистанция, длительность и суть в одну строку. Полный текст — по кнопке 📖 на карточке.'),
      filters, body, actions, footer);
    if (!dialog.open) dialog.showModal();
    search.focus();
    void load();
  };

  // «📖» on a card: its full text, kept in the card.
  /** @param {string} id */
  function showInfo(id) {
    const item = store.find(id);
    if (!item?.spellText) return;
    const [heading = '', ...paragraphs] = item.spellText.split('\n\n');
    const text = el('div', 'spell-info-text');
    for (const paragraph of paragraphs) {
      const p = el('p');
      for (const piece of boldPieces(paragraph)) p.append(piece.bold ? el('b', '', piece.text) : document.createTextNode(piece.text));
      text.append(p);
    }
    const head = el('div', 'help-head');
    const shut = action('✕', () => infoDialog.close());
    shut.className = 'help-close'; shut.setAttribute('aria-label', 'Закрыть'); shut.title = 'Закрыть (Esc)';
    head.append(el('h2', '', heading), shut);
    infoDialog.replaceChildren(head, text);
    if (!infoDialog.open) infoDialog.showModal();
  }
  document.addEventListener('click', event => {
    const info = target(event).closest('.spell-info');
    const card = info?.closest('.el');
    if (!info || !(card instanceof HTMLElement)) return;
    event.preventDefault();
    showInfo(card.dataset.id || '');
  });
  infoDialog.addEventListener('click', event => { if (event.target === infoDialog) infoDialog.close(); });
  return {show: () => button.click()};
}
