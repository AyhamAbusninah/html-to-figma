/** Conversion engine on synthetic raw trees. Verification level: UNIT (Node). */
import { validateCapture, type CaptureNode, type FrameNode, type TextNode } from '@h2f/schema';
import { describe, expect, it } from 'vitest';
import {
  buildCapture,
  buildCaptureDocument,
  CaptureTooLargeError,
  RAW_STYLE_KEYS,
  type RawElement,
  type RawNode,
  type RawPageSnapshot,
  type RawStyle,
  type RawText,
} from '../src/index.ts';

const BASE_STYLE = Object.fromEntries(RAW_STYLE_KEYS.map((k) => [k, ''])) as RawStyle;
Object.assign(BASE_STYLE, {
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  position: 'static',
  'z-index': 'auto',
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  'background-color': 'rgba(0, 0, 0, 0)',
  'background-image': 'none',
  'box-shadow': 'none',
  'mix-blend-mode': 'normal',
  transform: 'none',
  filter: 'none',
  'clip-path': 'none',
  'font-family': 'Inter, sans-serif',
  'font-size': '16px',
  'font-weight': '400',
  'font-style': 'normal',
  'line-height': 'normal',
  'letter-spacing': 'normal',
  color: 'rgb(17, 24, 39)',
  'text-align': 'start',
  direction: 'ltr',
  'white-space': 'normal',
  'text-transform': 'none',
  'text-decoration-line': 'none',
  'text-overflow': 'clip',
});
for (const side of ['top', 'right', 'bottom', 'left']) {
  BASE_STYLE[`border-${side}-width` as keyof RawStyle] = '0px';
  BASE_STYLE[`border-${side}-style` as keyof RawStyle] = 'none';
  BASE_STYLE[`border-${side}-color` as keyof RawStyle] = 'rgb(0, 0, 0)';
  BASE_STYLE[`padding-${side}` as keyof RawStyle] = '0px';
}
for (const c of ['top-left', 'top-right', 'bottom-right', 'bottom-left'])
  BASE_STYLE[`border-${c}-radius` as keyof RawStyle] = '0px';

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
function el(
  tag: string,
  r: ReturnType<typeof rect>,
  style: Partial<RawStyle> = {},
  children: RawNode[] = [],
  extra: Partial<RawElement> = {},
): RawElement {
  return {
    kind: 'element',
    tag,
    idAttr: '',
    classes: [],
    rect: r,
    style: { ...BASE_STYLE, ...style },
    children,
    ...extra,
  };
}
const text = (t: string, ...rects: ReturnType<typeof rect>[]): RawText => ({
  kind: 'text',
  text: t,
  rects,
});

function page(
  body: RawNode[],
  over: Partial<RawPageSnapshot> = {},
  bodyStyle: Partial<RawStyle> = {},
): RawPageSnapshot {
  return {
    url: 'http://localhost/x',
    title: 'T',
    lang: 'en',
    computedDirection: 'ltr',
    viewport: { width: 1280, height: 800 },
    scroll: { width: 1280, height: 2000 },
    devicePixelRatio: 1,
    userAgent: 'UA',
    backgroundColors: ['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)'],
    scrollOffset: { x: 0, y: 0 },
    clientWidth: 1280,
    tree: el('html', rect(0, 0, 1280, 2000), {}, [
      el('body', rect(0, 0, 1280, 2000), bodyStyle, body),
    ]),
    ...over,
  };
}
const build = (raw: RawPageSnapshot) =>
  buildCaptureDocument(raw, { extractorVersion: '0.2.0', capturedAt: '2026-11-08T12:00:00.000Z' });
const kids = (raw: RawPageSnapshot) => build(raw).root.children;
const all = (n: CaptureNode): CaptureNode[] => [
  n,
  ...(n.type === 'FRAME' ? n.children.flatMap(all) : []),
];

