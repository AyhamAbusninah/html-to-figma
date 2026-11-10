import {
  backgroundUrls,
  lineTops,
  RAW_STYLE_KEYS,
  type RawControl,
  type RawElement,
  type RawNode,
  type RawPageSnapshot,
  type RawRect,
  type RawStyle,
  type RawText,
  type RawTextLine,
  type ReplacedKind,
} from '@h2f/core';

/**
 * Collector: reads the live page into a RawPageSnapshot. Only browser reads happen here. Every interpretation of
 * those values lives in @h2f/core (plan §3). Read-only: the page DOM is never modified (AC-EXT-8).
 */

/** Elements that never render (EXT-T-2). */
const NON_RENDERED = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'head',
  'meta',
  'link',
  'title',
  'base',
]);
const REPLACED: Record<string, ReplacedKind> = {
  img: 'img',
  svg: 'svg',
  canvas: 'canvas',
  video: 'video',
  iframe: 'iframe',
  object: 'object',
  embed: 'embed',
};
/** <input> types whose value is shown as text. Everything else is approximated (checkbox, radio, range…). */
const TEXT_INPUTS = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'number',
  'password',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'submit',
  'button',
  'reset',
]);

import type { AssetJob } from './assets.ts';

/** Replaced elements whose content the asset phase resolves (set per collectPageSnapshot call). */
let jobs: AssetJob[] = [];

const rectOf = (r: DOMRect): RawRect => ({ x: r.x, y: r.y, width: r.width, height: r.height });

function pickStyle(cs: CSSStyleDeclaration): RawStyle {
  const out = {} as RawStyle;
  for (const key of RAW_STYLE_KEYS) out[key] = cs.getPropertyValue(key);
  return out;
}

function hasVisiblePseudo(el: Element, which: '::before' | '::after'): boolean {
  const ps = getComputedStyle(el, which);
  const content = ps.content;
  return content !== 'none' && content !== 'normal' && ps.display !== 'none';
}

/**
 * Author shadow root of an element (EXT-T-1). Open roots for any element. Closed roots only for custom elements
 * (tag contains "-"): chrome.dom.openOrClosedShadowRoot also returns the browser's own user-agent roots of built-in
 * controls (e.g. <input>'s inner editor), and touching those mutated the page (found by AC-EXT-8).
 */
function shadowRootOf(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  if (!el.tagName.includes('-')) return null;
  const dom = (
    globalThis as unknown as {
      chrome?: { dom?: { openOrClosedShadowRoot?: (e: Element) => ShadowRoot | null } };
    }
  ).chrome?.dom;
  try {
    return dom?.openOrClosedShadowRoot?.(el as HTMLElement) ?? null;
  } catch {
    return null;
  }
}

/** Child nodes in flat-tree (rendered) order. */
function flatChildren(el: Element): Node[] {
  if (el.tagName.toLowerCase() === 'slot') {
    const assigned = (el as HTMLSlotElement).assignedNodes({ flatten: true });
    return assigned.length ? assigned : Array.from(el.childNodes);
  }
  const root = shadowRootOf(el);
  return Array.from((root ?? el).childNodes);
}

function readControl(el: Element, tag: string): RawControl | undefined {
  if (tag === 'textarea') {
    const t = el as HTMLTextAreaElement;
    return control('textarea', '', t.value, t.placeholder, el);
  }
  if (tag === 'select') {
    const s = el as HTMLSelectElement;
    return control('select', '', s.selectedOptions[0]?.text ?? '', '', el);
  }
  if (tag === 'input') {
    const i = el as HTMLInputElement;
    const type = (i.type || 'text').toLowerCase();
    if (!TEXT_INPUTS.has(type))
      return {
        kind: 'other',
        inputType: type,
        text: '',
        isPlaceholder: false,
        placeholderColor: '',
      };
    // Password values are masked HERE, so the raw value never leaves this function (EXT-X-7).
    const value = type === 'password' ? '•'.repeat([...i.value].length) : i.value;
    return control('text', type, value, i.placeholder, el);
  }
  return undefined;
}

