import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { viteSingleFile } from 'vite-plugin-singlefile';

const initialLayoutPlugin = () => ({
  name: 'initial-layout',
  transformIndexHtml(html) {
    const raw = readFileSync(resolve('src/starter-layout.json'), 'utf8');
    return html.replace('__STARTER_DATA__', raw.replace(/</g, '\u003c'));
  },
});
export default defineConfig({
  plugins: [initialLayoutPlugin(), viteSingleFile()],
  base: './',
  build: { cssCodeSplit: false, assetsInlineLimit: 100000000 },
});