describe('text (EXT-X-1..5, EXT-G-1)', () => {
  it('one TEXT node per text node: normalized characters, document rect (scroll offset), lines, style', () => {
    const raw = page(
      [
        el(
          'p',
          rect(10, 20, 300, 48),
          { 'font-size': '20px', 'line-height': '24px', 'font-weight': '700' },
          [text('  Hello \n   world  ', rect(10, 20, 120, 24), rect(10, 44, 80, 24))],
        ),
      ],
      { scrollOffset: { x: 0, y: 500 } },
    );
    const [t] = kids(raw) as TextNode[];
    expect(t).toMatchObject({
      type: 'TEXT',
      characters: 'Hello world',
      rect: { x: 10, y: 520, width: 120, height: 48 },
      lineCount: 2,
      style: {
        fontFamilies: ['Inter', 'sans-serif'],
        fontWeight: 700,
        fontSize: 20,
        lineHeight: 24,
        textAlign: 'left',
        direction: 'ltr',
      },
    });
  });

  describe('wrapped text that starts or ends mid-line (OQ-11)', () => {
    const line = (start: number, end: number, ...rects: ReturnType<typeof rect>[]) => ({
      start,
      end,
      rects,
    });

    it('LTR: a first line that starts after an inline element becomes its own layer', () => {
      // "<b>Bold</b> rest of the text wraps here" → the text node starts at x=60 on line 1.
      const t = text(
        ' rest of the text wraps here',
        rect(60, 0, 240, 20),
        rect(10, 24, 290, 20),
        rect(10, 48, 100, 20),
      );
      t.lines = [
        line(1, 12, rect(60, 0, 240, 20)),
        line(13, 22, rect(10, 24, 290, 20)),
        line(23, 28, rect(10, 48, 100, 20)),
      ];
      const texts = kids(page([el('p', rect(10, 0, 300, 72), {}, [t])])) as TextNode[];
      expect(texts.map((n) => [n.characters, n.rect, n.lineCount])).toEqual([
        ['rest of the', { x: 60, y: 0, width: 240, height: 20 }, 1],
        ['text wraps here', { x: 10, y: 24, width: 290, height: 44 }, 2],
      ]);
      expect(build(page([el('p', rect(10, 0, 300, 72), {}, [t])])).meta.stats.textCount).toBe(2);
    });

    it('RTL: the right edge decides; a paragraph whose lines share it stays one layer', () => {
      const lines = [line(0, 5, rect(50, 0, 250, 20)), line(6, 13, rect(150, 24, 150, 20))];
      const shared = text('مرحبا بالعالم', rect(50, 0, 250, 20), rect(150, 24, 150, 20));
      shared.lines = lines;
      const [one] = kids(
        page([el('p', rect(0, 0, 300, 44), { direction: 'rtl' }, [shared])]),
      ) as TextNode[];
      expect(one).toMatchObject({ characters: 'مرحبا بالعالم', lineCount: 2 });

      // After a label on the right, line 1 ends at x=240, not at the paragraph's right edge (300).
      const afterTag = text('مرحبا بالعالم', rect(50, 0, 190, 20), rect(150, 24, 150, 20));
      afterTag.lines = [line(0, 5, rect(50, 0, 190, 20)), line(6, 13, rect(150, 24, 150, 20))];
      const split = kids(
        page([el('p', rect(0, 0, 300, 44), { direction: 'rtl' }, [afterTag])]),
      ) as TextNode[];
      expect(split.map((n) => [n.characters, n.rect.x, n.rect.width])).toEqual([
        ['مرحبا', 50, 190],
        ['بالعالم', 150, 150],
      ]);
      expect(split.every((n) => n.style.textAlign === 'right')).toBe(true);
    });

    it('textLines side output: the page line breaks of each multi-line TEXT, by node id', () => {
      const split = text(
        ' rest of the text wraps here',
        rect(60, 0, 240, 20),
        rect(10, 24, 290, 20),
        rect(10, 48, 100, 20),
      );
      split.lines = [
        line(1, 12, rect(60, 0, 240, 20)),
        line(13, 23, rect(10, 24, 290, 20)),
        line(24, 28, rect(10, 48, 100, 20)),
      ];
      const plain = text('alpha beta gamma', rect(10, 100, 120, 20), rect(10, 124, 60, 20));
      plain.lines = [line(0, 10, rect(10, 100, 120, 20)), line(11, 16, rect(10, 124, 60, 20))];
      const r = buildCapture(
        page([
          el('p', rect(10, 0, 300, 72), {}, [split]),
          el('p', rect(10, 100, 300, 44), {}, [plain]),
        ]),
        {
          extractorVersion: '0.3.0',
          capturedAt: '2026-11-10T12:00:00.000Z',
        },
      );
      const texts = all(r.document.root).filter((n) => n.type === 'TEXT') as TextNode[];
      expect(texts.map((t) => t.characters)).toEqual([
        'rest of the',
        'text wraps here',
        'alpha beta gamma',
      ]);
      // Single-line runs need no entry; the 2-line run and the plain paragraph get their lines.
      expect(r.textLines).toEqual({
        [texts[1]!.id]: ['text wraps', 'here'],
        [texts[2]!.id]: ['alpha beta', 'gamma'],
      });
      expect(
        buildCaptureDocument(page([]), {
          extractorVersion: '0.3.0',
          capturedAt: '2026-11-10T12:00:00.000Z',
        }).root.children,
      ).toEqual([]);
    });

    it('inconsistent line data falls back to one layer', () => {
      const t = text('one two', rect(60, 0, 40, 20), rect(10, 24, 30, 20));
      t.lines = [line(0, 3, rect(60, 0, 40, 20)), line(2, 7, rect(10, 24, 30, 20))]; // overlapping ranges
      const texts = kids(page([el('p', rect(10, 0, 100, 44), {}, [t])])) as TextNode[];
      expect(texts.map((n) => n.characters)).toEqual(['one two']);
    });
  });

  it('skips whitespace-only text, text without rects, and text under visibility:hidden', () => {
    const raw = page([
      el('div', rect(0, 0, 10, 10), { visibility: 'hidden' }, [text('hidden', rect(0, 0, 5, 5))]),
      el('div', rect(0, 0, 10, 10), {}, [text('   '), text('no rects')]),
    ]);
    expect(kids(raw)).toEqual([]);
  });

  it('RTL: start alignment resolves to right; Arabic letter-spacing is dropped with a warning (EXT-RTL-2/5)', () => {
    const raw = page([
      el('p', rect(0, 0, 300, 30), { direction: 'rtl', 'letter-spacing': '2px' }, [
        text('مرحبا بالعالم', rect(100, 0, 200, 30)),
      ]),
    ]);
    const doc = build(raw);
    const t = doc.root.children[0] as TextNode;
    expect(t.style).toMatchObject({ direction: 'rtl', textAlign: 'right', letterSpacing: 0 });
    expect(doc.meta.warnings.map((w) => w.code)).toContain('ARABIC_LETTER_SPACING_IGNORED');
  });
});

