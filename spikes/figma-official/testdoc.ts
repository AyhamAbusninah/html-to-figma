/**
 * Spike test document (shared by Route B `spikes/figma-official` and Route A `spikes/figma-clipboard`):
 * one frame, one rectangle, one text node, in three text variants.
 * Explicit line-height (32 px) keeps text-box heights independent of font "normal" metrics.
 */
import type { CaptureDocument, TextNode } from '../../packages/schema/src/schema.ts';

export type Variant = 'v1' | 'v2' | 'v3';

const BLACK = { r: 0.0667, g: 0.0667, b: 0.0667, a: 1 }; // #111111
const TEXTS: Record<Variant, { label: string; node: Omit<TextNode, 'id' | 'type' | 'opacity'> }> = {
  v1: {
    label: 'V1 Latin',
    node: {
      name: 'Text Latin',
      rect: { x: 20, y: 140, width: 130, height: 32 },
      characters: 'Hello world',
      lineCount: 1,
      style: {
        fontFamilies: ['Inter', 'sans-serif'],
        fontWeight: 400,
        fontStyle: 'normal',
        fontSize: 24,
        lineHeight: 32,
        letterSpacing: 0,
        color: BLACK,
        direction: 'ltr',
        textAlign: 'left',
        textDecoration: 'none',
        textCase: 'none',
      },
    },
  },
  v2: {
    label: 'V2 Arabic',
    node: {
      name: 'Text Arabic',
      rect: { x: 230, y: 140, width: 150, height: 32 },
      characters: 'مرحبا بالعالم',
      lineCount: 1,
      style: {
        fontFamilies: ['Noto Sans Arabic', 'sans-serif'],
        fontWeight: 400,
        fontStyle: 'normal',
        fontSize: 24,
        lineHeight: 32,
        letterSpacing: 0,
        color: BLACK,
        direction: 'rtl',
        textAlign: 'right',
        textDecoration: 'none',
        textCase: 'none',
      },
    },
  },
  v3: {
    label: 'V3 Mixed bidi',
    node: {
      name: 'Text Mixed',
      rect: { x: 210, y: 140, width: 170, height: 32 },
      characters: 'Arkan تقنية 2026',
      lineCount: 1,
      style: {
        fontFamilies: ['Noto Sans Arabic', 'sans-serif'],
        fontWeight: 400,
        fontStyle: 'normal',
        fontSize: 24,
        lineHeight: 32,
        letterSpacing: 0,
        color: BLACK,
        direction: 'rtl',
        textAlign: 'right',
        textDecoration: 'none',
        textCase: 'none',
      },
    },
  },
};

export const VARIANTS: Variant[] = ['v1', 'v2', 'v3'];

export function testDoc(v: Variant): CaptureDocument {
  const t = TEXTS[v];
  const rtl = v !== 'v1';
  return {
    schemaVersion: '1.0.0',
    meta: {
      sourceUrl: `http://localhost/h2f-spike/${v}.html`,
      title: `H2F PoC ${t.label}`,
      capturedAt: '2026-11-09T12:00:00.000Z',
      captureMode: 'page',
      lang: rtl ? 'ar' : 'en',
      direction: rtl ? 'rtl' : 'ltr',
      viewport: { width: 400, height: 300 },
      document: { width: 400, height: 300 },
      devicePixelRatio: 1,
      extractorVersion: 'spike',
      userAgent: 'spike',
      stats: { nodeCount: 3, textCount: 1, imageCount: 0, svgCount: 0, bytes: 0 },
      warnings: [],
    },
    assets: { images: {} },
    root: {
      id: 'n0',
      name: `H2F PoC ${t.label}`,
      type: 'FRAME',
      rect: { x: 0, y: 0, width: 400, height: 300 },
      opacity: 1,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      clipsContent: true,
      children: [
        {
          id: 'n1',
          name: 'Rectangle',
          type: 'FRAME',
          rect: { x: 20, y: 20, width: 120, height: 80 },
          opacity: 1,
          fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 1, a: 1 } }], // #3366FF
          radii: { tl: 8, tr: 8, br: 8, bl: 8 },
          clipsContent: false,
          children: [],
        },
        { id: 'n2', type: 'TEXT', opacity: 1, ...t.node },
      ],
    },
  };
}
