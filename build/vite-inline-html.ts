/**
 * Vite plugin: inlines emitted JS/CSS into the HTML entry, producing ONE self-contained .html file.
 * Used by the Figma plugin UI (Figma loads the UI as a string) and the local CaptureDocument preview
 * (opened straight from disk, no server). No extra dependency.
 */
import type { Plugin } from 'vite';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function inlineIntoHtml(): Plugin {
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