describe('boxes, pruning, order (EXT-T-5/6/8, EXT-V-*)', () => {
  it('wrappers without paint are pruned; their children are hoisted', () => {
    const raw = page([
      el('div', rect(0, 0, 500, 500), {}, [
        el('section', rect(10, 10, 100, 100), { 'background-color': 'rgb(255, 0, 0)' }),
      ]),
    ]);
    const out = kids(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'FRAME',
      name: 'Section',
      domPath: 'section',
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }],
    });
  });

  it('html/body never paint a fill (the root carries the page background)', () => {
    const doc = build(page([], {}, { 'background-color': 'rgb(250, 250, 250)' }));
    expect(doc.root.children).toEqual([]);
    expect(doc.root.fills).toEqual([{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]);
  });

  it('box styles: borders per side, radii, shadow, opacity, blend, clipping', () => {
    const raw = page([
      el('div', rect(0, 0, 200, 100), {
        'background-color': 'rgb(255, 255, 255)',
        'border-top-width': '2px',
        'border-top-style': 'dashed',
        'border-top-color': 'rgb(0, 0, 255)',
        'border-top-left-radius': '50%',
        'border-bottom-right-radius': '12px',
        'box-shadow': 'rgba(0, 0, 0, 0.25) 0px 4px 12px 0px',
        opacity: '0.5',
        'mix-blend-mode': 'multiply',
        'overflow-y': 'auto',
      }),
    ]);
    const f = kids(raw)[0] as FrameNode;
    expect(f.strokes?.top).toEqual({
      width: 2,
      color: { r: 0, g: 0, b: 1, a: 1 },
      style: 'dashed',
    });
    expect(f.strokes?.left.width).toBe(0);
    expect(f.radii).toEqual({ tl: 50, tr: 0, br: 12, bl: 0 });
    expect(f.effects).toEqual([
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.25 },
        offset: { x: 0, y: 4 },
        radius: 12,
        spread: 0,
      },
    ]);
    expect(f).toMatchObject({ opacity: 0.5, blendMode: 'MULTIPLY', clipsContent: true });
  });

  it('paint order: negative z → in-flow → positioned auto/0 → positive z (stable by DOM order)', () => {
    const box = (name: string, style: Partial<RawStyle>) =>
      el(name, rect(0, 0, 10, 10), { 'background-color': 'rgb(1, 1, 1)', ...style });
    const raw = page([
      box('a', { position: 'absolute', 'z-index': '5' }),
      box('b', {}),
      box('c', { position: 'relative', 'z-index': '-1' }),
      box('d', { position: 'relative' }),
      box('e', {}),
      box('f', { position: 'absolute', 'z-index': '2' }),
    ]);
    expect(kids(raw).map((n) => n.domPath)).toEqual(['c', 'b', 'e', 'd', 'f', 'a']);
  });

  it('opacity 0 subtrees are skipped; visibility:hidden keeps visible descendants', () => {
    const raw = page([
      el('div', rect(0, 0, 10, 10), { opacity: '0' }, [
        el('i', rect(0, 0, 5, 5), { 'background-color': 'rgb(1,1,1)' }),
      ]),
      el('div', rect(0, 0, 50, 50), { visibility: 'hidden', 'background-color': 'rgb(9,9,9)' }, [
        el('b', rect(0, 0, 5, 5), { 'background-color': 'rgb(2, 2, 2)' }),
      ]),
    ]);
    expect(kids(raw).map((n) => n.domPath)).toEqual(['b']);
  });
});

