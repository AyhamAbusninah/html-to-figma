/**
 * Layer names a designer can read (Phase 2, "easier editing"): "Header", "Nav · Main menu", "Button · Add to cart",
 * "Image · Leather tote", "Heading 2 · New arrivals", "Product card" instead of `div.jsx-2630333056.product-card`.
 * Pure and generic (SYS-5): only HTML semantics (tag, ARIA role/label, alt/title, input type), the element's visible
 * text, and readable class/id words; never a site-specific rule. The CSS-style name stays in `domPath`.
 */
import type { RawElement, RawNode } from './raw-snapshot.ts';

const MAX_NAME = 64;
const MAX_SUBJECT = 32;

/** ARIA roles → layer kind (an explicit role wins over the tag). */
const ROLE_NAMES: Record<string, string> = {
  banner: 'Header',
  navigation: 'Nav',
  contentinfo: 'Footer',
  main: 'Main',
  complementary: 'Sidebar',
  search: 'Search',
  region: 'Section',
  form: 'Form',
  dialog: 'Dialog',
  alertdialog: 'Dialog',
  alert: 'Alert',
  status: 'Status',
  tooltip: 'Tooltip',
  button: 'Button',
  link: 'Link',
  tab: 'Tab',
  tablist: 'Tabs',
  tabpanel: 'Tab panel',
  menu: 'Menu',
  menubar: 'Menu',
  menuitem: 'Menu item',
  list: 'List',
  listitem: 'List item',
  img: 'Image',
  heading: 'Heading',
  textbox: 'Input',
  searchbox: 'Search',
  combobox: 'Select',
  checkbox: 'Checkbox',
  radio: 'Radio',
  switch: 'Switch',
  slider: 'Slider',
  progressbar: 'Progress',
  table: 'Table',
  grid: 'Table',
  row: 'Row',
  cell: 'Cell',
  gridcell: 'Cell',
  columnheader: 'Header cell',
  toolbar: 'Toolbar',
  article: 'Article',
  figure: 'Figure',
};

const TAG_NAMES: Record<string, string> = {
  html: 'Page',
  body: 'Body',
  header: 'Header',
  nav: 'Nav',
  footer: 'Footer',
  main: 'Main',
  aside: 'Sidebar',
  section: 'Section',
  article: 'Article',
  form: 'Form',
  fieldset: 'Field group',
  ul: 'List',
  ol: 'List',
  dl: 'List',
  li: 'List item',
  table: 'Table',
  thead: 'Table header',
  tbody: 'Table body',
  tfoot: 'Table footer',
  tr: 'Row',
  td: 'Cell',
  th: 'Header cell',
  dialog: 'Dialog',
  button: 'Button',
  a: 'Link',
  img: 'Image',
  picture: 'Image',
  video: 'Video',
  canvas: 'Canvas',
  iframe: 'Embed',
  object: 'Embed',
  embed: 'Embed',
  input: 'Input',
  textarea: 'Text area',
  select: 'Select',
  label: 'Label',
  p: 'Paragraph',
  blockquote: 'Quote',
  figure: 'Figure',
  figcaption: 'Caption',
  hr: 'Divider',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  h4: 'Heading 4',
  h5: 'Heading 5',
  h6: 'Heading 6',
};

/** Kinds whose name carries what they say (text, label or alt). */
const WITH_SUBJECT = new Set([
  'Button',
  'Link',
  'Tab',
  'Menu item',
  'Heading',
  'Heading 1',
  'Heading 2',
  'Heading 3',
  'Heading 4',
  'Heading 5',
  'Heading 6',
  'Label',
  'Caption',
  'Header cell',
  'Image',
  'Input',
  'Text area',
  'Select',
  'Checkbox',
  'Radio',
  'Switch',
  'Icon',
  'Alert',
]);
/** Containers: only an explicit aria-label/title is added ("Nav · Main menu"), never their whole text. */
const LABEL_ONLY = new Set([
  'Header',
  'Nav',
  'Footer',
  'Main',
  'Sidebar',
  'Section',
  'Form',
  'Dialog',
  'Menu',
  'Tabs',
  'List',
  'Table',
  'Toolbar',
  'Search',
  'Article',
  'Figure',
]);