function control(
  kind: RawControl['kind'],
  inputType: string,
  value: string,
  placeholder: string,
  el: Element,
): RawControl {
  const isPlaceholder = !value && Boolean(placeholder);
  return {
    kind,
    inputType,
    text: isPlaceholder ? placeholder : value,
    isPlaceholder,
    placeholderColor: isPlaceholder ? getComputedStyle(el, '::placeholder').color : '',
  };
}

function collectText(node: Text, whiteSpace: string): RawText | null {
  const text = node.nodeValue ?? '';
  const collapses = whiteSpace === 'normal' || whiteSpace === 'nowrap' || whiteSpace === 'pre-line';
  let start = 0;
  let end = text.length;
  if (collapses) {
    while (start < end && /\s/.test(text[start]!)) start++;
    while (end > start && /\s/.test(text[end - 1]!)) end--;
    if (start === end) return null; // whitespace-only between blocks
  }
  if (end === 0) return null;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.width > 0 && r.height > 0)
    .map(rectOf);
  const raw: RawText = { kind: 'text', text, rects };
  const lines = collectLines(node, text, start, end, rects, collapses);
  if (lines) raw.lines = lines;
  return raw;
}

const isLowSurrogate = (s: string, i: number) => {
  const c = s.charCodeAt(i);
  return c >= 0xdc00 && c <= 0xdfff;
};

/**
 * Character range of each line box of a wrapped text node (OQ-11), found by binary search on per-character rects:
 * line breaking follows logical order, so a character's line index never decreases with its offset. Costs about
 * log2(length) rect reads per line. Returns undefined for single-line text or when the measurement is inconsistent.
 */
function collectLines(
  node: Text,
  text: string,
  start: number,
  end: number,
  rects: RawRect[],
  collapses: boolean,
): RawTextLine[] | undefined {
  const tops = lineTops(rects);
  if (tops.length < 2) return undefined;
  const range = document.createRange();
  // Top of the first character at or after i that has a box (collapsed spaces have none).
  const topAt = (i: number): number => {
    for (let j = i; j < end; j++) {
      range.setStart(node, j);
      range.setEnd(node, j + 1);
      const r = Array.from(range.getClientRects()).find((c) => c.height > 0);
      if (r) return r.y;
    }
    return Infinity;
  };
  const bounds = [start];
  for (let k = 0; k + 1 < tops.length; k++) {
    const threshold = (tops[k]! + tops[k + 1]!) / 2;
    let lo = bounds[bounds.length - 1]!;
    let hi = end;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (topAt(mid) > threshold) hi = mid;
      else lo = mid + 1;
    }
    if (lo > start && isLowSurrogate(text, lo)) lo--;
    if (lo <= bounds[bounds.length - 1]! || lo >= end) return undefined;
    bounds.push(lo);
  }
  bounds.push(end);
  const lines: RawTextLine[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    let s = bounds[k]!;
    let e = bounds[k + 1]!;
    if (collapses) {
      // The space at a soft wrap hangs past the line end; it is not part of the visible line.
      while (s < e && /\s/.test(text[s]!)) s++;
      while (e > s && /\s/.test(text[e - 1]!)) e--;
    }
    if (s === e) return undefined;
    range.setStart(node, s);
    range.setEnd(node, e);
    const lineRects = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map(rectOf);
    if (!lineRects.length) return undefined;
    lines.push({ start: s, end: e, rects: lineRects });
  }
  return lines;
}

