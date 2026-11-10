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

/** Top of each distinct line box among client rects (tops more than half a line apart), ascending. */
export function lineTops(rects: readonly { y: number; height: number }[]): number[] {
  const tops: number[] = [];
  for (const r of [...rects].sort((a, b) => a.y - b.y)) {
    const last = tops[tops.length - 1];
    if (last === undefined || r.y - last > r.height / 2) tops.push(r.y);
  }
  return tops;
}

/** Number of distinct line boxes among client rects. */
export function countLines(rects: readonly { y: number; height: number }[]): number {
  return Math.max(1, lineTops(rects).length);
}

/** Lines whose aligned edges differ by at most this much still form one block (sub-pixel layout noise). */
const EDGE_TOLERANCE = 1;

/**
 * Splits the line boxes of one wrapped text node into runs that a single fixed-width Figma text box reproduces:
 * consecutive lines that share the edge their alignment pins (left, right or center; justify pins the start edge).
 * A text node that starts mid-line, after a link or badge, has a first line whose edge differs, so that line
 * becomes its own run instead of being drawn from the box edge over its neighbors (OQ-11, PREVIEW §4).
 * Returns [first, last] line index pairs (inclusive), in order. A plain paragraph gives one run.
 */
export function groupLines(
  lines: readonly { rects: readonly { x: number; width: number }[] }[],
  align: TextNode['style']['textAlign'],
  direction: string,
): [number, number][] {
  const edge = (rects: readonly { x: number; width: number }[]) => {
    const left = Math.min(...rects.map((r) => r.x));
    const right = Math.max(...rects.map((r) => r.x + r.width));
    if (align === 'center') return (left + right) / 2;
    if (align === 'right' || (align === 'justify' && direction === 'rtl')) return right;
    return left;
  };
  const runs: [number, number][] = [];
  let runEdge = NaN;
  lines.forEach((line, i) => {
    const e = edge(line.rects);
    const run = runs[runs.length - 1];
    if (run && Math.abs(e - runEdge) <= EDGE_TOLERANCE) run[1] = i;
    else {
      runs.push([i, i]);
      runEdge = e;
    }
  });
  return runs;
}
