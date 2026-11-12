/** Copy to Figma SVG serializer (EXT-O-7). Verification level: UNIT (Node). Figma behavior: docs/spikes §4b. */
import { describe, expect, it } from 'vitest';
import type { CaptureDocument, FrameNode, TextNode } from '@h2f/schema';
import { minimal } from '../../schema/test/samples.ts';
import { buildPlan } from '../src/plan/plan.ts';
import {
  hairSpaceEm,
  fontFamilyList,
  planToSvg,
  spaceLetters,
  styleToCss,
  titleCase,
} from '../src/svg/svg.ts';
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
      '<rect id="div.card background" x="20" y="20" width="200" height="100" rx="8" fill="rgb(51,102,255)"/>',
    );
    expect(svg).not.toContain('clip-path'); // the card clips, but nothing overflows it
    expect(stats).toEqual({ boxes: 1, texts: 1, images: 0, svgs: 0, placeholders: 0, lines: 1 });
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
    expect(svg).toContain('<text id="one two" ');
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
    expect(svg).toMatch(/<rect id="img.logo \(image not captured\)"[^>]*stroke-dasharray="4 4"\/>/);
    expect(stats.placeholders).toBe(1);
  });

  it('images: <image> with the asset as a data URI, object-fit as preserveAspectRatio, rounded corners as a clip', () => {
    const d = doc([
      {
        id: 'n8',
        name: 'img.hero',
        type: 'IMAGE',
        rect: { x: 0, y: 0, width: 200, height: 100 },
        opacity: 1,
        assetId: 'a1',
        scaleMode: 'FILL',
        radii: { tl: 12, tr: 12, br: 12, bl: 12 },
      },
      {
        id: 'n9',
        name: 'img.missing',
        type: 'IMAGE',
        rect: { x: 0, y: 120, width: 50, height: 50 },
        opacity: 1,
        assetId: null,
        scaleMode: 'STRETCH',
      },
    ]);
    d.assets.images = {
      a1: { mime: 'image/png', data: 'iVBORw0KGgo=', width: 1, height: 1, source: 'canvas' },
    };
    const { svg, stats } = planToSvg(buildPlan(d, MOCK_FONTS));
    expect(svg).toContain(
      '<image id="img.hero" x="0" y="0" width="200" height="100" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip1)" href="data:image/png;base64,iVBORw0KGgo="/>',
    );
    expect(svg).toContain(
      '<clipPath id="clip1"><rect x="0" y="0" width="200" height="100" rx="12"/></clipPath>',
    );
    expect(stats).toMatchObject({ images: 1, placeholders: 1 });
  });

  it('SVG nodes: nested <svg> placed at the node box, keeping viewBox and content', () => {
    const d = doc([
      {
        id: 'n10',
        name: 'svg.icon',
        type: 'SVG',
        rect: { x: 40, y: 50, width: 24, height: 24 },
        opacity: 0.5,
        fallbackAssetId: null,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" x="9"><path d="M0 0h24v24z" fill="rgb(255,0,0)"/></svg>',
      },
    ]);
    const { svg, stats } = planToSvg(buildPlan(d, MOCK_FONTS));
    expect(svg).toContain(
      '<g opacity="0.5"><svg id="svg.icon" x="40" y="50" width="24" height="24" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24z" fill="rgb(255,0,0)"/></svg></g>',
    );
    expect(stats.svgs).toBe(1);
  });

  it('background layers: color, image, gradient overlay stacked bottom → top; gradient line follows the CSS angle', () => {
    const hero: FrameNode = {
      id: 'n11',
      name: 'section.hero',
      type: 'FRAME',
      rect: { x: 0, y: 0, width: 200, height: 100 },
      opacity: 1,
      clipsContent: false,
      children: [],
      fills: [
        { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } },
        { type: 'IMAGE', assetId: 'a1', scaleMode: 'FILL' },
        {
          type: 'GRADIENT_LINEAR',
          angleDeg: 90,
          stops: [
            { position: 0, color: { r: 0, g: 0, b: 0, a: 0.5 } },
            { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
          ],
        },
      ],
    };
    const d = doc([hero]);
    d.assets.images = {
      a1: { mime: 'image/png', data: 'iVBORw0KGgo=', width: 1, height: 1, source: 'fetch' },
    };
    const { svg, stats } = planToSvg(buildPlan(d, MOCK_FONTS));
    const order = [
      'section.hero background"',
      'section.hero background image"',
      'section.hero gradient"',
    ].map((x) => svg.indexOf(x));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // 90deg = to right: the line runs across the box width through its center.
    expect(svg).toContain(
      '<linearGradient id="grad1" gradientUnits="userSpaceOnUse" x1="0" y1="50" x2="200" y2="50"><stop offset="0" stop-color="rgb(0,0,0)" stop-opacity="0.5"/><stop offset="1" stop-color="rgb(255,255,255)"/></linearGradient>',
    );
    expect(stats.images).toBe(1);
  });

  it('radial gradient: center and radii from the box; ellipses squashed with a transform', () => {
    const blob: FrameNode = {
      id: 'n12',
      name: 'div.glow',
      type: 'FRAME',
      rect: { x: 10, y: 10, width: 200, height: 100 },
      opacity: 1,
      clipsContent: false,
      children: [],
      fills: [
        {
          type: 'GRADIENT_RADIAL',
          center: { x: 0.5, y: 0.5 },
          radius: { x: 0.5, y: 0.5 },
          stops: [
            { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
        },
      ],
    };
    const { svg } = planToSvg(buildPlan(doc([blob]), MOCK_FONTS));
    expect(svg).toContain(
      '<radialGradient id="grad1" gradientUnits="userSpaceOnUse" cx="110" cy="60" r="100" gradientTransform="translate(110 60) scale(1 0.5) translate(-110 -60)">',
    );
    expect(svg).toContain(
      '<rect id="div.glow" x="10" y="10" width="200" height="100" fill="url(#grad1)"/>',
    );
  });

  it('style names map to CSS weights; PostScript names drop spaces', () => {
    expect(styleToCss('Semi Bold Italic')).toEqual({ weight: 600, italic: true });
    expect(styleToCss('ExtraBold')).toEqual({ weight: 800, italic: false });
    expect(fontFamilyList({ family: 'Noto Sans Arabic', style: 'Semi Bold' })).toBe(
      'NotoSansArabic-SemiBold, Noto Sans Arabic',
    );
  });
});

