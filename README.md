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
