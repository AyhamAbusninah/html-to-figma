/** Builds ONE self-contained dist/index.html that opens straight from disk (file://), no server. */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { inlineIntoHtml } from '../../build/vite-inline-html.ts';

const here = import.meta.dirname;

export default defineConfig({
  root: resolve(here, 'src'),
  publicDir: false,
  base: './',
  plugins: [inlineIntoHtml()],
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'chrome120',
    cssTarget: 'chrome120',
    modulePreload: false,
    rolldownOptions: { input: resolve(here, 'src/index.html') },
  },
});
