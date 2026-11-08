/**
 * Build 2/2: plugin UI as ONE self-contained dist/ui.html. Figma loads the UI file as a string (`__html__`), so
 * scripts and styles must be inlined. A small local plugin inlines the emitted JS/CSS, so no extra dependency is needed.
 */
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const here = import.meta.dirname;

function inlineIntoHtml(): Plugin {
  return {
    name: 'h2f-inline-into-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find(
        (f) => f.type === 'asset' && f.fileName.endsWith('.html'),
      );
      if (!html || html.type !== 'asset') return;
      let source = String(html.source);
      for (const [fileName, file] of Object.entries(bundle)) {
        if (file.type === 'chunk' && fileName.endsWith('.js')) {
          const code = file.code.replaceAll('</script', '<\\/script');
          source = source.replace(
            new RegExp(`<script type="module"[^>]*src="[^"]*${escapeRe(fileName)}"[^>]*></script>`),
            () => `<script type="module">${code}</script>`,
          );
          delete bundle[fileName];
        } else if (file.type === 'asset' && fileName.endsWith('.css')) {
          source = source.replace(
            new RegExp(`<link rel="stylesheet"[^>]*href="[^"]*${escapeRe(fileName)}"[^>]*>`),
            () => `<style>${String(file.source)}</style>`,
          );
          delete bundle[fileName];
        }
      }
      html.source = source;
    },
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
