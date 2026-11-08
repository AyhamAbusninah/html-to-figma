/** Verification level: UNIT (Node). The browser-side collector is covered by e2e/extension.spec.ts. */
import { validateCapture } from '@h2f/schema';
import { describe, expect, it } from 'vitest';
import {
  buildCaptureDocument,
  resolvePageBackground,
  stripFragment,
  type RawPageSnapshot,
} from '../src/index.ts';

const snapshot = (over: Partial<RawPageSnapshot> = {}): RawPageSnapshot => ({
  url: 'http://localhost:4173/pages/boxes.html?x=1#section',
  title: 'Boxes',
  lang: 'en',
  computedDirection: 'ltr',
  viewport: { width: 1280, height: 800 },
  scroll: { width: 1280, height: 2400 },
  devicePixelRatio: 2,
  userAgent: 'UA',
  backgroundColors: ['rgba(0, 0, 0, 0)', 'rgb(250, 250, 250)'],
  ...over,
});

const options = { extractorVersion: '0.1.0', capturedAt: '2026-11-08T12:00:00.000Z' };

describe('buildCaptureDocument', () => {
  it('produces a schema-valid v1.0.0 document', () => {
    const r = validateCapture(buildCaptureDocument(snapshot(), options));
    expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
  });

  it('maps snapshot fields into meta and a root frame (walking-skeleton scope)', () => {
    const doc = buildCaptureDocument(snapshot(), options);
    expect(doc.meta).toEqual({
      sourceUrl: 'http://localhost:4173/pages/boxes.html?x=1',
      title: 'Boxes',
      capturedAt: options.capturedAt,
      captureMode: 'page',
      lang: 'en',
      direction: 'ltr',
      viewport: { width: 1280, height: 800 },
      document: { width: 1280, height: 2400 },
      devicePixelRatio: 2,
      extractorVersion: '0.1.0',
      userAgent: 'UA',
      stats: { nodeCount: 1, textCount: 0, imageCount: 0, svgCount: 0, bytes: 0 },
      warnings: [],
    });
    expect(doc.root).toEqual({
      id: 'n0',
      name: 'Boxes',
      type: 'FRAME',
      rect: { x: 0, y: 0, width: 1280, height: 2400 },
      opacity: 1,
      fills: [{ type: 'SOLID', color: { r: 0.9804, g: 0.9804, b: 0.9804, a: 1 } }],
      clipsContent: true,
      children: [],
    });
  });

  it('document size is at least the viewport', () => {
    const doc = buildCaptureDocument(snapshot({ scroll: { width: 900, height: 300 } }), options);
    expect(doc.meta.document).toEqual({ width: 1280, height: 800 });
    expect(doc.root.rect).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
  });

  it('RTL pages: direction from the computed style; anything else is ltr', () => {
    expect(
      buildCaptureDocument(snapshot({ computedDirection: 'rtl', lang: 'ar' }), options).meta,
    ).toMatchObject({
      direction: 'rtl',
      lang: 'ar',
    });
    expect(buildCaptureDocument(snapshot({ computedDirection: '' }), options).meta.direction).toBe(
      'ltr',
    );
  });

  it('falls back: empty title → "page" layer name; devicePixelRatio 0 → 1', () => {
    const doc = buildCaptureDocument(snapshot({ title: '', devicePixelRatio: 0 }), options);
    expect(doc.root.name).toBe('page');
    expect(doc.meta.devicePixelRatio).toBe(1);
  });

  it('is deterministic for a given snapshot and options (NFR-2)', () => {
    expect(buildCaptureDocument(snapshot(), options)).toEqual(
      buildCaptureDocument(snapshot(), options),
    );
  });
});

describe('resolvePageBackground', () => {
  it('uses <html> first, then <body>, made opaque', () => {
    expect(resolvePageBackground(['rgba(255, 0, 0, 0.5)', 'rgb(0, 0, 255)'])).toEqual({
      r: 1,
      g: 0,
      b: 0,
      a: 1,
    });
    expect(resolvePageBackground(['rgba(0, 0, 0, 0)', 'rgb(0, 0, 255)'])).toEqual({
      r: 0,
      g: 0,
      b: 1,
      a: 1,
    });
  });

  it('falls back to white when both are transparent or unparseable', () => {
    expect(resolvePageBackground(['rgba(0, 0, 0, 0)', 'oklch(1 0 0 / 0)'])).toEqual({
      r: 1,
      g: 1,
      b: 1,
      a: 1,
    });
    expect(resolvePageBackground([])).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });
});

describe('stripFragment', () => {
  it('removes only the fragment', () => {
    expect(stripFragment('https://a.example/p?q=1#h')).toBe('https://a.example/p?q=1');
    expect(stripFragment('not a url')).toBe('not a url');
  });
});
