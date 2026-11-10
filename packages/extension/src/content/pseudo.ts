/**
 * ::before / ::after materialization (EXT-T-11, OQ-7 decision B). Before the DOM read, every visible pseudo-element
 * is replaced, for the duration of the read only, by a real <span data-h2f-materialized> carrying the
 * pseudo-element's computed style and resolved content (string, counter(), attr(), quotes, url()), so the normal walk
 * captures its exact geometry, paint and text. The pseudo-element itself is hidden with an adopted style sheet keyed
 * on a data-h2f-pseudo attribute. cleanup() removes every span and attribute and restores the style sheets, so the
 * page DOM is identical afterwards (EXT-C-4, AC-EXT-8; asserted by the e2e tests).
 */
import { LIMITS } from '../config/constants.ts';

export const MATERIALIZED_ATTR = 'data-h2f-materialized';
const MARK_ATTR = 'data-h2f-pseudo';
const HIDE_RULES = `[${MARK_ATTR}~="before"]::before{content:none!important}[${MARK_ATTR}~="after"]::after{content:none!important}`;
const SKIP = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'head',
  'img',
  'input',
  'select',
  'textarea',
  'svg',
  'video',
  'canvas',
  'iframe',
  'object',
  'embed',
  'br',
  'hr',
]);
const URL_TIMEOUT_MS = 2000;

export interface Materialized {
  count: number;
  /** Visible pseudo-elements left as they are (limit reached, or on a shadow host). */
  skipped: number;
  cleanup(): void;
}

// ── content: resolving the computed value ───────────────────────────────────────────────────────────────────

type Counters = Map<string, number>;

/** "name int name int" (counter-reset / -increment / -set) → pairs; "none" → []. */
function counterPairs(value: string, dflt: number): [string, number][] {
  if (!value || value === 'none') return [];
  const t = value.trim().split(/\s+/);
  const out: [string, number][] = [];
  for (let i = 0; i < t.length; i++) {
    const n = Number(t[i + 1]);
    if (Number.isFinite(n) && t[i + 1] !== undefined) {
      out.push([t[i]!, n]);
      i++;
    } else out.push([t[i]!, dflt]);
  }
  return out;
}

function applyCounters(cs: CSSStyleDeclaration, counters: Counters): void {
  for (const [name, v] of counterPairs(cs.getPropertyValue('counter-reset'), 0))
    counters.set(name, v);
  for (const [name, v] of counterPairs(cs.getPropertyValue('counter-set'), 0))
    counters.set(name, v);
  for (const [name, v] of counterPairs(cs.getPropertyValue('counter-increment'), 1))
    counters.set(name, (counters.get(name) ?? 0) + v);
}

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];
function counterText(n: number, style: string): string {
  if (/roman/.test(style) && n > 0 && n < 4000) {
    let s = '';
    for (const [v, r] of ROMAN)
      while (n >= v) {
        s += r;
        n -= v;
      }
    return style.startsWith('upper') ? s.toUpperCase() : s;
  }
  if (/alpha|latin/.test(style) && n > 0) {
    let s = '';
    for (let k = n; k > 0; k = Math.floor((k - 1) / 26))
      s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
    return style.startsWith('upper') ? s.toUpperCase() : s;
  }
  if (style === 'arabic-indic')
    return String(n).replace(/\d/g, (d) => String.fromCharCode(0x660 + Number(d)));
  return String(n);
}

