// Build the hosted editor from dist/index.html: node scripts/build-site.mjs [stable|beta] [out-folder]
// Writes index.html, sw.js, the manifest and the icons into the folder (default: site/ or site/beta/).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANNELS, appHtml, assetNames, manifest, serviceWorker } from './site.mjs';

const channel = process.argv[2] || 'stable';
if (!CHANNELS[channel]) throw Error('Channel must be one of: ' + Object.keys(CHANNELS).join(', '));
const out = process.argv[3] || (channel === 'stable' ? 'site' : 'site/beta');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'index.html'), appHtml(readFileSync('dist/index.html', 'utf8'), channel));
writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify(manifest(channel, version), null, 2) + '\n');
writeFileSync(join(out, 'sw.js'), serviceWorker(readFileSync('app/sw.js', 'utf8'), channel, version));
for (const name of assetNames(channel).filter(name => name !== 'manifest.webmanifest')) copyFileSync(join('app', name), join(out, name));
// GitHub Pages must serve the files as they are, without its Jekyll step.
if (channel === 'stable') writeFileSync(join(out, '.nojekyll'), '');
console.log('Hosted editor ' + version + ' (' + channel + ') written to ' + out);
