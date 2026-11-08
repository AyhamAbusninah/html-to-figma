/**
 * RawPageSnapshot: what the extension's collector reads from the live page, as plain serializable data.
 * Internal and unversioned. It is NOT a cross-component contract (CaptureDocument is the only one).
 * Values are copied verbatim from browser APIs (computed-style strings stay strings) so all parsing and
 * normalization happens in the engine, where it is unit-testable without a browser.
 */
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
}
