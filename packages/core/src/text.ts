/** Pure text helpers: whitespace (EXT-X-2), alignment (EXT-RTL-2), style mapping (§2.2 TextNode.style). */
import type { TextNode } from '@h2f/schema';
import { parseCssColor } from './color.ts';
import { parseFontFamilies, px } from './css.ts';
import type { RawStyle } from './raw-snapshot.ts';

/** Arabic-script ranges (EXT-RTL-5). */
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-\uFEFF]/;
export const hasArabic = (s: string) => ARABIC.test(s);

/** Applies CSS white-space collapsing. Returns '' when nothing visible remains. */
export function normalizeWhitespace(text: string, whiteSpace: string): string {
  switch (whiteSpace) {
    case 'pre':
    case 'pre-wrap':
    case 'break-spaces':
      return text.replace(/\r\n?/g, '\n');
    case 'pre-line':
      return text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => l.replace(/[ \t\f]+/g, ' ').trim())
        .join('\n')
        .trim();
    default: // normal, nowrap
      return text.replace(/[ \t\n\r\f]+/g, ' ').trim();
  }
}

/** Computed text-align → physical alignment (start/end resolved against direction). */
export function resolveTextAlign(
  textAlign: string,
  direction: string,
): TextNode['style']['textAlign'] {
  const rtl = direction === 'rtl';
  switch (textAlign) {
    case 'left':
    case '-webkit-left':
      return 'left';
    case 'right':
    case '-webkit-right':
      return 'right';
    case 'center':
    case '-webkit-center':
      return 'center';
    case 'justify':
      return 'justify';
    case 'end':
      return rtl ? 'left' : 'right';
    default: // start, match-parent, initial
      return rtl ? 'right' : 'left';
  }
}

const TEXT_CASE: Record<string, TextNode['style']['textCase']> = {
  uppercase: 'upper',
  lowercase: 'lower',
  capitalize: 'title',
};

/** Builds TextNode.style from the parent element's computed style. */
export function textStyle(
  s: RawStyle,
  characters: string,
): { style: TextNode['style']; arabicLetterSpacingIgnored: boolean } {
  const fontSize = Math.max(px(s['font-size'], 16), 0.01);
  const lh = s['line-height'];
  const lineHeight: number | 'normal' =
    !lh || lh === 'normal' ? 'normal' : Math.max(px(lh, fontSize * 1.2), 0.01);
  let letterSpacing = s['letter-spacing'] === 'normal' ? 0 : px(s['letter-spacing']);
  let arabicLetterSpacingIgnored = false;
  if (letterSpacing !== 0 && hasArabic(characters)) {
    letterSpacing = 0;
    arabicLetterSpacingIgnored = true;
  }
  const weight = Math.round(px(s['font-weight'], 400));
  const deco = s['text-decoration-line'] ?? 'none';
  return {
    arabicLetterSpacingIgnored,
    style: {
      fontFamilies: parseFontFamilies(s['font-family'] ?? ''),
      fontWeight: Math.min(1000, Math.max(1, weight)),
      fontStyle: /italic|oblique/.test(s['font-style'] ?? '') ? 'italic' : 'normal',
      fontSize: Math.round(fontSize * 100) / 100,
      lineHeight: typeof lineHeight === 'number' ? Math.round(lineHeight * 100) / 100 : lineHeight,
      letterSpacing: Math.round(letterSpacing * 100) / 100,
      color: parseCssColor(s.color) ?? { r: 0, g: 0, b: 0, a: 1 },
      direction: s.direction === 'rtl' ? 'rtl' : 'ltr',
      textAlign: resolveTextAlign(s['text-align'], s.direction),
      textDecoration: deco.includes('underline')
        ? 'underline'
        : deco.includes('line-through')
          ? 'line-through'
          : 'none',
      textCase: TEXT_CASE[s['text-transform']] ?? 'none',
    },
  };
}

/** Number of distinct line boxes among client rects (rects whose tops differ by more than half a line). */
export function countLines(rects: readonly { y: number; height: number }[]): number {
  const tops: number[] = [];
  for (const r of [...rects].sort((a, b) => a.y - b.y)) {
    const last = tops[tops.length - 1];
    if (last === undefined || r.y - last > r.height / 2) tops.push(r.y);
  }
  return Math.max(1, tops.length);
}