const BUTTON_INPUTS = new Set(['submit', 'button', 'reset', 'image']);
const INPUT_KINDS: Record<string, string> = {
  checkbox: 'Checkbox',
  radio: 'Radio',
  range: 'Slider',
  search: 'Search',
  file: 'File input',
  color: 'Color input',
};

/**
 * Class and id words that say nothing to a designer: generated/hashed names (CSS modules, styled-components,
 * styled-jsx, Emotion…), utility-framework classes (spacing and sizes with a number or size keyword, colors, type,
 * layout), responsive/state variants, and generic state or structure words.
 */
const GENERATED =
  /^(jsx|css|sc|emotion|styled|svelte|astro|ng|tw|data-v)-|^_|\d{3,}|[0-9a-f]{6,}|[a-z][A-Z]{2}|[A-Z][a-z][A-Z]/;
const SIZED_UTILITY =
  /^-?(m|p)[trblxyse]?-|^-?(w|h|min-w|max-w|min-h|max-h|size|top|left|right|bottom|start|end|inset(-[xy])?|z|order|gap(-[xy])?|space-[xy]|translate-[xy]|scale(-[xy])?|rotate|basis|grow|shrink|columns|col-span|row-span|col-start|row-start|line-clamp)-(\[.*\]|\d.*|auto|full|screen|px|min|max|fit|none|0)$/;
const STYLE_UTILITY =
  /^(text|bg|font|border|rounded|shadow|items|justify|content|self|place|leading|tracking|transition|duration|ease|delay|animate|cursor|select|align|float|clear|overflow|opacity|ring|outline|fill|stroke|object|aspect|d|col|row|flex|grid|display|position|visible|invisible|whitespace|break|truncate|underline|uppercase|lowercase|capitalize|italic|antialiased|sr)(-.*)?$/;
const STATE_WORD =
  /^(is|has|js|u|l|o)-|^(active|open|opened|closed|show|shown|hide|hidden|visible|selected|current|disabled|loaded|loading|ready|scrolled|sticky|fixed|clearfix|container|container-fluid|wrapper|wrap|inner|outer|content|block|inline|relative|absolute|static|transform|group|peer|dark|light)$/;

function meaningless(word: string): boolean {
  return (
    word.includes(':') ||
    GENERATED.test(word) ||
    SIZED_UTILITY.test(word) ||
    STYLE_UTILITY.test(word) ||
    STATE_WORD.test(word)
  );
}

/** "productCard__title--large" → "Product card title large". */
export function humanize(word: string): string {
  const s = word
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return s ? s[0]!.toUpperCase() + s.slice(1) : '';
}

/** The first readable class (or id) of an element, humanized; null when all are generated or utility names. */
export function readableClass(el: Pick<RawElement, 'classes' | 'idAttr'>): string | null {
  for (const c of [...el.classes, el.idAttr]) {
    if (!c || c.length > 40 || meaningless(c)) continue;
    const h = humanize(c);
    if (h.length >= 3 && /[a-z]{3}/i.test(h)) return h;
  }
  return null;
}

/** At most `max` characters, cut at a word boundary when one is close enough, with "…". */
function clip(t: string, max: number): string {
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  if (space > max / 2) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}
const clean = (t: string | undefined | null) => (t ?? '').replace(/\s+/g, ' ').trim();

/** Visible text of a subtree (icon glyphs excluded), whitespace collapsed, at most `max` characters. */
export function subtreeText(nodes: readonly RawNode[], max = MAX_SUBJECT): string {
  let out = '';
  const visit = (n: RawNode): boolean => {
    if (n.kind === 'text') {
      if (n.iconAssetId) return false;
      const t = clean(n.text);
      if (t) out = out ? `${out} ${t}` : t;
      return out.length >= max;
    }
    if (n.style.visibility !== 'visible' || n.style.display === 'none') return false;
    if (n.control?.text && n.control.kind !== 'other') {
      out = out ? `${out} ${clean(n.control.text)}` : clean(n.control.text);
      return out.length >= max;
    }
    return n.children.some(visit);
  };
  nodes.some(visit);
  return clip(out, max);
}

