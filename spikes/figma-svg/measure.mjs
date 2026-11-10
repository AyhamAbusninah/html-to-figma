/**
 * Browser measurement for svg.mjs: font ascent/descent (canvas TextMetrics) and line breaks of multi-line text
 * (the browser lays the text out in a hidden box of the captured width; lines are read back from character rects).
 * Fonts must be loaded first (see loadFonts).
 */
const fontCss = (f) => `${f.italic ? 'italic ' : ''}${f.weight} ${f.size}px "${f.family}"`;

export async function loadFonts(fonts) {
  await Promise.all(fonts.map((f) => document.fonts.load(fontCss(f), 'Hello مرحبا').catch(() => [])));
  await document.fonts.ready;
}

export function browserMeasure() {
  const ctx = document.createElement('canvas').getContext('2d');
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-99999px;top:0;white-space:normal;overflow-wrap:break-word;visibility:hidden';
  document.body.appendChild(box);
  const cache = new Map();
  return {
    metrics(f) {
      const key = fontCss(f);
      if (!cache.has(key)) {
        ctx.font = key;
        const m = ctx.measureText('Hg مرحبا');
        cache.set(key, { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent });
      }
      return cache.get(key);
    },
    lines(t) {
      box.style.font = fontCss(t);
      box.style.lineHeight = t.lineHeight ? `${t.lineHeight}px` : 'normal';
      box.style.letterSpacing = `${t.letterSpacing}px`;
      box.style.width = `${t.width + 0.5}px`; // captured widths are rounded; avoid a spurious wrap
      box.style.textAlign = { LEFT: 'left', RIGHT: 'right', CENTER: 'center', JUSTIFIED: 'justify' }[t.align];
      box.textContent = t.characters;
      const node = box.firstChild;
      if (!node) return [''];
      const range = document.createRange();
      const lines = [];
      let start = 0;
      let top = null;
      for (let i = 0; i < t.characters.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = [...range.getClientRects()].find((c) => c.height > 0);
        if (!r) continue;
        if (top === null) top = r.top;
        else if (r.top - top > r.height / 2) {
          lines.push(t.characters.slice(start, i));
          start = i;
          top = r.top;
        }
      }
      lines.push(t.characters.slice(start));
      return lines.map((l) => l.trim()).filter((l, i, a) => l || a.length === 1);
    },
  };
}
