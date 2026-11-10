/** Pure planner + font resolution. Verification level: UNIT (Node). No Figma involved. */
import { describe, expect, it } from 'vitest';
import { kitchenSink, minimal } from '../../schema/test/samples.ts';
import { FontResolver, parseStyleName } from '../src/plan/fonts.ts';
import { buildPlan, withDirectionMark, type PlanBox, type PlanText } from '../src/plan/plan.ts';
import { MOCK_FONTS } from './figma-mock.ts';

describe('font resolution (PLG-F-1..6)', () => {
  const r = new FontResolver(MOCK_FONTS);

  it('parses style names, including compact and italic forms', () => {
    expect(parseStyleName('Semi Bold Italic')).toEqual({ weight: 600, italic: true });
    expect(parseStyleName('ExtraBold')).toEqual({ weight: 800, italic: false });
    expect(parseStyleName('Italic')).toEqual({ weight: 400, italic: true });
    expect(parseStyleName('Condensed Wide')).toBeNull();
  });

  it('first available family in the stack; aliases and generics mapped', () => {
    expect(
      r.resolve({ families: ['Roboto', 'Inter'], weight: 500, italic: false, arabic: false }),
    ).toMatchObject({ font: { family: 'Roboto', style: 'Medium' }, substituted: false });
    expect(
      r.resolve({
        families: ['InterVariable', 'sans-serif'],
        weight: 400,
        italic: false,
        arabic: false,
      }),
    ).toMatchObject({ font: { family: 'Inter', style: 'Regular' }, substituted: false });
    expect(
      r.resolve({
        families: ['ui-monospace', 'monospace'],
        weight: 400,
        italic: false,
        arabic: false,
      }).font.family,
    ).toBe('Roboto Mono');
  });

  it('nearest weight with tie-break (bolder for >= 500), italic preferred', () => {
    expect(
      r.resolve({ families: ['Roboto'], weight: 600, italic: false, arabic: false }).font.style,
    ).toBe('Bold');
    expect(
      r.resolve({ families: ['Roboto'], weight: 300, italic: false, arabic: false }).font.style,
    ).toBe('Regular');
    expect(
      r.resolve({ families: ['Inter'], weight: 700, italic: true, arabic: false }).font.style,
    ).toBe('Bold Italic');
  });

  it('unknown family → Inter, reported as substituted', () => {
    expect(
      r.resolve({ families: ['Brand Sans'], weight: 400, italic: false, arabic: false }),
    ).toMatchObject({
      font: { family: 'Inter', style: 'Regular' },
      requested: 'Brand Sans',
      substituted: true,
    });
  });

  it('Arabic text never gets a Latin-only family; preferred defaults only for lang=ar (PLG-F-6)', () => {
    expect(
      r.resolve({ families: ['Inter', 'Cairo'], weight: 600, italic: false, arabic: true }),
    ).toMatchObject({ font: { family: 'Cairo', style: 'SemiBold' }, arabicRule: true });
    expect(
      r.resolve({ families: ['Inter', 'sans-serif'], weight: 400, italic: false, arabic: true })
        .font.family,
    ).toBe('Noto Sans Arabic');
    const ar = new FontResolver(MOCK_FONTS, 'ar');
    expect(
      ar.resolve({ families: ['Inter', 'sans-serif'], weight: 400, italic: false, arabic: true })
        .font.family,
    ).toBe('Tajawal');
  });
});

describe('buildPlan (PLG-R-*)', () => {
  const plan = buildPlan(kitchenSink(), MOCK_FONTS);
  const card = plan.root.children[0] as PlanBox;
  const t = card.children[0] as PlanText;

  it('parent-relative coordinates and frame vs rect kinds', () => {
    expect([card.x, card.y, card.width, card.height]).toEqual([10, 20, 300, 200]);
    expect([t.x, t.y]).toEqual([10, 10]);
    expect(card.kind).toBe('frame');
    const leaf = buildPlan(
      {
        ...minimal(),
        root: {
          ...minimal().root,
          children: [{ ...minimal().root, id: 'x', children: [], clipsContent: false }],
        },
      },
      MOCK_FONTS,
    );
    expect(leaf.root.children[0]!.kind).toBe('rect');
  });

  it('fills keep solids, gradients and image paints bottom → top; non-solid ones are unsupported in the plugin', () => {
    expect(card.fills.map((f) => f.type)).toEqual([
      'SOLID',
      'GRADIENT_LINEAR',
      'GRADIENT_RADIAL',
      'IMAGE',
    ]);
    expect(card.fills[0]).toEqual({
      type: 'SOLID',
      color: { r: 0.1, g: 0.2, b: 0.3 },
      opacity: 0.4,
    });
    expect(card.fills[3]).toEqual({ type: 'IMAGE', assetId: 'a1' });
    expect(plan.unsupported).toEqual(
      expect.arrayContaining(['GRADIENT_LINEAR paint', 'GRADIENT_RADIAL paint', 'IMAGE paint']),
    );
  });

  it('strokes use the widest side color with per-side weights; dash pattern from its style', () => {
    expect(card.strokes).toMatchObject({ top: 1, right: 2, bottom: 0, left: 1.5, dash: [6, 6] });
  });

  it('text: font, sizing mode, anchor, enums; fonts deduplicated', () => {
    expect(t).toMatchObject({
      font: { family: 'Tajawal', style: 'Bold' },
      autoResize: 'WIDTH_AND_HEIGHT',
      anchor: 'right',
      align: 'RIGHT',
      decoration: 'UNDERLINE',
      textCase: 'ORIGINAL',
      lineHeight: { unit: 'AUTO' },
    });
    expect(plan.fonts).toEqual([{ family: 'Tajawal', style: 'Bold' }]);
    expect(plan.counts).toEqual({ boxes: 2, texts: 1, placeholders: 3, total: 6 });
  });
});

describe('withDirectionMark (PLG-RTL-2, provisional, unverified in Figma)', () => {
  it('adds RLM to Latin-first RTL paragraphs and LRM to Arabic-first LTR ones, otherwise unchanged', () => {
    expect(withDirectionMark('Figma يدعم العربية', 'rtl')).toBe('\u200FFigma يدعم العربية');
    expect(withDirectionMark('2026 عام', 'rtl')).toBe('2026 عام');
    expect(withDirectionMark('مرحبا Arkan', 'ltr')).toBe('\u200Eمرحبا Arkan');
    expect(withDirectionMark('Hello', 'ltr')).toBe('Hello');
  });
});
