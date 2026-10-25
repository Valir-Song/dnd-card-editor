// Build the hosted editor from dist/index.html: node scripts/build-site.mjs [stable|beta] [out-folder]
// Writes index.html, sw.js, the manifest, the icons and the ready sheets (library/) into the folder (default: site/ or site/beta/).
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANNELS, appHtml, assetNames, manifest, serviceWorker } from './site.mjs';
import { INDEX_NAME, LIBRARY_FOLDER, libraryIndex } from './library.mjs';

const channel = process.argv[2] || 'stable';
if (!CHANNELS[channel]) throw Error('Channel must be one of: ' + Object.keys(CHANNELS).join(', '));
const out = process.argv[3] || (channel === 'stable' ? 'site' : 'site/beta');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'index.html'), appHtml(readFileSync('dist/index.html', 'utf8'), channel));
writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify(manifest(channel, version), null, 2) + '\n');
writeFileSync(join(out, 'sw.js'), serviceWorker(readFileSync('app/sw.js', 'utf8'), channel, version));
for (const name of assetNames(channel).filter(name => name !== 'manifest.webmanifest')) copyFileSync(join('app', name), join(out, name));
// Ready sheets: each channel carries the library of the branch it was built from.
const files = readdirSync(LIBRARY_FOLDER).map(file => ({file, text: readFileSync(join(LIBRARY_FOLDER, file), 'utf8')}));
const {sheets, errors} = libraryIndex(files);
if (errors.length) throw Error('Not a ready sheet:\n' + errors.join('\n'));
mkdirSync(join(out, LIBRARY_FOLDER), {recursive: true});
for (const sheet of sheets) copyFileSync(join(LIBRARY_FOLDER, sheet.file), join(out, LIBRARY_FOLDER, sheet.file));
writeFileSync(join(out, LIBRARY_FOLDER, INDEX_NAME), JSON.stringify({sheets}, null, 2) + '\n');
// GitHub Pages must serve the files as they are, without its Jekyll step.
if (channel === 'stable') writeFileSync(join(out, '.nojekyll'), '');
console.log('Hosted editor ' + version + ' (' + channel + ') written to ' + out);