function collectElement(el: Element): RawElement | null {
  const tag = el.tagName.toLowerCase();
  if (NON_RENDERED.has(tag)) return null;
  if (tag === 'input' && (el as HTMLInputElement).type === 'hidden') return null;
  const cs = getComputedStyle(el);
  if (cs.display === 'none') return null;

  const raw: RawElement = {
    kind: 'element',
    tag,
    idAttr: el.id || '',
    classes: Array.from(el.classList),
    rect: rectOf(el.getBoundingClientRect()),
    style: pickStyle(cs),
    children: [],
  };
  const replaced = REPLACED[tag];
  if (replaced) {
    raw.replaced = { kind: replaced };
    if (cs.visibility === 'visible') {
      if (replaced === 'svg') jobs.push({ kind: 'svg', raw, el: el as SVGSVGElement });
      else if (replaced === 'img') jobs.push({ kind: 'img', raw, el: el as HTMLImageElement });
      else if (replaced === 'canvas')
        jobs.push({ kind: 'canvas', raw, el: el as HTMLCanvasElement });
      else if (replaced === 'video') jobs.push({ kind: 'video', raw, el: el as HTMLVideoElement });
      else jobs.push({ kind: 'frame', raw, el: el as HTMLElement }); // iframe, object, embed: Tier 3
    }
    return raw; // content not traversed (svg internals, iframe document…)
  }
  // CSS background images: composited in the asset phase (EXT-I-8). Page backgrounds (html/body) excluded.
  if (
    cs.visibility === 'visible' &&
    tag !== 'html' &&
    tag !== 'body' &&
    cs.backgroundImage.includes('url(')
  ) {
    // background-clip:text paints through the glyphs: no background image layer (engine approximates the color).
    const layers = backgroundUrls(cs.backgroundImage);
    if (
      layers.length &&
      raw.rect.width > 0 &&
      raw.rect.height > 0 &&
      !/\btext\b/.test(cs.backgroundClip)
    )
      jobs.push({ kind: 'bg', raw, el, layers });
  }
  const ctrl = readControl(el, tag);
  if (ctrl) raw.control = ctrl;
  const before = hasVisiblePseudo(el, '::before');
  const after = hasVisiblePseudo(el, '::after');
  if (before || after) raw.pseudo = { before, after };
  if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth)
    raw.ellipsisTruncated = true;

  // Form controls render their value, not their DOM children (<option>, textarea default text); <input> is void.
  if (tag === 'select' || tag === 'textarea' || tag === 'input') return raw;
  const children: RawNode[] = [];
  for (const child of flatChildren(el)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const c = collectElement(child as Element);
      if (c) children.push(c);
    } else if (child.nodeType === Node.TEXT_NODE) {
      const t = collectText(child as Text, cs.whiteSpace);
      if (t) children.push(t);
    }
  }
  raw.children = children;
  return raw;
}

/** The DOM read plus the replaced elements whose pixels/markup the asset phase resolves (see assets.ts). */
export function collectPage(win: Window): { snapshot: RawPageSnapshot; jobs: AssetJob[] } {
  jobs = [];
  const snapshot = collectPageSnapshot(win);
  const out = jobs;
  jobs = [];
  return { snapshot, jobs: out };
}

export function collectPageSnapshot(win: Window): RawPageSnapshot {
  const doc = win.document;
  const scroller = doc.scrollingElement ?? doc.documentElement;
  const backgroundColors = [doc.documentElement, doc.body]
    .filter((el): el is HTMLElement => Boolean(el))
    .map((el) => win.getComputedStyle(el).backgroundColor);
  return {
    url: win.location.href,
    title: doc.title,
    lang: doc.documentElement.lang ?? '',
    computedDirection: win.getComputedStyle(doc.documentElement).direction,
    viewport: { width: win.innerWidth, height: win.innerHeight },
    scroll: { width: scroller.scrollWidth, height: scroller.scrollHeight },
    devicePixelRatio: win.devicePixelRatio,
    userAgent: win.navigator.userAgent,
    backgroundColors,
    scrollOffset: { x: win.scrollX, y: win.scrollY },
    clientWidth: scroller.clientWidth,
    tree: collectElement(doc.documentElement) ?? undefined,
  };
}
