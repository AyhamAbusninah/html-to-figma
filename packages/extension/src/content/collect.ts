import {
  RAW_STYLE_KEYS,
  type RawControl,
  type RawElement,
  type RawNode,
  type RawPageSnapshot,
  type RawRect,
  type RawStyle,
  type RawText,
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
  return { kind: 'text', text, rects };
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
    return raw; // content not traversed (svg internals, iframe document…)
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
