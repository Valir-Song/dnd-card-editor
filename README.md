# D&D Card Editor 3.0 — проект Vite

Перенос редактора Ричарда 2.4. Макет и тексты оставлены; две встроенные картинки и изображения фона удалены по согласованию. Основная логика редактора сохранена в `src/editor.js` без функционального переписывания, чтобы минимизировать риск поломок. Это **первый этап миграции**, а не полный рефакторинг.

## Использование без установки
Открой `DND_Card_Editor_3_0_standalone.html` рядом с этим README, если он был передан вместе с проектом. Или отдельно скачанный HTML в Firefox. Интернет не нужен.

## Для разработки на Windows
1. Установи Node.js LTS (вместе с npm).
2. В терминале открытой папки проекта выполни `npm install`.
3. `npm run dev`, затем открой адрес, выведенный Vite (обычно http://127.0.0.1:5173).
4. `npm run build` создаёт автономный файл в `dist/index.html` благодаря vite-plugin-singlefile.

## Структура
- `index.html` — разметка редактора.
- `src/styles.css` — оформление.
- `src/starter-layout.json` — исходный макет и карточки, без растровых картинок.
- `src/editor.js` — оригинальная логика интерактивности.
- `src/main.js` — точка входа.
- `vite.config.js` — настройка сборки одного HTML.
- `tests/smoke.md` — ручной контрольный список.

## Важно про данные
Новая версия использует отдельный ключ localStorage `dnd-card-editor-v3` и не заменяет сохранения версии 2.4. Для надёжного сохранения пользуйся «Скачать HTML» или экспортом JSON. Перед изменениями храни копию рабочего HTML. Если в браузере уже есть сохранённый макет v3, он имеет приоритет над начальным шаблоном.

## Ограничения
В этой среде npm registry может быть недоступен. Поэтому автономный HTML сформирован непосредственно из тех же исходников, без утверждения, что `npm run build` реально был исполнен. Настоящую сборку Vite следует проверить на машине с npm-доступом.

## Version 3.0.1 — modular editor and verification

The 3.0.1 source is in `src/editor.js` and feature modules under `src/editor/`:
pointer movement, card backgrounds, image tools, layers, text formatting, object creation, and import/export.
The original v3 layout format and browser storage key are unchanged.

### Develop and build

```sh
npm install
npm run dev
npm test
npm run build
npm run check:build
```

Open `dist/index.html` to run the offline Vite build. For automated browser interaction checks, install Python Playwright and Chromium, then run `python tests/browser_smoke.py`. These smoke tests assemble the same modules into a browser-test document; the Vite output is separately validated by `npm run check:build`.

GitHub Actions runs all checks for pull requests. Its **DND-Card-Editor-3.0.1** artifact contains the built single-file HTML.

Version 3.0 remains available on the `main` branch until the 3.0.1 PR is reviewed and merged.


## Version 3.1 — Undo/Redo

The editor now has **Отменить** and **Повторить** buttons and keyboard shortcuts:

- **Ctrl+Z** (or **Cmd+Z** on macOS): undo the last editor action.
- **Ctrl+Y** / **Ctrl+Shift+Z** (or **Cmd+Shift+Z**): redo.

Undo history includes text edits, formatting, card movement and resizing, text-frame movement and resizing, creation and deletion of objects, layer changes, background/image settings and JSON import.

Pointer gestures create one history step when released; adjacent keystrokes and slider changes are grouped. Performing a new edit after undo clears the available redo branch.

History is **in memory only**: it resets when you reload or close the page. Existing saved layouts and the `dnd-card-editor-v3` storage key remain compatible with version 3.0.1. The history has a 60-step / ~48 MiB cap; large embedded images may reduce available steps.

To verify: `npm test`, `python tests/browser_smoke.py`, `npm run build`, `npm run check:build`.
 

## Experimental 3.2 Tiptap — unified text foundation (branch `feature/3.2-tiptap-core`)

This is a **draft** replacing the previous homegrown `contenteditable` formatters. It is
based on the last validated 3.2 tabbed-toolbar/text-box snapshot **fac50cad**
and is not merged into `main`.

- One Tiptap 3 / ProseMirror implementation powers every editable field:
  cards (title, metadata and details), header/subtitle, notes/resources,
  section labels, and free-positioned text boxes.
- One toolbar in the Text tab controls selection formatting: bold, italic,
  underline, strike, family, precise 6–96 pt font size, color, alignment,
  numbered/bulleted lists and clear formatting.
- Clicking with a caret but without an active text selection applies styling
  to the whole focused text field, not merely to future typing. For a portion
  of the text, select the exact word(s) before using the toolbar.
- A textbox still has *object* settings for background, border, auto-height and
  position. These are not separate text-format engines.
- Text content and formatting are stored as portable HTML in the existing
  `titleHtml`/`subtitleHtml`/`metaHtml`/`detailHtml`/`textHtml` properties.
  Old `<font>` markup is converted to Tiptap-compatible spans when loaded.
  Positions, card sizes, layer ordering and localStorage key remain compatible.
- Undo/Redo continues to use the existing **whole-document** snapshot history
  (including text and object changes). Tiptap's own per-editor UndoRedo is
  intentionally disabled to prevent competing histories.
- `npm run build` bundles Tiptap and all dependencies directly into
  `dist/index.html`. No CDN or server is needed to open the exported HTML.
  The *HTML export* is created from pristine application markup plus the current
  JSON layout, rather than copying active ProseMirror editor DOM.
- Original small card boxes may clip or overflow if you choose a very large
  font; this is a **layout constraint**, not a rich-text engine problem.

### Reproducible checks

```sh
npm install
npm test
npm run build
npm run check:build
python -m playwright install chromium firefox
npm run test:e2e
npm run test:e2e:firefox
```

CI runs the end-to-end suite against the **real compiled HTML** in both
Chromium and Firefox, including live font growth, old JSON import, global
Undo/Redo, new text boxes and offline round-trip export.

Tiptap is MIT licensed. Source: https://github.com/ueberdosis/tiptap.


## Version 3.2.0 — stable (2026-10-21)

3.2 is now the supported mainline editor, using Tiptap for every text field.
The former 3.1 mainline is preserved at `archive/stable-3.1-before-tiptap`.
The 3.2 single-file build is `dist/index.html`; the editor's **Download HTML**
command exports `DND_Card_Editor_3_2_Stable.html`.

Automated verification runs Node source tests, Vite single-file build checks,
and Playwright end-to-end tests on the compiled offline HTML in both Chromium
and Firefox. These tests do not replace testing with real D&D layouts in the
user's own browser. Before changing or importing a large layout, export a JSON
backup and keep a copy of the standalone HTML.


## 3.3 beta — Moveable + Selecto (isolated experiment)

The `feature/3.3-moveable-selecto` branch is experimental and must not be
merged into stable main without user acceptance. The editor remains a portable
single-file HTML document with Tiptap bundled offline.

* **Moveable 0.53.0 (MIT)** manages the position and dimensions of top-level
  cards, headers, images, shapes, notes and text boxes. The layout still stores
  positions and sizes in millimetres. One gesture equals one undo checkpoint.
* **Selecto 1.26.3 (MIT)** selects multiple top-level elements with a marquee
  started on an empty area of one A4 page. Shift+click toggles elements on the
  same page, and Moveable drags or resizes groups. Selection never spans pages.
* Tiptap owns text interaction; clicking inside editable text never starts a
  canvas drag. Existing inline text-frame grips and spell level badge drags
  remain independently operable for compatibility with pre-3.3 JSON layouts.
* When more than one object is selected, object-specific formatting controls
  intentionally have no active target; bulk deletion is supported.
* Exported HTML bundles both libraries and existing template data. Moveable
  handles and marquee indicators are excluded from print.

### Quality gates

`npm test`, `npm run build`, `npm run check:build`, and Playwright tests in
Chromium and Firefox. E2E suites: `tests/tiptap_browser_smoke.py` and
`tests/canvas_browser_smoke.py`. Before testing, back up the current layout
through the JSON button; the branch retains the pre-3.3 local storage key for
backwards compatibility.
