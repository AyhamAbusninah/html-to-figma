/**
 * RawPageSnapshot: what the extension's collector reads from the live page, as plain serializable data.
 * Internal and unversioned. It is NOT a cross-component contract (CaptureDocument is the only one).
 * Values are copied verbatim from browser APIs (computed-style strings stay strings) so all parsing and
 * normalization happens in the engine, where it is unit-testable without a browser.
 */

/** Computed-style properties the collector copies for every element (single source of truth). */
export const RAW_STYLE_KEYS = [
  'display',
  'visibility',
  'opacity',
  'position',
  'z-index',
  'overflow-x',
  'overflow-y',
  'background-color',
  'background-image',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'box-shadow',
  'mix-blend-mode',
  'transform',
  'filter',
  'clip-path',
  'clip',
  'object-fit',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'color',
  'text-align',
  'direction',
  'white-space',
  'text-transform',
  'text-decoration-line',
  'text-overflow',
] as const;

export type RawStyleKey = (typeof RAW_STYLE_KEYS)[number];
export type RawStyle = Record<RawStyleKey, string>;

/** Viewport coordinates, as returned by getBoundingClientRect / Range.getClientRects. */
export interface RawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ReplacedKind = 'img' | 'svg' | 'canvas' | 'video' | 'iframe' | 'object' | 'embed';

export interface RawControl {
  /** text: text-like <input>/<button value>; textarea; select; other: checkbox, radio, range, color, file… */
  kind: 'text' | 'textarea' | 'select' | 'other';
  /** `type` attribute for inputs. */
  inputType: string;
  /** Displayed text. Password values are already masked by the collector (EXT-X-7). */
  text: string;
  isPlaceholder: boolean;
  /** Computed ::placeholder color when the placeholder is shown. */
  placeholderColor: string;
}

export interface RawElement {
  kind: 'element';
  /** Lower-case tag name. */
  tag: string;
  /** `id` attribute and class list, used ONLY for layer names (never for logic, SYS-5). */
  idAttr: string;
  classes: string[];
  rect: RawRect;
  style: RawStyle;
  children: RawNode[];
  replaced?: { kind: ReplacedKind };
  control?: RawControl;
  /** Visible ::before / ::after with content (not captured yet, reported explicitly). */
  pseudo?: { before: boolean; after: boolean };
  /** Set when text-overflow is ellipsis and the content overflows horizontally (truncation not reproduced yet). */
  ellipsisTruncated?: boolean;
  /**
   * Replaced content resolved by the collector's asset phase: `assetId` of the encoded pixels in
   * RawPageSnapshot.assets, or `svg` = self-contained, sanitized markup (inline <svg>, or <img src=*.svg>).
   * `assetFailed` = pixels were looked for but every tier failed (warning IMAGE_FETCH_FAILED).
   */
  assetId?: string;
  svg?: string;
  assetFailed?: boolean;
}

/** Encoded image from the collector (CaptureDocument ImageAsset shape). */
export interface RawImageAsset {
  mime: 'image/png' | 'image/jpeg' | 'image/gif';
  /** Base64 without the data: prefix. */
  data: string;
  width: number;
  height: number;
  source: 'canvas' | 'fetch' | 'screenshot';
  originalUrl?: string;
}

export interface RawText {
  kind: 'text';
  /** Raw `nodeValue`. Whitespace normalization happens in the engine. */
  text: string;
  /** Client rects of the visible (trimmed) text range. Empty means not rendered. */
  rects: RawRect[];
  /**
   * Set only when the text wraps onto more than one line box: each line's UTF-16 range [start, end) in `text`
   * (whitespace at the wrap trimmed) and that range's client rects, in logical order. The engine uses it to keep
   * a text node that starts or ends mid-line from being drawn as one block over its inline neighbors (OQ-11).
   */
  lines?: RawTextLine[];
}

export interface RawTextLine {
  start: number;
  end: number;
  rects: RawRect[];
}

export type RawNode = RawElement | RawText;

export interface RawPageSnapshot {
  /** `location.href` */
  url: string;
  /** `document.title` */
  title: string;
  /** `<html lang>` (empty string when absent) */
  lang: string;
  /** `getComputedStyle(documentElement).direction` */
  computedDirection: string;
  /** `innerWidth` / `innerHeight` */
  viewport: { width: number; height: number };
  /** `scrollingElement.scrollWidth` / `.scrollHeight` */
  scroll: { width: number; height: number };
  /** `devicePixelRatio` (0 / missing is normalized to 1) */
  devicePixelRatio: number;
  /** `navigator.userAgent` */
  userAgent: string;
  /** Computed `background-color` of `<html>` then `<body>`, in that order (body may be absent → omitted). */
  backgroundColors: string[];
  /** `scrollX` / `scrollY` at capture time (Chrome reports scrollX ≤ 0 in RTL documents). */
  scrollOffset?: { x: number; y: number };
  /** `scrollingElement.clientWidth` (for RTL horizontal-overflow normalization, EXT-RTL-4). */
  clientWidth?: number;
  /** The rendered tree, rooted at <html>. Absent → metadata-only document (R0 skeleton behavior). */
  tree?: RawElement;
  /** Encoded images referenced by RawElement.assetId, keyed by content hash (EXT-I-9). */
  assets?: Record<string, RawImageAsset>;
}
