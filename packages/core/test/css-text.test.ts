/** Computed-style parsers and text helpers. Verification level: UNIT (Node). */
import { describe, expect, it } from 'vitest';
import {
  countLines,
  isTranslationOnly,
  normalizeWhitespace,
  parseBoxShadow,
  parseFontFamilies,
  resolveTextAlign,
} from '../src/index.ts';
import { parseBlendMode, parseRadii, splitTopLevel } from '../src/css.ts';
import { textStyle } from '../src/text.ts';
import type { RawStyle } from '../src/raw-snapshot.ts';

describe('css parsers', () => {
  it('splitTopLevel ignores commas inside parentheses and quotes', () => {
    expect(splitTopLevel('rgb(1, 2, 3) 0px 1px, "a, b", c')).toEqual([
      'rgb(1, 2, 3) 0px 1px',
      '"a, b"',
      'c',
    ]);
  });

  it('font-family stacks: quotes removed, order kept, empty → sans-serif', () => {
    expect(parseFontFamilies('"Noto Sans Arabic", Tajawal, \'Segoe UI\', sans-serif')).toEqual([
      'Noto Sans Arabic',
      'Tajawal',
      'Segoe UI',
      'sans-serif',
    ]);
    expect(parseFontFamilies('')).toEqual(['sans-serif']);
  });

  it('box-shadow: multiple layers, inset, spread; fully transparent layers dropped', () => {
    expect(
      parseBoxShadow(
        'rgba(0, 0, 0, 0.1) 0px 1px 2px 0px, rgb(37, 99, 235) 0px 0px 0px 3px inset, rgba(0, 0, 0, 0) 0px 9px 9px 0px',
      ),
    ).toEqual([
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.1 },
        offset: { x: 0, y: 1 },
        radius: 2,
        spread: 0,
      },
      {
        type: 'INNER_SHADOW',
        color: { r: 0.1451, g: 0.3882, b: 0.9216, a: 1 },
        offset: { x: 0, y: 0 },
        radius: 0,
        spread: 3,
      },
    ]);
    expect(parseBoxShadow('none')).toEqual([]);
  });

  it('radii: px, %, elliptical (horizontal value), clamped to half the shorter side', () => {
    const s = {
      'border-top-left-radius': '50%',
      'border-top-right-radius': '10px 20px',
      'border-bottom-right-radius': '999px',
      'border-bottom-left-radius': '0px',
    } as RawStyle;
    expect(parseRadii(s, 200, 80)).toEqual({ tl: 40, tr: 10, br: 40, bl: 0 });
    expect(
      parseRadii(
        {
          ...s,
          'border-top-left-radius': '0px',
          'border-top-right-radius': '0px',
          'border-bottom-right-radius': '0px',
        } as RawStyle,
        10,
        10,
      ),
    ).toBeNull();
  });

  it('transforms and blend modes', () => {
    expect(isTranslationOnly('none')).toBe(true);
    expect(isTranslationOnly('matrix(1, 0, 0, 1, 20, 30)')).toBe(true);
    expect(isTranslationOnly('matrix(0.98, 0.17, -0.17, 0.98, 0, 0)')).toBe(false);
    expect(parseBlendMode('normal')).toEqual({});
    expect(parseBlendMode('color-dodge')).toEqual({ blendMode: 'COLOR_DODGE' });
    expect(parseBlendMode('plus-lighter')).toEqual({ unsupported: 'plus-lighter' });
  });
});

describe('text helpers', () => {
  it.each([
    ['normal', '  a \n\t b  ', 'a b'],
    ['nowrap', ' a   b ', 'a b'],
    ['pre', '  a\n  b ', '  a\n  b '],
    ['pre-wrap', 'a\r\nb', 'a\nb'],
    ['pre-line', '  a   b \n   c  ', 'a b\nc'],
  ])('white-space: %s', (ws, input, expected) =>
    expect(normalizeWhitespace(input, ws)).toBe(expected),
  );

  it.each([
    ['start', 'ltr', 'left'],
    ['start', 'rtl', 'right'],
    ['end', 'ltr', 'right'],
    ['end', 'rtl', 'left'],
    ['-webkit-center', 'rtl', 'center'],
    ['justify', 'rtl', 'justify'],
    ['match-parent', 'rtl', 'right'],
  ])('text-align %s in %s → %s', (align, dir, expected) =>
    expect(resolveTextAlign(align, dir)).toBe(expected),
  );

  it('countLines groups rects by line top', () => {
    expect(
      countLines([
        { y: 0, height: 20 },
        { y: 1, height: 20 },
        { y: 24, height: 20 },
      ]),
    ).toBe(2);
    expect(countLines([])).toBe(1);
  });

  it('textStyle: line-height normal/px, letter-spacing normal, weight, italic, decoration, case', () => {
    const s = {
      'font-family': 'Inter',
      'font-size': '14px',
      'font-weight': '600',
      'font-style': 'italic',
      'line-height': '21px',
      'letter-spacing': 'normal',
      color: 'rgb(0, 0, 0)',
      'text-align': 'center',
      direction: 'ltr',
      'text-decoration-line': 'underline line-through',
      'text-transform': 'capitalize',
    } as RawStyle;
    expect(textStyle(s, 'Hi').style).toEqual({
      fontFamilies: ['Inter'],
      fontWeight: 600,
      fontStyle: 'italic',
      fontSize: 14,
      lineHeight: 21,
      letterSpacing: 0,
      color: { r: 0, g: 0, b: 0, a: 1 },
      direction: 'ltr',
      textAlign: 'center',
      textDecoration: 'underline',
      textCase: 'title',
    });
    expect(textStyle({ ...s, 'line-height': 'normal' }, 'x').style.lineHeight).toBe('normal');
  });
});

describe('isVisuallyHidden (screen-reader-only patterns)', () => {
  const base = {
    clip: 'auto',
    'clip-path': 'none',
    'overflow-x': 'visible',
    'overflow-y': 'visible',
  } as RawStyle;
  it('detects clip rect, clip-path inset >= 50%, and 1px clipping boxes; leaves normal content alone', async () => {
    const { isVisuallyHidden } = await import('../src/css.ts');
    expect(isVisuallyHidden({ ...base, clip: 'rect(0px, 0px, 0px, 0px)' }, 120, 20)).toBe(true);
    expect(isVisuallyHidden({ ...base, clip: 'rect(1px, 1px, 1px, 1px)' }, 120, 20)).toBe(true);
    expect(isVisuallyHidden({ ...base, 'clip-path': 'inset(50%)' }, 120, 20)).toBe(true);
    expect(
      isVisuallyHidden({ ...base, 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, 1, 1),
    ).toBe(true);
    expect(isVisuallyHidden({ ...base, clip: 'rect(0px, 100px, 20px, 0px)' }, 120, 20)).toBe(false);
    expect(isVisuallyHidden({ ...base, 'clip-path': 'inset(10%)' }, 120, 20)).toBe(false);
    expect(isVisuallyHidden(base, 1, 1)).toBe(false);
  });
});