describe('titleCase (text-transform: capitalize)', () => {
  it('upper-cases the first letter of each word only', () => {
    expect(titleCase('a selection of designer pieces, chosen with purpose')).toBe(
      'A Selection Of Designer Pieces, Chosen With Purpose',
    );
    expect(titleCase("don't stop (new) e-mail")).toBe("Don't Stop (New) E-Mail");
    expect(titleCase('iPhone USB')).toBe('IPhone USB'); // like CSS: the rest is left as written
    expect(titleCase('\u200Fحقائب bags')).toBe('\u200Fحقائب Bags'); // scripts without case unchanged
  });
});

describe('hard line breaks', () => {
  it('text with line feeds becomes one tspan per line (Figma turns a line feed into a space)', () => {
    const t = text(
      'n9',
      { x: 10, y: 10, width: 200, height: 40 },
      'First line\nSecond line',
      2,
      style({ lineHeight: 20 }),
    );
    const { svg } = planToSvg(buildPlan(doc([t]), MOCK_FONTS));
    expect(svg).toMatch(/<tspan[^>]*>First line<\/tspan><tspan[^>]*>Second line<\/tspan>/);
    expect(svg).not.toContain('First line\nSecond');
  });
});

describe('solid rings (box-shadow with spread only)', () => {
  const ringBox = (type: 'DROP_SHADOW' | 'INNER_SHADOW'): FrameNode => ({
    id: 'r1',
    name: 'Button · Save',
    type: 'FRAME',
    rect: { x: 10, y: 10, width: 200, height: 48 },
    opacity: 1,
    fills: [],
    radii: { tl: 4, tr: 4, br: 4, bl: 4 },
    effects: [
      {
        type,
        color: { r: 0.098, g: 0.098, b: 0.098, a: 1 },
        offset: { x: 0, y: 0 },
        radius: 0,
        spread: 1,
      },
    ],
    clipsContent: false,
    children: [],
  });

  it('inset 0 0 0 1px is drawn as an inside stroke (the outline Envato-style buttons use)', () => {
    const { svg, skipped } = planToSvg(buildPlan(doc([ringBox('INNER_SHADOW')]), MOCK_FONTS));
    expect(svg).toMatch(
      /id="Button · Save inner ring" x="10.5" y="10.5" width="199" height="47" rx="3.5"[^>]*stroke="rgb\(25,25,25\)"[^>]*stroke-width="1"/,
    );
    expect(skipped).not.toContain('inner shadows');
  });

  it('0 0 0 2px outside (focus ring) is drawn as an outside stroke', () => {
    const b = ringBox('DROP_SHADOW');
    b.effects![0] = { ...b.effects![0]!, spread: 2 } as never;
    const { svg, skipped } = planToSvg(buildPlan(doc([b]), MOCK_FONTS));
    expect(svg).toMatch(/id="Button · Save outer ring" x="9" y="9" width="202" height="50" rx="5"/);
    expect(svg).not.toContain('<filter');
    expect(skipped).not.toContain('shadow spread');
  });
});

