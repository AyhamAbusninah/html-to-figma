/**
 * Strict mock of the subset of the Figma Plugin API used by the plugin main thread.
 *
 * ⚠ Verification level: FIGMA MOCK. It checks API *usage* (shapes, enum values, argument ranges, font-loading order)
 * against the documented contract (@figma/plugin-typings 1.142.0). It CANNOT show that Figma renders anything
 * correctly. Text widths are crude estimates. Real-Figma verification is R5 (B-1). Never treat a pass here as
 * real-Figma validation.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const in01 = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;
const num = (v: unknown, min = -Infinity) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min;
function fail(msg: string): never {
  throw new Error(`[figma-mock] ${msg}`);
}

const BLEND_MODES = new Set([
  'PASS_THROUGH',
  'NORMAL',
  'DARKEN',
  'MULTIPLY',
  'LINEAR_BURN',
  'COLOR_BURN',
  'LIGHTEN',
  'SCREEN',
  'LINEAR_DODGE',
  'COLOR_DODGE',
  'OVERLAY',
  'SOFT_LIGHT',
  'HARD_LIGHT',
  'DIFFERENCE',
  'EXCLUSION',
  'HUE',
  'SATURATION',
  'COLOR',
  'LUMINOSITY',
]);

export interface MockFont {
  family: string;
  style: string;
}

/** A realistic subset of Figma's font list (Google Fonts are available in Figma). */
export const MOCK_FONTS: MockFont[] = [
  ...[
    'Thin',
    'Extra Light',
    'Light',
    'Regular',
    'Medium',
    'Semi Bold',
    'Bold',
    'Extra Bold',
    'Black',
  ].flatMap((s) => [
    { family: 'Inter', style: s },
    { family: 'Inter', style: s === 'Regular' ? 'Italic' : `${s} Italic` },
  ]),
  ...['Regular', 'Medium', 'Bold'].map((style) => ({ family: 'Roboto', style })),
  ...['Regular', 'Bold'].map((style) => ({ family: 'Roboto Mono', style })),
  ...['Regular', 'Bold', 'Italic'].map((style) => ({ family: 'Noto Serif', style })),
  ...['Regular', 'Medium', 'SemiBold', 'Bold'].map((style) => ({
    family: 'Noto Sans Arabic',
    style,
  })),
  ...['ExtraLight', 'Light', 'Regular', 'Medium', 'Bold', 'ExtraBold', 'Black'].map((style) => ({
    family: 'Tajawal',
    style,
  })),
  ...['ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black'].map(
    (style) => ({ family: 'Cairo', style }),
  ),
];

function assertSolidPaints(paints: unknown, what: string) {
  if (!Array.isArray(paints)) fail(`${what} must be an array`);
  for (const p of paints as Record<string, unknown>[]) {
    if (p.type !== 'SOLID') fail(`${what}: mock supports SOLID only, got ${String(p.type)}`);
    const keys = Object.keys(p).sort().join(',');
    if (keys !== 'color,opacity,type' && keys !== 'color,type')
      fail(`${what}: unexpected SolidPaint keys ${keys}`);
    const c = p.color as Record<string, unknown>;
    if (Object.keys(c).sort().join(',') !== 'b,g,r')
      fail(`${what}: SolidPaint.color must be {r,g,b}`);
    if (![c.r, c.g, c.b].every(in01)) fail(`${what}: color channels must be 0..1`);
    if (p.opacity !== undefined && !in01(p.opacity)) fail(`${what}: opacity must be 0..1`);
  }
}

function assertEffects(effects: unknown) {
  if (!Array.isArray(effects)) fail('effects must be an array');
  for (const e of effects as Record<string, unknown>[]) {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      const c = e.color as Record<string, unknown>;
      if (!c || ![c.r, c.g, c.b, c.a].every(in01)) fail('shadow color must be RGBA 0..1');
      const o = e.offset as Record<string, unknown>;
      if (!o || !num(o.x) || !num(o.y)) fail('shadow offset must be {x,y}');
      if (!num(e.radius, 0)) fail('shadow radius must be >= 0');
      if (e.spread !== undefined && !num(e.spread)) fail('shadow spread must be a number');
      if (typeof e.visible !== 'boolean') fail('effect.visible is required');
      if (!BLEND_MODES.has(String(e.blendMode))) fail('shadow blendMode is required');
    } else if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
      if (e.blurType !== 'NORMAL') fail("blur effects require blurType: 'NORMAL'");
      if (!num(e.radius, 0) || typeof e.visible !== 'boolean')
        fail('blur needs radius >= 0 and visible');
    } else fail(`unknown effect type ${String(e.type)}`);
  }
}

