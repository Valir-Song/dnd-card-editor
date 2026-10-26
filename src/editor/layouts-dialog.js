// «Мои макеты»: every layout saved in this browser, with open / JSON / delete.
// Chrome shares browser storage between all local files, so this list is how
// the user reaches a layout whose file is not at hand.
import { formatStamp, isCopy } from './freshness.js';

/** @typedef {import('../types/storage').LayoutMeta} LayoutMeta */

/** @param {number} bytes */
export function formatSize(bytes) {
  return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' КБ' : (bytes / 1048576).toFixed(1).replace('.', ',') + ' МБ';
}

/**
 * Saves newest first; a kept copy ('id:previous') right after its layout.
 * @param {LayoutMeta[]} saves
 */
export function orderSaves(saves) {
  const time = (/** @type {LayoutMeta} */ save) => Date.parse(save.savedAt) || 0;
  const main = saves.filter(save => !isCopy(save.id)).sort((a, b) => time(b) - time(a));
  const copies = saves.filter(save => isCopy(save.id));
  /** @type {LayoutMeta[]} */
  const ordered = [];
  for (const save of main) ordered.push(save, ...copies.filter(copy => copy.id.startsWith(save.id + ':')));
  // Copies whose layout is gone go last.
  return [...ordered, ...copies.filter(copy => !ordered.includes(copy))];
}

/**
 * @param {{dialog: HTMLDialogElement, storage: import('../types/storage').Backend,
 *   currentId: () => string, open: (id: string) => Promise<void>, download: (id: string) => Promise<void>}} deps
 */
export function setupLayoutsDialog({dialog, storage, currentId, open, download}) {
  /** @param {string} tag @param {string} [className] @param {string} [text] */
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  /** @param {string} label @param {() => void} onClick */
  const button = (label, onClick) => {
    const node = /** @type {HTMLButtonElement} */ (el('button', '', label));
    node.type = 'button'; node.onclick = onClick;
    return node;
  };
  async function render() {
    /** @type {LayoutMeta[]} */
    let saves = [];
    try { saves = orderSaves(await storage.list()); } catch (error) { console.warn('Could not list saved layouts', error); }
    const list = el('ul', 'layouts-list');
    for (const save of saves) {
      const row = el('li', isCopy(save.id) ? 'copy' : '');
      row.dataset.id = save.id;
      const info = el('div', 'layouts-info');
      info.append(el('strong', '', save.name || 'Макет без названия'));
      if (save.id === currentId()) info.append(el('span', 'layouts-current', 'открыт сейчас'));
      info.append(el('small', '', formatStamp(save.savedAt) + ' · объектов: ' + save.count + ' · ≈ ' + formatSize(save.bytes)));
      const actions = el('div', 'layouts-actions');
      if (save.id !== currentId() && !isCopy(save.id)) actions.append(button('Открыть', () => { dialog.close(); open(save.id); }));
      actions.append(button('Скачать JSON', () => { download(save.id); }));
      if (save.id !== currentId()) actions.append(button('Удалить', async () => {
        if (!confirm('Удалить сохранение «' + (save.name || 'Макет без названия') + '» из браузера?\n\nЕсли оно может понадобиться, сначала скачайте JSON.')) return;
        try { await storage.remove(save.id); } catch (error) { alert('Не удалось удалить: ' + error); }
        render();
      }));
      row.append(info, actions);
      list.append(row);
    }
    const where = storage.kind === 'indexeddb' ? 'в базе браузера (IndexedDB)' : storage.kind === 'localstorage' ? 'в localStorage браузера' : 'нигде: браузер не даёт сохранять';
    const total = saves.reduce((sum, save) => sum + save.bytes, 0);
    const close = button('Закрыть', () => dialog.close());
    close.className = 'layouts-close';
    dialog.replaceChildren(
      el('h2', '', 'Мои макеты'),
      el('p', 'layouts-hint', 'Сохранено ' + where + (saves.length ? ', всего ≈ ' + formatSize(total) : '') +
        '. Это автосохранение браузера: оно помогает вернуть работу, но очистка данных браузера его удалит. Файлы на диске (.dnd, HTML) хранятся отдельно и здесь не показываются.'),
      saves.length ? list : el('p', 'layouts-empty', 'Пока ничего не сохранено.'),
      close);
  }
  return {
    async show() { await render(); if (!dialog.open) dialog.showModal(); }
  };
}
