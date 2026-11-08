/** Build 1/2: plugin main thread as one IIFE (dist/code.js) for Figma's sandbox. */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const here = import.meta.dirname;

export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    // Conservative syntax for the plugin sandbox (no optional chaining / nullish coalescing in output).
    target: 'es2017',
    lib: {
      entry: resolve(here, 'src/main/code.ts'),
      formats: ['iife'],
      name: 'h2fPlugin',
      fileName: () => 'code.js',
    },
  },
});
