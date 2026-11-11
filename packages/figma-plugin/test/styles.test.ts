/** Styles board (Phase 2). Verification level: UNIT (Node); Figma import of the same SVG techniques: spikes. */
import { describe, expect, it } from 'vitest';
import type { CaptureDocument, FrameNode, TextNode } from '@h2f/schema';
import { minimal } from '../../schema/test/samples.ts';
import { buildPlan } from '../src/plan/plan.ts';
import { collectStyles, colorLabel, stylesBoardSvg } from '../src/svg/styles.ts';
import { MOCK_FONTS } from './figma-mock.ts';

const ink = { r: 0.0667, g: 0.0667, b: 0.0667, a: 1 };
const text = (id: string, characters: string, over: Partial<TextNode['style']> = {}): TextNode => ({
  id,
  name: characters,
  type: 'TEXT',
  rect: { x: 0, y: 0, width: 100, height: 20 },
  opacity: 1,
  characters,
  lineCount: 1,
  style: {
    fontFamilies: ['Inter', 'sans-serif'],
    fontWeight: 400,
    fontStyle: 'normal',
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0,
    color: ink,
    direction: 'ltr',
    textAlign: 'left',
    textDecoration: 'none',
    textCase: 'none',
    ...over,
  },
});
const box = (
  id: string,
  color: { r: number; g: number; b: number; a: number },
  children: FrameNode['children'] = [],
): FrameNode => ({
  id,
  name: 'Box',
  type: 'FRAME',
  rect: { x: 0, y: 0, width: 100, height: 100 },
  opacity: 1,
  fills: [{ type: 'SOLID', color }],
  strokes: {
    top: { width: 1, color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, style: 'solid' as const },
    right: { width: 1, color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, style: 'solid' as const },
    bottom: { width: 1, color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, style: 'solid' as const },
    left: { width: 1, color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, style: 'solid' as const },
  },
  clipsContent: false,
  children,
});

function doc(): CaptureDocument {
  const d = minimal();
  d.root.children = [
    box('b1', { r: 1, g: 1, b: 1, a: 1 }, [
      text('t1', 'Welcome to the shop', { fontSize: 32, fontWeight: 700, lineHeight: 40 }),
      text('t2', 'Body text that reads well'),
      text('t3', 'Short', { lineHeight: 20 }), // same font and size, other line height: one entry
      text('t4', 'a selection of pieces', { textCase: 'title', fontSize: 20 }),
      text('t5', 'نص عربي للتجربة', {
        fontFamilies: ['Tajawal'],
        direction: 'rtl',
        textAlign: 'right',
      }),
    ]),
    box('b2', { r: 1, g: 1, b: 1, a: 0.5 }),
    box('b3', { r: 0.1216, g: 0.1608, b: 0.2157, a: 1 }),
  ];
  return d;
}

describe('styles board', () => {
  it('colorLabel: hex, plus opacity when translucent', () => {
    expect(
      colorLabel({ type: 'SOLID', color: { r: 0.1216, g: 0.1608, b: 0.2157 }, opacity: 1 }),
    ).toBe('#1F2937');
    expect(colorLabel({ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.5 })).toBe(
      '#FFFFFF · 50%',
    );
  });

  it('collects text colors, backgrounds and a type scale (variants merged, largest first)', () => {
    const s = collectStyles(buildPlan(doc(), MOCK_FONTS));
    expect(s.backgrounds.map((c) => colorLabel(c.paint))).toEqual(
      expect.arrayContaining(['#FFFFFF', '#FFFFFF · 50%', '#1F2937']),
    );
    expect(s.text.map((c) => colorLabel(c.paint))).toEqual(['#111111']);
    expect(s.textStyles.map((t) => t.text.fontSize)).toEqual([32, 20, 16, 16]);
    const inter16 = s.textStyles.find(
      (t) => t.text.fontSize === 16 && t.text.font.family === 'Inter',
    )!;
    expect(inter16).toMatchObject({ count: 2, variants: 2 });
    expect(inter16.sample.characters).toBe('Body text that reads well'); // a phrase beats a label
  });

  it('the SVG names every swatch and sample, shows the page case, and left-aligns Arabic', () => {
    const { svg, stats } = stylesBoardSvg(buildPlan(doc(), MOCK_FONTS), 'Shop');
    expect(stats).toMatchObject({ textStyles: 4 });
    expect(svg).toContain('id="Color · #1F2937"');
    expect(svg).toMatch(/id="Text style · Inter Bold 32\/40"/);
    expect(svg).toContain('A Selection Of Pieces');
    expect(svg).toMatch(/\(\+1 variant\)/);
    expect(svg).not.toContain('text-anchor="end"');
    expect(svg).toContain('نص عربي للتجربة');
  });
});
