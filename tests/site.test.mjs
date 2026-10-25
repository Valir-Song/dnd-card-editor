import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANNELS, appHtml, assetNames, manifest, serviceWorker } from '../scripts/site.mjs';

const page = '<!doctype html><html><head><title>x</title></head><body><script>const s="</body>"</script><p>hi</p></body></html>';

test('appHtml adds manifest, channel and worker, all marked app-only', () => {
  const html = appHtml(page, 'beta');
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest" data-app-only\/><meta name="theme-color"[^>]*data-app-only\/><meta name="editor-channel" content="beta" data-app-only\/><\/head>/);
  // The worker script goes before the real </body>, not the one inside a script.
  assert.ok(html.includes('const s="</body>"</script><p>hi</p><script data-app-only>'));
  assert.ok(html.endsWith('register(\'sw.js\').catch(()=>{})</script></body></html>'));
  assert.equal(html.match(/data-app-only/g).length, 4);
});

test('appHtml refuses an app page or an unknown channel', () => {
  assert.throws(() => appHtml(appHtml(page, 'stable'), 'stable'), /already/);
  assert.throws(() => appHtml(page, 'nightly'), /Unknown channel/);
  assert.throws(() => appHtml('<html><body></body></html>', 'stable'), /one <\/head>/);
});

test('each channel has its own name and icons, relative to its folder', () => {
  const stable = manifest('stable', '3.12.0');
  const beta = manifest('beta', '3.12.0-beta.1');
  assert.notEqual(stable.name, beta.name);
  for (const m of [stable, beta]) {
    assert.equal(m.start_url, './');
    assert.equal(m.scope, './');
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.some(icon => icon.sizes === '512x512'));
  }
  assert.ok(beta.icons.every(icon => icon.src.startsWith('icon-beta')));
  assert.ok(stable.icons.every(icon => !icon.src.includes('beta')));
  assert.match(beta.description, /3\.12\.0-beta\.1/);
  // Double click on a layout file opens the installed app.
  assert.deepEqual(stable.file_handlers[0].accept, {'application/x-dnd-card-layout+json': ['.dnd']});
  assert.equal(stable.file_handlers[0].action, './');
});

test('the worker caches its channel files and leaves the beta folder to the beta worker', () => {
  const template = readFileSync('app/sw.js', 'utf8');
  const stable = serviceWorker(template, 'stable', '3.12.0');
  assert.ok(!stable.includes('__'), 'all placeholders filled');
  assert.ok(stable.includes("const CHANNEL = 'stable';"));
  assert.ok(stable.includes("'-3.12.0'"));
  assert.ok(stable.includes('const FILES = ' + JSON.stringify(['./', ...assetNames('stable')]) + ';'));
  assert.ok(stable.includes('const OTHERS = ["beta/"]'));
  assert.ok(serviceWorker(template, 'beta', '1').includes('const OTHERS = []'));
  for (const channel of Object.keys(CHANNELS)) {
    for (const name of assetNames(channel).filter(name => name !== 'manifest.webmanifest')) assert.ok(readFileSync('app/' + name).length > 0, name);
  }
});