describe('letter spacing (Figma SVG import drops it)', () => {
  it('names spaced text with its tracking and keeps centred and right-aligned glyphs in place', () => {
    const spaced = (id: string, textAlign: 'left' | 'center' | 'right', x: number) =>
      text(
        id,
        { x, y: 10, width: 200, height: 40 },
        'THE NEW SEASON',
        1,
        style({ fontSize: 32, letterSpacing: 6, textAlign }),
      );
    const { svg, skipped } = planToSvg(
      buildPlan(
        doc([spaced('a', 'left', 0), spaced('b', 'center', 0), spaced('c', 'right', 0)]),
        MOCK_FONTS,
      ),
    );
    expect(svg.match(/<text id="THE NEW SEASON · tracking 6px[^"]*"/g)).toHaveLength(3);
    expect(svg).toMatch(/text-anchor="start"[^>]*><tspan x="0"/);
    expect(svg).toMatch(/text-anchor="middle"[^>]*><tspan x="97"/); // (200 - 6) / 2: Chrome's box holds a trailing gap
    expect(svg).toMatch(/text-anchor="end"[^>]*><tspan x="194"/);
    expect(skipped).toContain('letter spacing (value in the layer name)');
  });

  it('text without spacing keeps no id (Figma names it after its characters)', () => {
    const { svg, skipped } = planToSvg(buildPlan(doc([card]), MOCK_FONTS));
    expect(svg).not.toMatch(/<text id=/);
    expect(skipped.join()).not.toContain('letter spacing');
  });
});

describe('Match letter spacing (hair spaces, the only spacing Figma keeps)', () => {
  const H = '\u200A';
  const count = (s: string) => [...s].filter((c) => c === H).length;

  it('puts hair spaces between letters so each letter stays within half a hair space of Chrome', () => {
    const size = 32;
    const hair = hairSpaceEm('Inter') * size; // ≈ 2.9 px
    const out = spaceLetters('THE NEW SEASON', 6, hair);
    expect(out.replace(/\u200A/g, '')).toBe('THE NEW SEASON');
    // Walk the output: before the i-th letter there must be ≈ i × 6 px of hair spaces (error ≤ half a hair).
    let placed = 0;
    let letter = 0;
    for (const c of out) {
      if (c === H) placed++;
      else expect(Math.abs(placed * hair - letter++ * 6)).toBeLessThanOrEqual(hair / 2 + 1e-9);
    }
    expect(count(out)).toBe(Math.round((13 * 6) / hair)); // total width matches the page
  });

  it('keeps graphemes and a leading direction mark whole; no spacing when ls ≤ 0', () => {
    expect(spaceLetters('\u200Eé👍🏽a', 6, 3).startsWith('\u200Eé')).toBe(true);
    expect(spaceLetters('\u200Eé👍🏽a', 6, 3)).toContain('👍🏽');
    expect(spaceLetters('Tight', -1, 1.5)).toBe('Tight');
    expect(spaceLetters('Plain', 0, 1.5)).toBe('Plain');
  });

  it('planToSvg: on → hair spaces, off (default) → clean text; the layer name keeps the clean text', () => {
    const t = text(
      's',
      { x: 0, y: 0, width: 200, height: 40 },
      'WOMEN',
      1,
      style({ fontSize: 11.5, letterSpacing: 2.53 }),
    );
    const on = planToSvg(buildPlan(doc([t]), MOCK_FONTS), { matchLetterSpacing: true });
    const off = planToSvg(buildPlan(doc([t]), MOCK_FONTS));
    expect(on.svg).toContain('id="WOMEN · tracking 2.53px"');
    expect(count(on.svg)).toBe(Math.round((4 * 2.53) / (hairSpaceEm('Inter') * 11.5))); // 4 gaps, ≈ 2.3 each
    expect(on.skipped).toContain('letter spacing (as hair spaces)');
    expect(count(off.svg)).toBe(0);
    expect(off.skipped).toContain('letter spacing (value in the layer name)');
  });
});

describe("hair space width per font (Figma draws the font's own glyph)", () => {
  it('matches the widths measured in real Figma Web (spikes/figma-svg spacing4), default 1/16 em', () => {
    // Real Figma Web, 50 px, 20 hair spaces: Inter 0.091, Manrope 0.062, Cormorant Garamond 0.118, Roboto 0.103,
    // Montserrat 0.100, Playfair Display 0.063 (±0.001 em reading error).
    const figma: Record<string, number> = {
      Inter: 0.091,
      Manrope: 0.062,
      'Cormorant Garamond': 0.118,
      Roboto: 0.103,
      Montserrat: 0.1,
      'Playfair Display': 0.063,
    };
    for (const [family, em] of Object.entries(figma))
      expect(Math.abs(hairSpaceEm(family) - em), family).toBeLessThanOrEqual(0.0015);
    expect(hairSpaceEm('Some Unknown Font')).toBe(0.0625);
  });
});
