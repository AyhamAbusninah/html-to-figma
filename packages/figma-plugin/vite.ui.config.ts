/**
 * Build 2/2: plugin UI as ONE self-contained dist/ui.html. Figma loads the UI file as a string (`__html__`), so
 * scripts and styles must be inlined (shared plugin: build/vite-inline-html.ts).
 */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { inlineIntoHtml } from '../../build/vite-inline-html.ts';

const here = import.meta.dirname;

export default defineConfig({
  root: resolve(here, 'src/ui'),
  publicDir: false,
  base: './',
  plugins: [inlineIntoHtml()],
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: false,
    target: 'es2020',
    // Figma's UI iframe is modern Chromium (desktop Electron or browser); avoids system-ui fallback expansion.
    cssTarget: 'chrome120',
    modulePreload: false,
    rolldownOptions: { input: resolve(here, 'src/ui/ui.html') },
  },
});