/** File name of an image URL without extension and size suffixes: ".../leather-tote-800x600.jpg" → "Leather tote". */
function fileSubject(url: string | undefined): string {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return '';
  const file = decodeURIComponent(url.split(/[?#]/)[0]!.split('/').pop() ?? '').replace(
    /\.[a-z0-9]{2,5}$/i,
    '',
  );
  const h = humanize(
    file.replace(/[-_]?\d+x\d+$|[-_]?(scaled|thumb|small|medium|large|e\d{6,})$/gi, ''),
  );
  return /[a-z]{3}/i.test(h) && !/[0-9a-f]{8}/i.test(file) ? h : '';
}

/** What kind of layer this element is, from its role, tag and type (null: a generic div/span). */
function kindOf(el: RawElement): string | null {
  const role = el.attrs?.role?.split(/\s+/)[0]?.toLowerCase();
  if (role && ROLE_NAMES[role]) {
    const k = ROLE_NAMES[role];
    return k === 'Heading' && /^h[1-6]$/.test(el.tag) ? TAG_NAMES[el.tag]! : k;
  }
  if (el.tag === 'input') {
    const type = (el.control?.inputType || el.attrs?.type || 'text').toLowerCase();
    if (BUTTON_INPUTS.has(type)) return 'Button';
    return INPUT_KINDS[type] ?? 'Input';
  }
  if (el.tag === 'svg') return el.rect.width <= 48 && el.rect.height <= 48 ? 'Icon' : 'Graphic';
  return TAG_NAMES[el.tag] ?? null;
}

/**
 * A readable layer name for an element (≤ 64 characters). `::before`/`::after` keep their pseudo-element name.
 * Examples: "Header", "Nav · Main menu", "Button · Add to cart", "Link · Pricing", "Heading 2 · New arrivals",
 * "Image · Leather tote", "Input · Email address", "Icon", "Product card", "Box".
 */
export function semanticName(el: RawElement): string {
  if (el.tag.startsWith('::')) return el.tag;
  const kind = kindOf(el);
  const label = clean(el.attrs?.ariaLabel) || clean(el.attrs?.title);
  let subject = '';
  if (kind && WITH_SUBJECT.has(kind)) {
    if (kind === 'Image')
      subject =
        clean(el.attrs?.alt) || label || fileSubject(el.attrs?.src) || readableClass(el) || '';
    else if (kind === 'Input' || kind === 'Text area' || kind === 'Select')
      subject = label || clean(el.control?.isPlaceholder ? el.control.text : '') || '';
    else if (kind === 'Icon') subject = label || readableClass(el) || '';
    else subject = subtreeText(el.children) || clean(el.control?.text) || label;
  } else if (kind && LABEL_ONLY.has(kind)) subject = label || readableClass(el) || '';
  else if (!kind) {
    // A generic box: its readable class/id ("Product card"), else what it is labelled, else "Box".
    const name = readableClass(el) || label;
    return clip(name || (el.tag === 'span' ? 'Span' : 'Box'), MAX_NAME);
  }
  const k = kind ?? 'Box';
  return clip(
    subject && subject.toLowerCase() !== k.toLowerCase()
      ? `${k} · ${clip(subject, MAX_SUBJECT)}`
      : k,
    MAX_NAME,
  );
}

/** Name of an icon-font glyph: its label, a ligature word (Material "home"), or the icon element's class. */
export function iconName(parent: RawElement, glyph: string): string {
  const t = glyph.trim();
  const subject =
    clean(parent.attrs?.ariaLabel) ||
    clean(parent.attrs?.title) ||
    (/^[a-z][a-z_]{2,}$/i.test(t) ? humanize(t) : '') ||
    readableClass(parent) ||
    '';
  return clip(subject ? `Icon · ${clip(subject, MAX_SUBJECT)}` : 'Icon', MAX_NAME);
}
