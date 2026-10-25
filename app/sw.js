// Service worker of the hosted editor: keeps the one-page editor usable offline.
// build-site.mjs fills the placeholders; the version in CACHE makes every release a new worker.
const CHANNEL = '__CHANNEL__';
const CACHE = 'dnd-editor-' + CHANNEL + '-__VERSION__';
const FILES = __FILES__;
const SCOPE = new URL('./', self.location.href).href;
// Another channel lives in a subfolder of this one (beta/ under the main editor): leave it alone.
const OTHERS = __OTHERS__.map(path => SCOPE + path);
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(FILES.map(file => new Request(file, {cache: 'reload'}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys
      .filter(key => key.startsWith('dnd-editor-' + CHANNEL + '-') && key !== CACHE)
      .map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = request.url.split(/[?#]/)[0];
  if (!url.startsWith(SCOPE) || OTHERS.some(other => url.startsWith(other))) return;
  if (request.mode === 'navigate' || url === SCOPE || url === SCOPE + 'index.html') {
    event.respondWith(freshPage(request));
  } else {
    event.respondWith(caches.match(request, {ignoreSearch: true, cacheName: CACHE}).then(hit => hit || fetch(request)));
  }
});

// The newest editor when the network answers in time, otherwise the one saved last time.
async function freshPage(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([
      fetch(request, {cache: 'no-cache'}),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow network')), NETWORK_WAIT_MS)),
    ]);
    if (response.ok) {
      await cache.put('./', response.clone());
      return response;
    }
  } catch (error) {
    // Offline or too slow: fall through to the saved copy.
  }
  return (await cache.match('./')) || fetch(request);
}
