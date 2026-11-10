/** Copy to Figma SVG serializer (EXT-O-7). Verification level: UNIT (Node). Figma behavior: docs/spikes §4b. */
import { describe, expect, it } from 'vitest';
import type { CaptureDocument, FrameNode, TextNode } from '@h2f/schema';
import { minimal } from '../../schema/test/samples.ts';
import { buildPlan } from '../src/plan/plan.ts';
import { fontFamilyList, planToSvg, styleToCss } from '../src/svg/svg.ts';
import { MOCK_FONTS } from './figma-mock.ts';

const ink = { r: 0.0667, g: 0.0667, b: 0.0667, a: 1 };
const style = (over: Partial<TextNode['style']> = {}): TextNode['style'] => ({
  fontFamilies: ['Inter', 'sans-serif'],
  fontWeight: 400,
  fontStyle: 'normal',
  fontSize: 16,
  lineHeight: 'normal',
  letterSpacing: 0,
  color: ink,
  direction: 'ltr',
  textAlign: 'left',
  textDecoration: 'none',
  textCase: 'none',
  ...over,
});
const text = (
  id: string,
  rect: TextNode['rect'],
  characters: string,
  lineCount = 1,
  s = style(),
): TextNode => ({
  id,
  name: characters.slice(0, 40),
  type: 'TEXT',
  rect,
  opacity: 1,
  characters,
  lineCount,
  style: s,
});

function doc(children: FrameNode['children']): CaptureDocument {
  const d = minimal();
  d.root.rect = { x: 0, y: 0, width: 400, height: 300 };
  d.root.children = children;
  return d;
}
const card: FrameNode = {
  id: 'n1',
  name: 'div.card',
  type: 'FRAME',
  rect: { x: 20, y: 20, width: 200, height: 100 },
  opacity: 1,
  fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 1, a: 1 } }],
  radii: { tl: 8, tr: 8, br: 8, bl: 8 },
  clipsContent: true,
  children: [text('n2', { x: 30, y: 30, width: 60, height: 19 }, 'Hello')],
};

describe('planToSvg', () => {
  it('flat structure: background and sections directly in the root, no wrapper group, no unneeded mask', () => {
    const { svg, stats } = planToSvg(buildPlan(doc([card]), MOCK_FONTS));
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="400" height="300" viewBox="0 0 400 300"><rect id="Background" x="0" y="0" width="400" height="300" fill="rgb\(255,255,255\)"\/><g id="div.card">/,
    );
    expect(svg).toContain(
      '<rect id="div.card_background" x="20" y="20" width="200" height="100" rx="8" fill="rgb(51,102,255)"/>',
    );
    expect(svg).not.toContain('clip-path'); // the card clips, but nothing overflows it
    expect(stats).toEqual({ boxes: 1, texts: 1, placeholders: 0, lines: 1 });
  });

  it('text: y = top + font-size, PostScript font name first, no id (Figma names it after its text)', () => {
    const { svg } = planToSvg(buildPlan(doc([card]), MOCK_FONTS));
    expect(svg).toContain(
      '<text font-family="Inter-Regular, Inter" font-size="16" font-weight="400" fill="rgb(17,17,17)" text-anchor="start" xml:space="preserve"><tspan x="30" y="46">Hello</tspan></text>',
    );
  });

  it('Arabic right-aligned: physical text-anchor end at the right edge, no direction attribute', () => {
    const t = text(
      'n3',
      { x: 230, y: 140, width: 150, height: 34 },
      'مرحبا بالعالم',
      1,
      style({ fontFamilies: ['Noto Sans Arabic'], direction: 'rtl', textAlign: 'right' }),
    );
    const { svg } = planToSvg(buildPlan(doc([t]), MOCK_FONTS));
    expect(svg).toMatch(
      /text-anchor="end" xml:space="preserve"><tspan x="380" y="156">مرحبا بالعالم<\/tspan>/,
    );
    expect(svg).not.toContain('direction=');
  });

  it('multi-line text uses the page line breaks at the line height; the group is named by line 1', () => {
    const t = text(
      'n4',
      { x: 10, y: 10, width: 200, height: 46 },
      'one two three four',
      2,
      style({ lineHeight: 27 }),
    );
    const plan = buildPlan(doc([t]), MOCK_FONTS);
    const { svg, stats, skipped } = planToSvg(plan, {
      lines: (id) => (id === 'n4' ? ['one two', 'three four'] : undefined),
    });
    expect(svg).toContain('<text id="one_two" ');
    expect(svg).toContain(
      '<tspan x="10" y="26">one two</tspan><tspan x="10" y="53">three four</tspan>',
    );
    expect(stats.lines).toBe(2);
    expect(skipped).toEqual([]);
    // RTL paragraph lines that start with Latin get the right-to-left mark, line by line.
    const rtl = text(
      'n7',
      { x: 10, y: 10, width: 200, height: 46 },
      'Inter أولاً ثم Tajawal',
      2,
      style({ lineHeight: 27, direction: 'rtl', textAlign: 'right' }),
    );
    const r = planToSvg(buildPlan(doc([rtl]), MOCK_FONTS), {
      lines: () => ['Inter أولاً', 'Tajawal'],
    }).svg;
    expect(r).toContain('>\u200FInter أولاً</tspan><tspan x="210" y="53">\u200FTajawal</tspan>');
    // Without line data it falls back to one line and says so.
    expect(planToSvg(plan).skipped).toContain('some line breaks unknown (one long line)');
  });

  it('clips only when a child overflows; escapes markup; placeholders are dashed and named', () => {
    const overflow: FrameNode = {
      ...card,
      children: [text('n5', { x: 30, y: 30, width: 400, height: 19 }, 'a < b & "c"')],
    };
    const img = {
      id: 'n6',
      name: 'img.logo',
      type: 'IMAGE' as const,
      rect: { x: 0, y: 200, width: 50, height: 50 },
      opacity: 1,
      assetId: null,
      scaleMode: 'FILL' as const,
    };
    const { svg, stats } = planToSvg(buildPlan(doc([overflow, img]), MOCK_FONTS));
    expect(svg).toContain(
      '<clipPath id="clip1"><rect x="20" y="20" width="200" height="100" rx="8"/></clipPath>',
    );
    expect(svg).toContain('<g clip-path="url(#clip1)">');
    expect(svg).toContain('>a &lt; b &amp; &quot;c&quot;</tspan>');
    expect(svg).toMatch(/<rect id="img.logo_image_not_captured_"[^>]*stroke-dasharray="4 4"\/>/);
    expect(stats.placeholders).toBe(1);
  });

  it('style names map to CSS weights; PostScript names drop spaces', () => {
    expect(styleToCss('Semi Bold Italic')).toEqual({ weight: 600, italic: true });
    expect(styleToCss('ExtraBold')).toEqual({ weight: 800, italic: false });
    expect(fontFamilyList({ family: 'Noto Sans Arabic', style: 'Semi Bold' })).toBe(
      'NotoSansArabic-SemiBold, Noto Sans Arabic',
    );
  });
});