let nextNodeId = 1;

export class MockNode {
  readonly id = `m${nextNodeId++}`;
  name = '';
  x = 0;
  y = 0;
  width = 100;
  height = 100;
  parent: MockFrame | MockPage | null = null;
  removed = false;
  #opacity = 1;
  #blendMode = 'PASS_THROUGH';
  readonly type: string;
  constructor(type: string) {
    this.type = type;
  }
  get opacity() {
    return this.#opacity;
  }
  set opacity(v: number) {
    if (!in01(v)) fail(`opacity must be 0..1 (got ${v})`);
    this.#opacity = v;
  }
  get blendMode() {
    return this.#blendMode;
  }
  set blendMode(v: string) {
    if (!BLEND_MODES.has(v)) fail(`invalid blendMode ${v}`);
    this.#blendMode = v;
  }
  remove() {
    this.removed = true;
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
}

export class MockBox extends MockNode {
  #fills: unknown[] = [];
  #strokes: unknown[] = [];
  #effects: unknown[] = [];
  #strokeAlign = 'INSIDE';
  strokeWeights = { top: 1, right: 1, bottom: 1, left: 1 };
  dashPattern: number[] = [];
  radii = { tl: 0, tr: 0, br: 0, bl: 0 };
  resize(w: number, h: number) {
    if (!(w >= 0.01 && h >= 0.01)) fail(`resize: width and height must be >= 0.01 (got ${w}×${h})`);
    this.width = w;
    this.height = h;
  }
  get fills() {
    return this.#fills;
  }
  set fills(v: unknown[]) {
    assertSolidPaints(v, 'fills');
    this.#fills = v;
  }
  get strokes() {
    return this.#strokes;
  }
  set strokes(v: unknown[]) {
    assertSolidPaints(v, 'strokes');
    this.#strokes = v;
  }
  get effects() {
    return this.#effects;
  }
  set effects(v: unknown[]) {
    assertEffects(v);
    this.#effects = v;
  }
  get strokeAlign() {
    return this.#strokeAlign;
  }
  set strokeAlign(v: string) {
    if (!['INSIDE', 'OUTSIDE', 'CENTER'].includes(v)) fail(`invalid strokeAlign ${v}`);
    this.#strokeAlign = v;
  }
  set strokeWeight(v: number) {
    if (!num(v, 0)) fail('strokeWeight must be >= 0');
    this.strokeWeights = { top: v, right: v, bottom: v, left: v };
  }
  #side(side: 'top' | 'right' | 'bottom' | 'left', v: number) {
    if (!num(v, 0)) fail(`stroke ${side} weight must be >= 0`);
    this.strokeWeights[side] = v;
  }
  set strokeTopWeight(v: number) {
    this.#side('top', v);
  }
  set strokeRightWeight(v: number) {
    this.#side('right', v);
  }
  set strokeBottomWeight(v: number) {
    this.#side('bottom', v);
  }
  set strokeLeftWeight(v: number) {
    this.#side('left', v);
  }
  #corner(c: 'tl' | 'tr' | 'br' | 'bl', v: number) {
    if (!num(v, 0)) fail('corner radius must be >= 0');
    this.radii[c] = v;
  }
  set topLeftRadius(v: number) {
    this.#corner('tl', v);
  }
  set topRightRadius(v: number) {
    this.#corner('tr', v);
  }
  set bottomRightRadius(v: number) {
    this.#corner('br', v);
  }
  set bottomLeftRadius(v: number) {
    this.#corner('bl', v);
  }
}

export class MockFrame extends MockBox {
  readonly children: MockNode[] = [];
  clipsContent = true;
  constructor() {
    super('FRAME');
    this.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  }
  appendChild(n: MockNode) {
    if (n === this) fail('cannot append a node to itself');
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    n.parent = this;
    this.children.push(n);
  }
}

export class MockRect extends MockBox {
  constructor() {
    super('RECTANGLE');
    this.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
  }
}