describe('replaced content, controls, warnings', () => {
  it('replaced elements become IMAGE placeholders (assetId null) with per-node warnings', () => {
    const doc = build(
      page([
        el('img', rect(0, 0, 64, 64), { 'object-fit': 'cover' }, [], { replaced: { kind: 'img' } }),
        el('svg', rect(70, 0, 24, 24), {}, [], { replaced: { kind: 'svg' } }),
      ]),
    );
    expect(
      doc.root.children.map((n) => [
        n.type,
        (n as { assetId?: unknown }).assetId,
        (n as { scaleMode?: string }).scaleMode,
      ]),
    ).toEqual([
      ['IMAGE', null, 'FILL'],
      ['IMAGE', null, 'STRETCH'],
    ]);
    expect(doc.meta.stats).toMatchObject({ imageCount: 1, svgCount: 1 });
    expect(doc.meta.warnings.map((w) => [w.code, w.nodeId])).toEqual([
      ['IMAGE_NOT_CAPTURED', doc.root.children[0]!.id],
      ['SVG_NOT_CAPTURED', doc.root.children[1]!.id],
    ]);
  });

  it('collected assets: SVG markup → SvgNode, pixels → IMAGE with assetId, only used assets kept (R4)', () => {
    const asset = {
      mime: 'image/png' as const,
      data: 'iVBORw0KGgo=',
      width: 2,
      height: 2,
      source: 'canvas' as const,
    };
    const raw = page([
      el('svg', rect(0, 0, 24, 24), {}, [], {
        replaced: { kind: 'svg' },
        svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      }),
      el('img', rect(30, 0, 64, 64), { 'object-fit': 'contain' }, [], {
        replaced: { kind: 'img' },
        assetId: 'img_a',
      }),
      el('img', rect(100, 0, 64, 64), {}, [], { replaced: { kind: 'img' }, assetFailed: true }),
      el('svg', rect(170, 0, 24, 24), {}, [], {
        replaced: { kind: 'svg' },
        svg: `<svg>${'x'.repeat(600 * 1024)}</svg>`,
      }),
    ]);
    raw.assets = { img_a: asset, img_unused: asset };
    const doc = build(raw);
    expect(validateCapture(doc).ok).toBe(true);
    const [svg, img, failed, big] = doc.root.children;
    expect(svg).toMatchObject({
      type: 'SVG',
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      fallbackAssetId: null,
    });
    expect(img).toMatchObject({ type: 'IMAGE', assetId: 'img_a', scaleMode: 'FIT' });
    expect(failed).toMatchObject({ type: 'IMAGE', assetId: null });
    expect(big).toMatchObject({ type: 'IMAGE', assetId: null });
    expect(Object.keys(doc.assets.images)).toEqual(['img_a']);
    expect(doc.meta.stats).toMatchObject({ imageCount: 2, svgCount: 2 });
    const codes = doc.meta.warnings.map((w) => w.code);
    expect(codes).toContain('SVG_TOO_LARGE');
    expect(codes).toContain('IMAGE_FETCH_FAILED');
    expect(codes).not.toContain('IMAGE_NOT_CAPTURED');
  });

  it('icon-font glyphs drawn by the collector become IMAGE nodes at the glyph box (EXT-X-9)', () => {
    const glyph = text('\uf00c', rect(10, 10, 16, 20));
    glyph.iconAssetId = 'img_icon';
    const raw = page([
      el('i', rect(10, 10, 16, 20), {}, [glyph], { idAttr: '', classes: ['fa-check'] }),
    ]);
    raw.assets = {
      img_icon: {
        mime: 'image/png',
        data: 'iVBORw0KGgo=',
        width: 32,
        height: 40,
        source: 'canvas',
      },
    };
    const doc = build(raw);
    expect(validateCapture(doc).ok).toBe(true);
    expect(doc.root.children[0]).toMatchObject({
      type: 'IMAGE',
      name: 'Icon · Fa check',
      domPath: 'i.fa-check',
      assetId: 'img_icon',
      rect: { x: 10, y: 10, width: 16, height: 20 },
    });
    expect(doc.meta.stats).toMatchObject({ textCount: 0, imageCount: 1 });
  });

  it('form controls: value text in the content box; password masked even if the collector failed to (EXT-X-6/7)', () => {
    const input = (
      text: string,
      inputType: string,
      isPlaceholder = false,
      contentHeight?: number,
    ) =>
      el(
        'input',
        rect(0, 0, 200, 40),
        {
          'padding-left': '10px',
          'border-left-width': '1px',
          'line-height': '20px',
          'background-color': 'rgb(255,255,255)',
        },
        [],
        {
          control: {
            kind: 'text',
            inputType,
            text,
            isPlaceholder,
            placeholderColor: 'rgb(156, 163, 175)',
            ...(contentHeight ? { contentHeight } : {}),
          },
        },
      );
    const doc = build(
      page([input('secret-123', 'password', false, 18), input('Search…', 'search', true)]),
    );
    const texts = all(doc.root).filter((n) => n.type === 'TEXT') as TextNode[];
    expect(texts.map((t) => t.characters)).toEqual(['••••••••••', 'Search…']);
    // The font's content area (measured 18 px) is centered in the 40 px box; line-height 20px plays no part.
    expect(texts[0]!.rect).toMatchObject({ x: 11, y: 11, height: 18 });
    // Without a measurement: 1.2 × font size (16 px → 19.2).
    expect(texts[1]!.rect).toMatchObject({ x: 11, y: 10.4, height: 19.2 });
    expect(texts[1]!.style.color).toEqual({ r: 0.6118, g: 0.6392, b: 0.6863, a: 1 });
    expect(JSON.stringify(doc)).not.toContain('secret-123');
  });

  it('aggregated warnings count occurrences (gradients, bg images, pseudo, ellipsis)', () => {
    const doc = build(
      page([
        el('div', rect(0, 0, 10, 10), {
          'background-image': 'conic-gradient(rgb(255, 0, 0), rgb(0, 0, 255))',
        }),
        el('div', rect(0, 0, 10, 10), { 'background-image': 'url("a.png")' }, [], {
          pseudo: { before: true, after: true },
        }),
        el(
          'div',
          rect(0, 0, 10, 10),
          { 'background-image': 'repeating-linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255) 2px)' },
          [],
          {
            ellipsisTruncated: true,
          },
        ),
      ]),
    );
    const byCode = Object.fromEntries(doc.meta.warnings.map((w) => [w.code, w.message]));
    expect(byCode.GRADIENT_UNSUPPORTED).toMatch(/\(2×\)$/);
    expect(byCode.BACKGROUND_IMAGE_NOT_CAPTURED).toMatch(/\(1×\)$/);
    expect(byCode.PSEUDO_ELEMENT_NOT_CAPTURED).toMatch(/\(2×\)$/);
    expect(byCode.TEXT_ELLIPSIS_NOT_APPLIED).toMatch(/\(1×\)$/);
    expect(doc.root.children.map((n) => n.name)).toEqual(['Box', 'Box ⚠ bg-image', 'Box']);
    // Unsupported gradients fall back to their first color.
    expect((doc.root.children[0] as FrameNode).fills).toEqual([
      { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } },
    ]);
  });

  it('background layers → fills bottom to top: color, image (pre-composited asset), gradient overlay', () => {
    const raw = page([
      el(
        'section',
        rect(0, 0, 200, 100),
        {
          'background-color': 'rgb(0, 0, 0)',
          'background-image':
            'linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url("https://cdn.example/hero.jpg")',
        },
        [],
        { bgAssets: ['img_hero'] },
      ),
    ]);
    raw.assets = {
      img_hero: { mime: 'image/jpeg', data: '/9j/', width: 200, height: 100, source: 'fetch' },
    };
    const doc = build(raw);
    expect(validateCapture(doc).ok).toBe(true);
    const f = doc.root.children[0] as FrameNode;
    expect(f.fills.map((p) => p.type)).toEqual(['SOLID', 'IMAGE', 'GRADIENT_LINEAR']);
    expect(f.fills[1]).toEqual({ type: 'IMAGE', assetId: 'img_hero', scaleMode: 'FILL' });
    expect(f.domPath).toBe('section');
    expect(Object.keys(doc.assets.images)).toEqual(['img_hero']);
    expect(doc.meta.warnings).toEqual([]);
  });
});

