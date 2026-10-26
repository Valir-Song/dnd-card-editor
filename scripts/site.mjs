// The hosted (installable) editor: the same one-file build plus a manifest, icons and an
// offline service worker. Pure functions here (Node tests); build-site.mjs writes the files.

import { LAYOUT_EXTENSION, LAYOUT_MIME } from '../src/editor/layout-file.js';

export const CHANNELS = {
  stable: {name: 'D&D Card Editor', shortName: 'Листы D&D', icon: 'icon', others: ['beta/']},
  beta: {name: 'D&D Card Editor — бета', shortName: 'Листы D&D β', icon: 'icon-beta', others: []},
};

/** Files a channel folder holds besides index.html and sw.js. */
export function assetNames(channel) {
  const {icon} = CHANNELS[channel];
  return ['manifest.webmanifest', icon + '.svg', icon + '-192.png', icon + '-512.png', 'file-icon.svg', 'file-icon-256.png'];
}

export function manifest(channel, version) {
  const {name, shortName, icon} = CHANNELS[channel];
  return {
    id: './',
    name,
    short_name: shortName,
    description: 'Редактор листов персонажа D&D 5e. Работает без интернета. Версия ' + version + '.',
    lang: 'ru',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#29253a',
    theme_color: '#29253a',
    icons: [
      {src: icon + '.svg', sizes: 'any', type: 'image/svg+xml'},
      {src: icon + '-192.png', sizes: '192x192', type: 'image/png'},
      {src: icon + '-512.png', sizes: '512x512', type: 'image/png'},
    ],
    // The installed app opens layout files from the system (double click); open-file.js reads them.
    file_handlers: [{
      action: './',
      accept: {[LAYOUT_MIME]: [LAYOUT_EXTENSION]},
      // The layout files' own icon in the file manager: a sheet with the d20, not the app icon.
      icons: [
        {src: 'file-icon.svg', sizes: 'any', type: 'image/svg+xml'},
        {src: 'file-icon-256.png', sizes: '256x256', type: 'image/png'},
      ],
    }],
  };
}

/**
 * The editor page for the site. Everything added is marked data-app-only, so "Скачать HTML"
 * from the installed app still gives a plain offline file.
 */
export function appHtml(html, channel) {
  if (!CHANNELS[channel]) throw Error('Unknown channel: ' + channel);
  if (html.includes('<meta name="editor-channel"')) throw Error('The page is already an app page');
  const head = '<link rel="manifest" href="manifest.webmanifest" data-app-only/>'
    + '<meta name="theme-color" content="#29253a" data-app-only/>'
    + '<meta name="editor-channel" content="' + channel + '" data-app-only/>';
  const body = '<script data-app-only>if(\'serviceWorker\' in navigator)navigator.serviceWorker.register(\'sw.js\').catch(()=>{})</script>';
  if (html.split('</head>').length !== 2 || !html.includes('</body>')) throw Error('Expected one </head> and a </body> in the page');
  return html.replace('</head>', head + '</head>').replace(/<\/body>(?![\s\S]*<\/body>)/, body + '</body>');
}

export function serviceWorker(template, channel, version) {
  const files = ['./', ...assetNames(channel)];
  return template
    .replaceAll('__CHANNEL__', channel)
    .replaceAll('__VERSION__', version)
    .replace('__FILES__', JSON.stringify(files))
    .replace('__OTHERS__', JSON.stringify(CHANNELS[channel].others));
}

/** The site address, for the public README. */
export const SITE_URL = 'https://valir-song.github.io/dnd-editor/';

/**
 * README.md of the public Pages repository, made from this repository's README on each publish:
 * the user part and the version history, without the developer section and owner-only steps
 * that point into the private repository. Throws if the README no longer has the expected
 * pieces, so a rewrite shows up in the Node tests instead of leaking into the public copy.
 */
export function publicReadme(readme) {
  const cut = (text, start, end) => {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw Error('README: expected «' + start.trim() + '» … «' + end.trim() + '»');
    return text.slice(0, from) + text.slice(to);
  };
  const swap = (text, from, to) => {
    if (!text.includes(from)) throw Error('README: expected «' + from.trim() + '»');
    return text.replace(from, to);
  };
  let text = readme.replace(/\r\n/g, '\n');
  text = cut(text, '\n## Разработка\n', '\n## История версий\n');
  // The old builds live in the private history; the library is filled by the owner there.
  text = swap(text, text.match(/ Стабильная 3\.2\.0[^]*?`archive\/[^`]*`\./)?.[0] ?? ' Стабильная 3.2.0', '');
  text = cut(text, '\n- **Пополнить базу**', '\n\n');
  text = swap(text, ' (ветка `main`)', '');
  text = swap(text, '1. Открой `DND_Card_Editor_standalone.html` в Chrome или Firefox.',
    '1. Открой **' + SITE_URL + '** в Chrome, Edge или Firefox — или HTML-файл, скачанный из редактора.');
  const intro = '\n\n> **Открыть редактор:** ' + SITE_URL + ' · бета: ' + SITE_URL + 'beta/\n>\n'
    + '> Здесь лежит только готовый редактор для GitHub Pages; исходный код — в закрытом репозитории. Файлы и этот\n'
    + '> README выкладываются автоматически при каждой новой версии, руками их не править.';
  const title = text.indexOf('\n');
  return text.slice(0, title) + intro + text.slice(title);
}
