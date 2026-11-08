/** Build 2/2: content script as one self-contained IIFE (dist/content.js), appended to build 1's output. */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const here = import.meta.dirname;

export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: false,
    target: 'chrome120',
    lib: {
      entry: resolve(here, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'h2fContent',
      fileName: () => 'content.js',
    },
  },
});
