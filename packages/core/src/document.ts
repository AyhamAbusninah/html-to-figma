import { SCHEMA_VERSION, type CaptureDocument, type RGBA } from '@h2f/schema';
import { isTransparent, parseCssColor } from './color.ts';
import { collectTextLines, collectWarnings, convertTree, createContext } from './convert.ts';
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
 * Root FRAME sized to the scrollable document with the page background; children converted from `raw.tree` when
 * present (without a tree: metadata-only document). `meta.stats.bytes` is 0 here; the caller fills it after
 * serialization. Throws CaptureTooLargeError above MAX_NODES (EXT-T-10).
 */
export function buildCaptureDocument(raw: RawPageSnapshot, options: BuildOptions): CaptureDocument {
  return buildCapture(raw, options).document;
}

/**
 * buildCaptureDocument plus `textLines`: the page's own line breaks of every multi-line TEXT node, by node id.
 * A side output for consumers that can't wrap text themselves (Copy to Figma, SVG); not part of the contract.
 */
export function buildCapture(
  raw: RawPageSnapshot,
  options: BuildOptions,
): { document: CaptureDocument; textLines: Record<string, string[]> } {
  const width = Math.max(raw.scroll.width, raw.viewport.width);
  const height = Math.max(raw.scroll.height, raw.viewport.height);
  const rtl = raw.computedDirection === 'rtl';
  // Viewport → document coordinates. In RTL documents Chrome reports scrollX <= 0 with 0 at the right edge, so the
  // left edge of the scrollable area is normalized to x = 0 (EXT-RTL-4).
  const offsetX =
    (raw.scrollOffset?.x ?? 0) +
    (rtl ? Math.max(0, raw.scroll.width - (raw.clientWidth ?? raw.scroll.width)) : 0);
  const ctx = createContext(offsetX, raw.scrollOffset?.y ?? 0);
  const children = raw.tree ? convertTree(raw.tree, ctx) : [];
  const document: CaptureDocument = {
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
      stats: {
        nodeCount: ctx.nodeCount,
        textCount: ctx.textCount,
        imageCount: ctx.imageCount,
        svgCount: ctx.svgCount,
        bytes: 0,
      },
      warnings: collectWarnings(ctx),
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
      children,
    },
  };
  return { document, textLines: collectTextLines(ctx) };
}
