// «Новый лист»: start another layout, either from the empty template built into the editor
// or from a copy of a ready sheet (library.js). The open layout is already saved in the
// browser, so it stays in «Мои макеты»; the new one gets its own id and undo history.
import { readLayoutFile } from './layout-file.js';
import { normalizeLayout } from './layout.js';
import { formatSize } from './layouts-dialog.js';
import { errorText } from './dom.js';

/** @typedef {import('../types/layout').Item} Item */
/** @typedef {import('./library.js').LibrarySheet} LibrarySheet */

/**
 * The objects of a ready sheet's file, or why it does not open.
 * @param {string} text
 * @returns {{items: Item[]} | {error: string}}
 */
export function readSheet(text) {
  const read = readLayoutFile(text);
  if ('error' in read) return {error: read.error};
  const {items, errors} = normalizeLayout(read.data);
  return items ? {items} : {error: errors.join('\n')};
}

/**
 * @param {{dialog: HTMLDialogElement, button: HTMLElement, template: () => Item[],
 *   library: ReturnType<typeof import('./library.js').createLibrary>,
 *   currentName: () => string, create: (items: Item[], name: string) => Promise<boolean>}} deps
 */
export function setupNewSheet({dialog, button, template, library, currentName, create}) {
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
  /** @param {Item[]} items @param {string} name */
  async function start(items, name) {
    if (await create(items, name)) dialog.close();
  }
  /** @param {LibrarySheet} sheet @param {HTMLButtonElement} take */
  async function takeSheet(sheet, take) {
    take.disabled = true; take.textContent = 'Загружаю…';
    try {
      const result = readSheet(await library.sheet(sheet));
      if ('error' in result) alert('Лист «' + sheet.name + '» не открывается:\n' + result.error);
      else await start(result.items, sheet.name);
    } catch (error) {
      alert('Не удалось загрузить лист «' + sheet.name + '» (' + errorText(error) + '). Проверьте интернет.');
    }
    take.disabled = false; take.textContent = 'Взять за основу';
  }
  async function fillLibrary(/** @type {HTMLElement} */ box) {
    box.replaceChildren(el('p', 'layouts-hint', 'Загружаю список…'));
    /** @type {LibrarySheet[]} */
    let sheets;
    try { sheets = await library.list(); } catch (error) {
      console.warn('Could not load the ready sheets from ' + library.base, error);
      box.replaceChildren(el('p', 'layouts-empty', 'Список готовых листов не загрузился: он лежит на сайте редактора, и нужен интернет. Пустой шаблон работает и без него.'),
        action('Попробовать ещё раз', () => void fillLibrary(box)));
      return;
    }
    if (!sheets.length) { box.replaceChildren(el('p', 'layouts-empty', 'Готовых листов пока нет.')); return; }
    const list = el('ul', 'layouts-list library-list');
    for (const sheet of sheets) {
      const row = el('li');
      row.dataset.file = sheet.file;
      const info = el('div', 'layouts-info');
      info.append(el('strong', '', sheet.name));
      if (sheet.summary) info.append(el('small', '', sheet.summary));
      info.append(el('small', '', 'объектов: ' + sheet.count + ' · ≈ ' + formatSize(sheet.bytes)));
      const take = action('Взять за основу', () => void takeSheet(sheet, take));
      const actions = el('div', 'layouts-actions');
      actions.append(take);
      row.append(info, actions);
      list.append(row);
    }
    box.replaceChildren(list);
  }
  function render() {
    const blank = el('ul', 'layouts-list');
    const row = el('li');
    const info = el('div', 'layouts-info');
    info.append(el('strong', '', 'Пустой шаблон'), el('small', '', 'Два листа с надписями «Имя персонажа», «Название заклинания»: замените их своими.'));
    const actions = el('div', 'layouts-actions');
    actions.append(action('Начать с нуля', () => void start(template(), '')));
    row.dataset.file = '';
    row.append(info, actions);
    blank.append(row);
    const box = el('div', 'library-box');
    const close = action('Закрыть', () => dialog.close());
    close.className = 'layouts-close';
    dialog.replaceChildren(
      el('h2', '', 'Новый лист'),
      el('p', 'layouts-hint', 'Текущий лист «' + currentName() + '» уже сохранён в браузере: вернуться к нему можно через «Мои макеты». Готовый лист открывается копией, оригинал не меняется.'),
      blank,
      el('h3', 'library-title', 'Готовые листы'),
      box,
      close);
    void fillLibrary(box);
  }
  button.onclick = () => { render(); if (!dialog.open) dialog.showModal(); };
  return {show: () => button.click()};
}