const TEXT_ALIGN = new Set(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']);
const DECORATION = new Set(['NONE', 'UNDERLINE', 'STRIKETHROUGH']);
const TEXT_CASE = new Set([
  'ORIGINAL',
  'UPPER',
  'LOWER',
  'TITLE',
  'SMALL_CAPS',
  'SMALL_CAPS_FORCED',
]);
const AUTO_RESIZE = new Set(['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE']);

export class MockText extends MockNode {
  /** Test hook: setting characters containing this token throws (exercises PLG-R-11 resilience). */
  static failToken: string | null = null;
  #font: MockFont = { family: 'Inter', style: 'Regular' };
  #characters = '';
  #fontSize = 12;
  #lineHeight: { unit: string; value?: number } = { unit: 'AUTO' };
  #letterSpacing = { unit: 'PERCENT', value: 0 };
  #align = 'LEFT';
  #decoration = 'NONE';
  #case = 'ORIGINAL';
  #autoResize = 'WIDTH_AND_HEIGHT';
  #fills: unknown[] = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  private readonly loaded: Set<string>;
  constructor(loaded: Set<string>) {
    super('TEXT');
    this.loaded = loaded;
    this.#relayout();
  }
  #requireLoaded(f: MockFont, what: string) {
    if (!this.loaded.has(`${f.family}|${f.style}`))
      fail(`${what}: font "${f.family} ${f.style}" is not loaded (call loadFontAsync first)`);
  }
  get fontName() {
    return this.#font;
  }
  set fontName(f: MockFont) {
    this.#requireLoaded(f, 'fontName');
    this.#font = f;
    this.#relayout();
  }
  get characters() {
    return this.#characters;
  }
  set characters(c: string) {
    this.#requireLoaded(this.#font, 'characters');
    if (typeof c !== 'string') fail('characters must be a string');
    if (MockText.failToken && c.includes(MockText.failToken))
      fail(`injected failure for text containing "${MockText.failToken}"`);
    this.#characters = c;
    this.#relayout();
  }
  get fontSize() {
    return this.#fontSize;
  }
  set fontSize(v: number) {
    this.#requireLoaded(this.#font, 'fontSize');
    if (!num(v, 1)) fail(`fontSize must be >= 1 (got ${v})`);
    this.#fontSize = v;
    this.#relayout();
  }
  get lineHeight() {
    return this.#lineHeight;
  }
  set lineHeight(v: { unit: string; value?: number }) {
    this.#requireLoaded(this.#font, 'lineHeight');
    if (
      v.unit === 'AUTO'
        ? Object.keys(v).length !== 1
        : !['PIXELS', 'PERCENT'].includes(v.unit) || !num(v.value, 0)
    ) {
      fail(`invalid lineHeight ${JSON.stringify(v)}`);
    }
    this.#lineHeight = v;
    this.#relayout();
  }
  get letterSpacing() {
    return this.#letterSpacing;
  }
  set letterSpacing(v: { unit: string; value: number }) {
    this.#requireLoaded(this.#font, 'letterSpacing');
    if (!['PIXELS', 'PERCENT'].includes(v.unit) || !num(v.value))
      fail(`invalid letterSpacing ${JSON.stringify(v)}`);
    this.#letterSpacing = v;
  }
  get fills() {
    return this.#fills;
  }
  set fills(v: unknown[]) {
    assertSolidPaints(v, 'text fills');
    this.#fills = v;
  }
  get textAlignHorizontal() {
    return this.#align;
  }
  set textAlignHorizontal(v: string) {
    if (!TEXT_ALIGN.has(v)) fail(`invalid textAlignHorizontal ${v}`);
    this.#align = v;
  }
  get textDecoration() {
    return this.#decoration;
  }
  set textDecoration(v: string) {
    this.#requireLoaded(this.#font, 'textDecoration');
    if (!DECORATION.has(v)) fail(`invalid textDecoration ${v}`);
    this.#decoration = v;
  }
  get textCase() {
    return this.#case;
  }
  set textCase(v: string) {
    this.#requireLoaded(this.#font, 'textCase');
    if (!TEXT_CASE.has(v)) fail(`invalid textCase ${v}`);
    this.#case = v;
  }
  get textAutoResize() {
    return this.#autoResize;
  }
  set textAutoResize(v: string) {
    if (!AUTO_RESIZE.has(v)) fail(`invalid textAutoResize ${v}`);
    this.#autoResize = v;
    this.#relayout();
  }
  resize(w: number, h: number) {
    if (!(w >= 0.01 && h >= 0.01)) fail(`text resize must be >= 0.01 (got ${w}×${h})`);
    this.width = w;
    this.height = h;
    if (this.#autoResize === 'WIDTH_AND_HEIGHT') this.#autoResize = 'HEIGHT'; // Figma switches mode on resize
    this.#relayout();
  }
  get lineHeightPx() {
    return this.#lineHeight.unit === 'PIXELS' ? this.#lineHeight.value! : this.#fontSize * 1.2;
  }
  /** Crude layout: average glyph width 0.55 em. Only used so anchoring code paths have a width to work with. */
  #relayout() {
    const textWidth = [...this.#characters].length * this.#fontSize * 0.55;
    if (this.#autoResize === 'WIDTH_AND_HEIGHT') {
      this.width = Math.max(textWidth, 0.01);
      this.height = this.lineHeightPx * Math.max(1, this.#characters.split('\n').length);
    } else if (this.#autoResize === 'HEIGHT') {
      const lines = Math.max(1, Math.ceil(textWidth / Math.max(this.width, 1)));
      this.height = this.lineHeightPx * lines;
    }
  }
}

export class MockPage {
  readonly children: MockNode[] = [];
  selection: MockNode[] = [];
  appendChild(n: MockNode) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    n.parent = this;
    this.children.push(n);
  }
}

export interface MockRun {
  posted: unknown[];
  page: MockPage;
  ui: { html?: string; options?: Record<string, unknown> };
  scrolledTo: unknown[][];
  loadedFonts: Set<string>;
  closed: boolean;
  send(msg: unknown): Promise<void>;
}

/** Loads a built plugin `code.js` into a sandboxed context with the mock `figma` global. */
export function runPluginCode(
  codePath: string,
  existingNodes: { x: number; width: number }[] = [],
  fonts: MockFont[] = MOCK_FONTS,
): MockRun {
  let onmessage: ((msg: unknown) => void) | undefined;
  const page = new MockPage();
  for (const n of existingNodes) {
    const f = new MockFrame();
    f.x = n.x;
    f.width = n.width;
    page.appendChild(f);
  }
  const loadedFonts = new Set<string>();
  const run: MockRun = {
    posted: [],
    page,
    ui: {},
    scrolledTo: [],
    loadedFonts,
    closed: false,
    async send(msg) {
      if (!onmessage) throw new Error('plugin did not register figma.ui.onmessage');
      onmessage(msg);
      // Wait until the plugin reports completion (rendered/error) or a short idle period for other messages.
      const typed = msg as { type?: string };
      for (let i = 0; i < 2000; i++) {
        await new Promise((r) => setTimeout(r, 1));
        if (typed.type !== 'render') break;
        if (run.posted.some((m) => ['rendered', 'error'].includes((m as { type: string }).type)))
          break;
      }
    },
  };
  const figma = {
    showUI(html: unknown, options: Record<string, unknown>) {
      if (typeof html !== 'string') fail('showUI(__html__) expects a string');
      run.ui = { html, options };
    },
    ui: {
      postMessage(m: unknown) {
        run.posted.push(structuredClone(m));
      },
      set onmessage(fn: (msg: unknown) => void) {
        onmessage = fn;
      },
    },
    currentPage: {
      get children() {
        return page.children.slice(); // Figma returns a snapshot array
      },
      get selection() {
        return page.selection;
      },
      set selection(nodes: MockNode[]) {
        if (!Array.isArray(nodes)) fail('selection must be an array');
        page.selection = nodes;
      },
    },
    async listAvailableFontsAsync() {
      return fonts.map((fontName) => ({ fontName: { ...fontName } }));
    },
    async loadFontAsync(f: MockFont) {
      if (!f || typeof f.family !== 'string' || typeof f.style !== 'string')
        fail('loadFontAsync expects a FontName');
      if (!fonts.some((x) => x.family === f.family && x.style === f.style))
        throw new Error(`font ${f.family} ${f.style} not found`);
      loadedFonts.add(`${f.family}|${f.style}`);
    },
    createFrame() {
      const f = new MockFrame();
      page.appendChild(f);
      return f;
    },
    createRectangle() {
      const r = new MockRect();
      page.appendChild(r);
      return r;
    },
    createText() {
      const t = new MockText(loadedFonts);
      page.appendChild(t);
      return t;
    },
    viewport: {
      scrollAndZoomIntoView(nodes: unknown[]) {
        if (!Array.isArray(nodes)) fail('scrollAndZoomIntoView expects an array');
        run.scrolledTo.push(nodes);
      },
    },
    closePlugin() {
      run.closed = true;
    },
  };
  vm.runInNewContext(readFileSync(codePath, 'utf8'), {
    figma,
    __html__: '<html></html>',
    console,
    Date,
    Math,
    Number,
    String,
    Error,
    Promise,
    Map,
    Set,
    JSON,
    Object,
    Array,
    RegExp,
    setTimeout,
  });
  return run;
}

/** All nodes under a root, depth-first (for assertions). */
export function descendants(root: MockNode): MockNode[] {
  const out: MockNode[] = [];
  const visit = (n: MockNode) => {
    out.push(n);
    if (n instanceof MockFrame) n.children.forEach(visit);
  };
  visit(root);
  return out;
}
