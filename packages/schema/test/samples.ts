/**
 * CaptureDocument samples for contract and compatibility tests. `kitchenSink()` exercises every node type, paint,
 * effect, and optional field in schema v1.0.0. Returned fresh each call, so tests may mutate them.
 */
import type { CaptureDocument } from '../src/schema.ts';

const black = { r: 0, g: 0, b: 0, a: 1 };
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

export function minimal(): CaptureDocument {
  return {
    schemaVersion: '1.0.0',
    meta: {
      sourceUrl: 'http://localhost:4173/pages/boxes.html',
      title: 'Boxes',
      capturedAt: '2026-11-08T12:00:00.000Z',
      captureMode: 'page',
      lang: 'en',
      direction: 'ltr',
      viewport: { width: 1280, height: 800 },
      document: { width: 1280, height: 2000 },
      devicePixelRatio: 1,
      extractorVersion: '0.1.0',
      userAgent: 'test',
      stats: { nodeCount: 1, textCount: 0, imageCount: 0, svgCount: 0, bytes: 0 },
      warnings: [],
    },
    assets: { images: {} },
    root: {
      id: 'n0',
      name: 'Boxes',
      type: 'FRAME',
      rect: rect(0, 0, 1280, 2000),
      opacity: 1,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      clipsContent: true,
      children: [],
    },
  };
}

export function kitchenSink(): CaptureDocument {
  const doc = minimal();
  doc.meta.direction = 'rtl';
  doc.meta.lang = 'ar';
  doc.meta.captureMode = 'element';
  doc.meta.devicePixelRatio = 2;
  doc.meta.stats = { nodeCount: 6, textCount: 1, imageCount: 1, svgCount: 1, bytes: 1234 };
  doc.meta.warnings = [
    { code: 'IMAGE_FETCH_FAILED', message: 'x', nodeId: 'n4', detail: 'https://cdn.example/x.png' },
    { code: 'SOME_FUTURE_CODE', message: 'unknown codes are allowed' },
  ];
  doc.assets.images = {
    a1: { mime: 'image/png', data: 'iVBORw0KGgo=', width: 1, height: 1, source: 'canvas' },
    a2: {
      mime: 'image/jpeg',
      data: '/9j/',
      width: 4096,
      height: 10,
      source: 'fetch',
      originalUrl: 'https://x/y.jpg',
    },
    a3: { mime: 'image/gif', data: 'R0lGOD==', width: 2, height: 2, source: 'screenshot' },
  };
  doc.root.children = [
    {
      id: 'n1',
      name: 'div.card',
      domPath: 'body > div.card',
      type: 'FRAME',
      rect: rect(10, 20, 300, 200),
      opacity: 0.5,
      blendMode: 'MULTIPLY',
      fills: [
        { type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3, a: 0.4 } },
        {
          type: 'GRADIENT_LINEAR',
          angleDeg: 90,
          stops: [
            { position: 0, color: black },
            { position: 1, color: black },
          ],
        },
        {
          type: 'GRADIENT_RADIAL',
          center: { x: 0.5, y: 1.2 },
          radius: { x: 0.5, y: 0.25 },
          stops: [
            { position: 0, color: black },
            { position: 1, color: { r: 1, g: 1, b: 1, a: 0 } },
          ],
        },
        { type: 'IMAGE', assetId: 'a1', scaleMode: 'FILL' },
      ],
      strokes: {
        top: { width: 1, color: black, style: 'solid' },
        right: { width: 2, color: black, style: 'dashed' },
        bottom: { width: 0, color: black, style: 'dotted' },
        left: { width: 1.5, color: black, style: 'solid' },
      },
      radii: { tl: 8, tr: 8, br: 0, bl: 100 },
      effects: [
        { type: 'DROP_SHADOW', color: black, offset: { x: 0, y: 4 }, radius: 12, spread: -2 },
        { type: 'INNER_SHADOW', color: black, offset: { x: 1, y: 1 }, radius: 0, spread: 0 },
        { type: 'LAYER_BLUR', radius: 4 },
        { type: 'BACKGROUND_BLUR', radius: 10 },
      ],
      clipsContent: false,
      children: [
        {
          id: 'n2',
          name: 'فاتورة INV-2026-00042',
          type: 'TEXT',
          rect: rect(20, 30, 200, 48),
          opacity: 1,
          characters: 'فاتورة INV-2026-00042',
          lineCount: 1,
          style: {
            fontFamilies: ['Tajawal', 'Noto Sans Arabic', 'sans-serif'],
            fontWeight: 700,
            fontStyle: 'italic',
            fontSize: 28,
            lineHeight: 'normal',
            letterSpacing: 0,
            color: black,
            direction: 'rtl',
            textAlign: 'right',
            textDecoration: 'underline',
            textCase: 'none',
          },
        },
      ],
    },
    {
      id: 'n3',
      name: 'img.logo',
      type: 'IMAGE',
      rect: rect(0, 0, 64, 64),
      opacity: 1,
      assetId: 'a2',
      scaleMode: 'FIT',
      radii: { tl: 32, tr: 32, br: 32, bl: 32 },
    },
    {
      id: 'n4',
      name: 'img.broken',
      type: 'IMAGE',
      rect: rect(0, 70, 64, 64),
      opacity: 1,
      assetId: null,
      scaleMode: 'STRETCH',
    },
    {
      id: 'n5',
      name: 'svg.icon',
      type: 'SVG',
      rect: rect(100, 0, 24, 24),
      opacity: 1,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>',
      fallbackAssetId: 'a3',
    },
  ];
  return doc;
}
