/**
 * Build 1/2: popup (HTML entry) + service worker (ES module). Output: dist/popup.html, dist/assets/*,
 * dist/service-worker.js, and public/manifest.json copied verbatim. The content script is built separately as an
 * IIFE (vite.content.config.ts) because chrome.scripting injects it as a classic script.
 */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const here = import.meta.dirname;

export default defineConfig({
  root: resolve(here, 'src/popup'),
  publicDir: resolve(here, 'public'),
  base: './',
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'chrome120',
    rolldownOptions: {
      input: {
        popup: resolve(here, 'src/popup/popup.html'),
        'service-worker': resolve(here, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
