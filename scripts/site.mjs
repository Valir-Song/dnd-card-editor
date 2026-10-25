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
