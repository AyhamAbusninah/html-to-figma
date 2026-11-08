import { SCHEMA_VERSION, type CaptureDocument, type RGBA } from '@h2f/schema';
import { isTransparent, parseCssColor } from './color.ts';
import type { RawPageSnapshot } from './raw-snapshot.ts';

const WHITE: RGBA = { r: 1, g: 1, b: 1, a: 1 };

/** Removes the fragment from a URL (meta.sourceUrl keeps the query string, REQUIREMENTS §2.2). */
export function stripFragment(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * The page background: the first non-transparent of <html>/<body> background colors, made opaque. Falls back to
 * white, which is what a browser paints behind a transparent page.
 */
export function resolvePageBackground(backgroundColors: readonly string[]): RGBA {
  for (const css of backgroundColors) {
    const color = parseCssColor(css);
    if (!isTransparent(color)) return { ...color!, a: 1 };
  }
  return WHITE;
}

export interface BuildOptions {
  extractorVersion: string;
  /** ISO 8601 timestamp. Injected so output is deterministic for a given snapshot (NFR-2). */
  capturedAt: string;
}

/**
 * Builds a CaptureDocument from a page snapshot.
 *
 * R0 scope (walking skeleton): page metadata and a root FRAME sized to the scrollable document with the page
 * background. No child nodes yet: DOM traversal arrives in R2. `meta.stats.bytes` is 0 here, and the caller fills
 * it after serialization.
 */
export function buildCaptureDocument(raw: RawPageSnapshot, options: BuildOptions): CaptureDocument {
  const width = Math.max(raw.scroll.width, raw.viewport.width);
  const height = Math.max(raw.scroll.height, raw.viewport.height);
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      sourceUrl: stripFragment(raw.url),
      title: raw.title,
      capturedAt: options.capturedAt,
      captureMode: 'page',
      lang: raw.lang ?? '',
      direction: raw.computedDirection === 'rtl' ? 'rtl' : 'ltr',
      viewport: { width: raw.viewport.width, height: raw.viewport.height },
      document: { width, height },
      devicePixelRatio: raw.devicePixelRatio || 1,
      extractorVersion: options.extractorVersion,
      userAgent: raw.userAgent,
      stats: { nodeCount: 1, textCount: 0, imageCount: 0, svgCount: 0, bytes: 0 },
      warnings: [],
    },
    assets: { images: {} },
    root: {
      id: 'n0',
      name: raw.title || 'page',
      type: 'FRAME',
      rect: { x: 0, y: 0, width, height },
      opacity: 1,
      fills: [{ type: 'SOLID', color: resolvePageBackground(raw.backgroundColors) }],
      clipsContent: true,
      children: [],
    },
  };
}
