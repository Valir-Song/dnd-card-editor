// «Открыть» (Ctrl+O), like File → Open in Word: a layout file (.dnd), an editor HTML
// downloaded from any version, or a JSON. In Chrome and Edge the opened file stays the
// layout's file (Ctrl+S writes back into it) and joins the recent files; other browsers
// read the file through an ordinary file input. The installed app also opens the files
// the system hands it (double click on a .dnd: file_handlers in the manifest).
import { formatStamp } from './freshness.js';
import { LAYOUT_EXTENSION, LAYOUT_MIME } from './layout-file.js';

/** @typedef {import('./save-file.js').FileHandle} FileHandle */
/** @typedef {import('./save-file.js').RecentFile} RecentFile */

/** @returns {((options: object) => Promise<FileHandle[]>) | null} */
function openPicker() {
  const picker = /** @type {{showOpenFilePicker?: (options: object) => Promise<FileHandle[]>}} */ (/** @type {unknown} */ (window)).showOpenFilePicker;
  return typeof picker === 'function' ? picker.bind(window) : null;
}

/** @param {unknown} error */
const errorName = error => typeof error === 'object' && error !== null && 'name' in error ? String(/** @type {{name: unknown}} */ (error).name) : '';

/**
 * @param {{dialog: HTMLDialogElement, handles: Required<import('./save-file.js').HandleStore>,
 *   open: (file: {text: string, fileName: string}) => Promise<{id: string, name: string} | null>,
 *   remember: (id: string, layoutName: string, handle: FileHandle) => Promise<void>}} deps
 */
export function setupOpenFile({dialog, handles, open, remember}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = LAYOUT_EXTENSION + ',.json,.html,.htm';
  input.hidden = true;
  input.id = 'openFileInput';
  document.body.append(input);
  input.onchange = async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    dialog.close();
    await open({text: await file.text(), fileName: file.name});
  };

  /** @param {FileHandle} handle */
  async function openHandle(handle) {
    try {
      if (handle.queryPermission && await handle.queryPermission({mode: 'read'}) !== 'granted'
        && (!handle.requestPermission || await handle.requestPermission({mode: 'read'}) !== 'granted')) {
        alert('Браузер не дал прочитать файл «' + handle.name + '».');
        return;
      }
      if (!handle.getFile) return;
      const text = await (await handle.getFile()).text();
      dialog.close();
      const opened = await open({text, fileName: handle.name});
      if (opened) await remember(opened.id, opened.name, handle);
    } catch (error) {
      console.warn('Opening the file failed', error);
      alert(errorName(error) === 'NotFoundError'
        ? 'Файл «' + handle.name + '» не найден: его переместили или удалили.'
        : 'Не удалось открыть файл «' + handle.name + '».');
      throw error;
    }
  }

  async function choose() {
    const picker = openPicker();
    if (!picker) { input.click(); return; }
    let handle;
    try {
      [handle] = await picker({id: 'dnd-card-editor', types: [
        {description: 'Макет или редактор листов', accept: {[LAYOUT_MIME]: [LAYOUT_EXTENSION], 'application/json': ['.json'], 'text/html': ['.html', '.htm']}},
      ]});
    } catch (error) {
      if (errorName(error) !== 'AbortError') console.warn('The file dialog failed', error);
      return;
    }
    if (handle) await openHandle(handle).catch(() => {});
  }

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
    const recent = openPicker() ? await handles.recent().catch(() => /** @type {RecentFile[]} */ ([])) : [];
    const pick = button('Выбрать файл на компьютере…', () => void choose());
    pick.className = 'open-pick';
    const list = el('ul', 'layouts-list');
    for (const entry of recent) {
      const row = el('li');
      row.dataset.id = entry.id;
      const info = el('div', 'layouts-info');
      info.append(el('strong', '', entry.fileName), el('small', '', (entry.layoutName || 'Макет без названия') + ' · ' + formatStamp(entry.usedAt)));
      const actions = el('div', 'layouts-actions');
      actions.append(
        button('Открыть', () => void openHandle(entry.handle).catch(async error => {
          if (errorName(error) === 'NotFoundError') { await handles.removeRecent(entry.id); await render(); }
        })),
        button('Убрать из списка', async () => { await handles.removeRecent(entry.id); await render(); }));
      row.append(info, actions);
      list.append(row);
    }
    const close = button('Закрыть', () => dialog.close());
    close.className = 'layouts-close';
    dialog.replaceChildren(
      el('h2', '', 'Открыть'),
      el('p', 'layouts-hint', 'Макет (.dnd), скачанный HTML редактора любой версии или JSON. ' + (openPicker()
        ? 'Открытый файл запоминается: Ctrl+S сохраняет обратно в него.'
        : 'В этом браузере файл открывается копией: сохраняйте кнопкой «Сохранить» (Ctrl+S): документ скачается новой копией.')),
      pick,
      ...(recent.length ? [el('h3', 'open-recent', 'Недавние файлы'), list] : []),
      close);
  }

  async function show() {
    await render();
    if (!dialog.open) dialog.showModal();
  }
  const openButton = /** @type {HTMLButtonElement} */ (document.getElementById('openFile'));
  openButton.onclick = () => void show();
  // Capture phase and any keyboard layout (code KeyO), like Ctrl+S.
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    if (event.code !== 'KeyO' && event.key.toLowerCase() !== 'o') return;
    event.preventDefault();
    if (!event.repeat) void show();
  }, true);
  // The installed app: a .dnd opened from the system (double click, «Открыть с помощью»).
  const queue = /** @type {{launchQueue?: {setConsumer: (consumer: (params: {files?: FileHandle[]}) => void) => void}}} */ (/** @type {unknown} */ (window)).launchQueue;
  queue?.setConsumer(params => {
    const handle = params.files?.[0];
    if (handle) void openHandle(handle).catch(() => {});
  });
  return {show, openHandle};
}