describe('document level', () => {
  it('RTL horizontal overflow normalizes x so the scrollable area starts at 0 (EXT-RTL-4)', () => {
    const raw = page([el('div', rect(0, 0, 100, 10), { 'background-color': 'rgb(1,1,1)' })], {
      computedDirection: 'rtl',
      scroll: { width: 2048, height: 800 },
      clientWidth: 1280,
      scrollOffset: { x: 0, y: 0 },
    });
    expect(kids(raw)[0]!.rect.x).toBe(768);
    const scrolledLeft = page(
      [el('div', rect(0, 0, 100, 10), { 'background-color': 'rgb(1,1,1)' })],
      { ...raw, scrollOffset: { x: -768, y: 0 } },
    );
    expect(kids(scrolledLeft)[0]!.rect.x).toBe(0);
  });

  it('valid, deterministic, unique ids, stats match the tree', () => {
    const raw = page([
      el('div', rect(0, 0, 100, 100), { 'background-color': 'rgb(1,1,1)' }, [
        text('a', rect(0, 0, 5, 5)),
      ]),
      el('p', rect(0, 0, 10, 10), {}, [text('b', rect(0, 0, 5, 5))]),
    ]);
    const a = build(raw);
    expect(validateCapture(a).ok).toBe(true);
    expect(build(raw)).toEqual(a);
    const nodes = all(a.root);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    expect(a.meta.stats).toMatchObject({ nodeCount: nodes.length, textCount: 2 });
  });

  it('throws CaptureTooLargeError above the node limit (EXT-T-10)', () => {
    const many = Array.from({ length: 10_001 }, () =>
      el('b', rect(0, 0, 1, 1), { 'background-color': 'rgb(1,1,1)' }),
    );
    expect(() => build(page(many))).toThrow(CaptureTooLargeError);
  });
});

