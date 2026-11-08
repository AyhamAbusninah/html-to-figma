/** Verification level: UNIT (Node). */
import { describe, expect, it } from 'vitest';
import { isTransparent, parseCssColor } from '../src/index.ts';

describe('parseCssColor (R0 scope: rgb/rgba as returned by getComputedStyle)', () => {
  it.each([
    ['rgb(255, 255, 255)', { r: 1, g: 1, b: 1, a: 1 }],
    ['rgba(0, 0, 0, 0)', { r: 0, g: 0, b: 0, a: 0 }],
    ['rgba(31, 95, 191, 0.5)', { r: 0.1216, g: 0.3725, b: 0.749, a: 0.5 }],
    ['rgb(10 20 30 / 25%)', { r: 0.0392, g: 0.0784, b: 0.1176, a: 0.25 }],
    ['rgb(100%, 50%, 0%)', { r: 1, g: 0.5, b: 0, a: 1 }],
    ['  RGB(1,2,3)  ', { r: 0.0039, g: 0.0078, b: 0.0118, a: 1 }],
    ['rgb(300, -5, 0)', { r: 1, g: 0, b: 0, a: 1 }],
  ])('%s', (input, expected) => {
    expect(parseCssColor(input)).toEqual(expected);
  });

  it.each(['transparent', 'oklch(0.7 0.1 200)', '#fff', 'rgb(1, 2)', 'rgb(a, b, c)', ''])(
    'returns null for unsupported input %j (modern color spaces arrive in R2, EXT-V-1)',
    (input) => {
      expect(parseCssColor(input)).toBeNull();
    },
  );
});

describe('isTransparent', () => {
  it('treats null and alpha 0 as transparent', () => {
    expect(isTransparent(null)).toBe(true);
    expect(isTransparent({ r: 1, g: 1, b: 1, a: 0 })).toBe(true);
    expect(isTransparent({ r: 1, g: 1, b: 1, a: 0.01 })).toBe(false);
  });
});