/** Computed `content` → { text, url }; null when it renders nothing. */
function resolveContent(
  content: string,
  host: Element,
  cs: CSSStyleDeclaration,
  counters: Counters,
  depth: { q: number },
): { text: string; url: string | null } | null {
  if (!content || content === 'none' || content === 'normal') return null;
  let text = '';
  let url: string | null = null;
  const quotes = cs.getPropertyValue('quotes');
  const pairs =
    quotes && quotes !== 'auto' && quotes !== 'none'
      ? [...quotes.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!)
      : ['“', '”', '‘', '’'];
  const re =
    /"((?:[^"\\]|\\.)*)"|counters?\(\s*([^,)\s]+)(?:\s*,\s*("[^"]*"|[^,)]+))?(?:\s*,\s*([^)]+))?\)|attr\(\s*([^)\s]+)[^)]*\)|url\(\s*(['"]?)(.*?)\6\s*\)|(no-)?(open|close)-quote/g;
  for (const m of content.matchAll(re)) {
    if (m[1] !== undefined) text += m[1].replace(/\\(.)/g, '$1');
    else if (m[2] !== undefined) {
      const isList = m[0].startsWith('counters(');
      const style = (isList ? m[4] : m[3])?.trim().replace(/"/g, '') ?? 'decimal';
      text += counterText(counters.get(m[2]) ?? 0, style);
    } else if (m[5] !== undefined) text += host.getAttribute(m[5]) ?? '';
    else if (m[7] !== undefined) url = m[7];
    else if (m[9]) {
      if (m[9] === 'open') {
        if (!m[8]) text += pairs[Math.min(depth.q, 1) * 2] ?? '';
        depth.q++;
      } else {
        depth.q = Math.max(0, depth.q - 1);
        if (!m[8]) text += pairs[Math.min(depth.q, 1) * 2 + 1] ?? '';
      }
    }
  }
  return { text, url };
}

/** Paints or takes space: some text, an image, a size, a background, a border or a shadow (a clearfix does not). */
function visibleBox(cs: CSSStyleDeclaration, c: { text: string; url: string | null }): boolean {
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  if (c.text.trim() || c.url) return true;
  const size = (parseFloat(cs.width) || 0) * (parseFloat(cs.height) || 0) > 0;
  const paint =
    !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(cs.backgroundColor) ||
    cs.backgroundImage !== 'none' ||
    ['Top', 'Right', 'Bottom', 'Left'].some(
      (s) => (parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) || 0) > 0,
    ) ||
    cs.boxShadow !== 'none';
  return size && paint;
}

// ── materialization ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Materializes the visible pseudo-elements of `root` (flat tree, `children` gives the rendered child elements).
 * Await it before the DOM read and call cleanup() right after (also on error).
 */
export async function materializePseudos(
  doc: Document,
  children: (el: Element) => Element[],
): Promise<Materialized> {
  const spans: HTMLElement[] = [];
  const marked: Element[] = [];
  const sheets = new Map<Document | ShadowRoot, CSSStyleSheet[]>();
  const pendingImages: Promise<unknown>[] = [];
  const counters: Counters = new Map();
  const quoteDepth = { q: 0 };
  let skipped = 0;

  const hideIn = (scope: Document | ShadowRoot) => {
    if (sheets.has(scope)) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(HIDE_RULES);
    sheets.set(scope, [...scope.adoptedStyleSheets]); // a copy: the live array is modified next
    scope.adoptedStyleSheets = [...scope.adoptedStyleSheets, sheet];
  };

  const make = (
    host: Element,
    which: 'before' | 'after',
    cs: CSSStyleDeclaration,
    c: { text: string; url: string | null },
  ) => {
    const span = doc.createElement('span');
    span.setAttribute(MATERIALIZED_ATTR, which);
    for (let i = 0; i < cs.length; i++) {
      const p = cs.item(i);
      if (p !== 'content') span.style.setProperty(p, cs.getPropertyValue(p));
    }
    if (c.text) span.textContent = c.text;
    if (c.url) {
      // content: url(x) puts the image inside the box as an inline replaced element at its natural size (it also
      // sets the line's baseline): reproduce exactly that with an <img>, decoded before the read.
      const img = doc.createElement('img');
      img.alt = '';
      img.src = new URL(c.url, doc.baseURI).href;
      span.insertBefore(img, span.firstChild);
      pendingImages.push(
        Promise.race([img.decode(), new Promise((r) => setTimeout(r, URL_TIMEOUT_MS))]).catch(
          () => undefined,
        ),
      );
    }
    if (which === 'before') host.insertBefore(span, host.firstChild);
    else host.appendChild(span);
    spans.push(span);
  };

  /** One pseudo-element: counters, content, and a span when it renders something. */
  const pseudo = (el: Element, which: 'before' | 'after', shadowHost: boolean) => {
    const ps = getComputedStyle(el, `::${which}`);
    applyCounters(ps, counters);
    const c = resolveContent(ps.content, el, ps, counters, quoteDepth);
    if (!c || !visibleBox(ps, c)) return;
    // A span inside a shadow host would not render (it isn't slotted): leave those (PSEUDO_ELEMENT_NOT_CAPTURED).
    if (shadowHost || spans.length >= LIMITS.maxPseudoElements) {
      skipped++;
      return;
    }
    make(el, which, ps, c);
    mark(el, which);
  };

  /** Document (flat tree) order, so counters and quotes resolve as the browser does. */
  const visit = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    applyCounters(cs, counters);
    const eligible = !SKIP.has(tag);
    const shadowHost = Boolean(el.shadowRoot) || tag.includes('-');
    if (eligible) pseudo(el, 'before', shadowHost);
    for (const child of children(el)) if (!child.hasAttribute(MATERIALIZED_ATTR)) visit(child);
    if (eligible) pseudo(el, 'after', shadowHost);
  };

  const mark = (el: Element, which: 'before' | 'after') => {
    const cur = el.getAttribute(MARK_ATTR);
    if (cur === null) marked.push(el);
    el.setAttribute(MARK_ATTR, cur ? `${cur} ${which}` : which);
    hideIn(el.getRootNode() as Document | ShadowRoot);
  };

  const cleanup = () => {
    for (const s of spans) s.remove();
    for (const el of marked) el.removeAttribute(MARK_ATTR);
    for (const [scope, original] of sheets) scope.adoptedStyleSheets = original;
  };

  try {
    visit(doc.documentElement);
    await Promise.all(pendingImages);
  } catch (e) {
    cleanup();
    throw e;
  }
  return { count: spans.length, skipped, cleanup };
}