describe('page effects: clip-path inset, blended elements, mirroring (EXT-V-10, EXT-G-3)', () => {
  const asset = {
    mime: 'image/png' as const,
    data: 'iVBORw0KGgo=',
    width: 2,
    height: 2,
    source: 'screenshot' as const,
  };

  it('clip-path: inset(-9999px -9999px 0) clips overflowing content at the bottom edge only', () => {
    const raw = page([
      el(
        'section',
        rect(0, 600, 1280, 400),
        { 'clip-path': 'inset(-9999px -9999px 0px)', 'background-color': 'rgb(60, 40, 40)' },
        [
          el('img', rect(-190, 520, 1120, 600), {}, [], {
            replaced: { kind: 'img' },
            assetId: 'img_a',
          }),
        ],
      ),
    ]);
    raw.assets = { img_a: asset };
    const doc = build(raw);
    expect(validateCapture(doc).ok).toBe(true);
    const [clip] = doc.root.children as FrameNode[];
    // Left/top/right: the content's own extent, image ∪ section (nothing cut); bottom: the section's edge.
    expect(clip).toMatchObject({
      type: 'FRAME',
      name: 'Clip · Section',
      domPath: 'section::clip',
      clipsContent: true,
      fills: [],
      rect: { x: -190, y: 520, width: 1470, height: 480 }, // image ∪ section
    });
    expect(clip!.children.map((c) => c.domPath)).toEqual(['section']);
    expect(doc.meta.warnings.map((w) => w.code)).not.toContain('CLIP_MASK_UNSUPPORTED');
  });

  it('clip-path: inset(10px round 8px) → a rounded clipping frame the size of the inset box', () => {
    const doc = build(
      page([
        el('div', rect(0, 0, 100, 100), {
          'clip-path': 'inset(10px round 8px)',
          'background-color': 'rgb(1, 2, 3)',
        }),
      ]),
    );
    expect(doc.root.children[0]).toMatchObject({
      type: 'FRAME',
      clipsContent: true,
      rect: { x: 10, y: 10, width: 80, height: 80 },
      radii: { tl: 8, tr: 8, br: 8, bl: 8 },
    });
  });

  it('clip-path inset that cuts nothing adds no frame; other shapes still warn', () => {
    const doc = build(
      page([
        el('div', rect(0, 0, 100, 100), {
          'clip-path': 'inset(0px)',
          'background-color': 'rgb(1, 2, 3)',
        }),
        el('div', rect(0, 200, 100, 100), {
          'clip-path': 'circle(50% at 50% 50%)',
          'background-color': 'rgb(1, 2, 3)',
        }),
      ]),
    );
    expect(doc.root.children.map((c) => c.domPath)).toEqual(['div', 'div']);
    expect(doc.meta.warnings.map((w) => w.code)).toContain('CLIP_MASK_UNSUPPORTED');
  });

  it('a blended element with a screenshot becomes one IMAGE (children not repeated) + BLEND_MODE_RASTERIZED', () => {
    const raw = page([
      el('div', rect(0, 0, 480, 160), { 'background-color': 'rgb(255, 255, 255)' }, [
        el('span', rect(24, 0, 200, 160), {}, [text('INK', rect(24, 0, 200, 160))]),
        el(
          'div',
          rect(0, 0, 480, 160),
          { 'mix-blend-mode': 'lighten', 'background-color': 'rgb(180, 120, 60)' },
          [text('inside', rect(0, 0, 40, 20))],
          { raster: true, assetId: 'img_shot' },
        ),
      ]),
    ]);
    raw.assets = { img_shot: asset };
    const doc = build(raw);
    const nodes = all(doc.root);
    const shot = nodes.find((n) => n.type === 'IMAGE')!;
    expect(shot).toMatchObject({
      name: 'Box · blended',
      domPath: 'div',
      assetId: 'img_shot',
      scaleMode: 'STRETCH',
    });
    expect(nodes.some((n) => n.type === 'TEXT' && n.characters === 'inside')).toBe(false);
    expect(nodes.some((n) => n.type === 'TEXT' && n.characters === 'INK')).toBe(true);
    expect(doc.meta.warnings.map((w) => w.code)).toContain('BLEND_MODE_RASTERIZED');
    // Without the screenshot the layers stay (with the native blend mode).
    const plain = build(
      page([
        el('div', rect(0, 0, 480, 160), {
          'mix-blend-mode': 'lighten',
          'background-color': 'rgb(180, 120, 60)',
        }),
      ]),
    );
    expect(plain.root.children[0]).toMatchObject({ type: 'FRAME', blendMode: 'LIGHTEN' });
  });

  it('a mirroring wrapper without text is not reported as an unsupported transform; with text it is', () => {
    const icon = el('svg', rect(0, 0, 24, 24), {}, [], {
      replaced: { kind: 'svg' },
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
    const flipped = { transform: 'matrix(-1, 0, 0, 1, 0, 0)' };
    const codes = (body: RawNode[]) => build(page(body)).meta.warnings.map((w) => w.code);
    expect(codes([el('span', rect(0, 0, 24, 24), flipped, [icon])])).not.toContain(
      'TRANSFORM_UNSUPPORTED',
    );
    expect(
      codes([el('span', rect(0, 0, 24, 24), flipped, [text('Back', rect(0, 0, 30, 20))])]),
    ).toContain('TRANSFORM_UNSUPPORTED');
  });
});

describe('text-overflow: ellipsis and textarea text (EXT-X-8, EXT-X-6)', () => {
  it('a cut text node becomes "visible part…" in the visible box; text past the edge is dropped; no warning', () => {
    const doc = build(
      page([
        el(
          'p',
          rect(0, 0, 260, 24),
          { 'text-overflow': 'ellipsis', 'white-space': 'nowrap', 'overflow-x': 'hidden' },
          [
            {
              ...text('This single line is far too long ', rect(0, 2, 300, 20)),
              ellipsis: { end: 26, rect: rect(0, 2, 258, 20) },
            },
            {
              ...text('hidden', rect(300, 2, 50, 20)),
              ellipsis: { end: 0, rect: rect(300, 2, 0, 20) },
            },
          ],
          { ellipsisTruncated: true },
        ),
      ]),
    );
    const texts = all(doc.root).filter((n) => n.type === 'TEXT') as TextNode[];
    expect(texts.map((t) => t.characters)).toEqual(['This single line is far to…']);
    expect(texts[0]!.rect).toMatchObject({ x: 0, y: 2, width: 258, height: 20 });
    expect(doc.meta.warnings.map((w) => w.code)).not.toContain('TEXT_ELLIPSIS_NOT_APPLIED');
    // Without the collector's cut, the warning stays.
    const plain = build(
      page([
        el('p', rect(0, 0, 260, 24), {}, [text('long', rect(0, 2, 300, 20))], {
          ellipsisTruncated: true,
        }),
      ]),
    );
    expect(plain.meta.warnings.map((w) => w.code)).toContain('TEXT_ELLIPSIS_NOT_APPLIED');
  });

  it('textarea text starts at the top (one line too), not centered like an input', () => {
    const area = (t: string) =>
      el('textarea', rect(0, 0, 300, 100), { 'line-height': '24px', 'padding-top': '8px' }, [], {
        control: {
          kind: 'textarea',
          inputType: '',
          text: t,
          isPlaceholder: false,
          placeholderColor: '',
          contentHeight: 20,
        },
      });
    const [one, two] = [area('Write a comment…'), area('Line one\nLine two')].map(
      (a) => all(build(page([a])).root).find((n) => n.type === 'TEXT') as TextNode,
    );
    // First line: padding 8 + half-leading (24 − 20) / 2 = 10.
    expect(one!.rect).toMatchObject({ y: 10, height: 20 });
    expect(two!.rect).toMatchObject({ y: 10, height: 44 });
  });
});
