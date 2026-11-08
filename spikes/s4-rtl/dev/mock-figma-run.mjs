// Runs spikes/s4-rtl/code.js against a strict mock of the Figma Plugin API to catch runtime errors before a
// human runs the spike in Figma. It doesn't model rendering, only API shape and call-order rules that commonly
// bite (e.g. setting characters before the font is loaded).  Usage: node spikes/s4-rtl/dev/mock-figma-run.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const codePath = fileURLToPath(new URL('../code.js', import.meta.url));
const loaded = new Set();
const fontKey = (f) => `${f.family}::${f.style}`;
const AVAILABLE = [
  ['Inter', 'Regular'], ['Inter', 'Bold'],
  ['Tajawal', 'Regular'], ['Tajawal', 'Bold'], ['Tajawal', 'ExtraBold'],
  ['Cairo', 'Regular'], ['Cairo', 'Bold'], ['Cairo', 'SemiBold'],
  ['Noto Sans Arabic', 'Regular'], ['Noto Sans Arabic', 'Bold'],
].map(([family, style]) => ({ fontName: { family, style } }));

const posted = [];
let onmessage = null;
const pageChildren = [];
let nodeId = 0;

class BaseNode {
  constructor(type) { this.type = type; this.id = `1:${++nodeId}`; this.name = type; this.x = 0; this.y = 0; this.width = 100; this.height = 100; this.parent = null; this.removed = false; this.fills = []; }
  resize(w, h) { if (!(w >= 0.01 && h >= 0.01)) throw new Error(`resize: invalid size ${w}x${h}`); this.width = w; this.height = h; }
  remove() { this.removed = true; if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
}
class FrameNode extends BaseNode {
  constructor() { super('FRAME'); this.children = []; }
  appendChild(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = this; this.children.push(n); }
}
class TextNode extends BaseNode {
  constructor() { super('TEXT'); this._font = { family: 'Inter', style: 'Regular' }; this._chars = ''; this.textAutoResize = 'NONE'; this.fontSize = 12; this.textAlignHorizontal = 'LEFT'; }
  get fontName() { return this._font; }
  set fontName(f) { if (!loaded.has(fontKey(f))) throw new Error(`fontName: font ${fontKey(f)} not loaded`); this._font = f; }
  get characters() { return this._chars; }
  set characters(c) {
    if (!loaded.has(fontKey(this._font))) throw new Error(`characters: font ${fontKey(this._font)} not loaded`);
    if (typeof c !== 'string') throw new Error('characters must be a string');
    this._chars = c;
    // Crude width model: ZWNJ-isolated text is wider, so shaping checks see a plausible ratio.
    const isolated = c.includes('‌');
    if (this.textAutoResize === 'WIDTH_AND_HEIGHT' || this.textAutoResize === 'NONE') this.width = [...c].filter((ch) => ch !== '‌').length * this.fontSize * (isolated ? 0.7 : 0.5);
    this.height = 48;
  }
  async exportAsync(opts) {
    if (opts.format !== 'PNG' || opts.constraint.type !== 'SCALE') throw new Error('unexpected export opts');
    return new Uint8Array([137, 80, 78, 71]);
  }
}

const figma = {
  apiVersion: '1.0.0',
  editorType: 'figma',
  showUI(html, opts) { if (typeof html !== 'string') throw new Error('showUI needs __html__'); this._ui = opts; },
  ui: {
    postMessage(m) { posted.push(m); },
    set onmessage(fn) { onmessage = fn; },
    get onmessage() { return onmessage; },
  },
  async listAvailableFontsAsync() { return AVAILABLE; },
  async loadFontAsync(f) {
    if (!AVAILABLE.some((a) => fontKey(a.fontName) === fontKey(f))) throw new Error(`font ${fontKey(f)} unavailable`);
    loaded.add(fontKey(f));
  },
  createText() { const t = new TextNode(); figma.currentPage.appendChild(t); return t; },
  createFrame() { const f = new FrameNode(); figma.currentPage.appendChild(f); return f; },
  createRectangle() { const r = new BaseNode('RECTANGLE'); figma.currentPage.appendChild(r); return r; },
  createImage(bytes) { if (!(bytes instanceof Uint8Array)) throw new Error('createImage needs Uint8Array'); return { hash: 'h' + bytes.length }; },
  currentPage: { get children() { return pageChildren.slice(); }, appendChild(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = { children: pageChildren }; pageChildren.push(n); } },
  viewport: { scrollAndZoomIntoView(nodes) { if (!Array.isArray(nodes)) throw new Error('needs array'); } },
  notify() {},
  closePlugin() {},
};

vm.runInNewContext(readFileSync(codePath, 'utf8'), { figma, __html__: '<html></html>', console, Uint8Array, Date, Math, String, Object, Error, Promise });

const init = posted.find((m) => m.type === 'init');
if (!init) throw new Error('no init message');
const refs = {};
for (const font of init.fonts) for (const c of init.cases) refs[`${c.id}|${font}`] = new Uint8Array([1, 2, 3]);
await onmessage({ type: 'references', refs, fontLoad: {} });
await new Promise((r) => setTimeout(r, 50));

const fatal = posted.find((m) => m.type === 'fatal');
if (fatal) { console.error('FATAL from code.js:\n' + fatal.message); process.exit(1); }
const results = posted.find((m) => m.type === 'results');
if (!results) { console.error('no results message'); process.exit(1); }
const r = results.report;
const expectedExports = init.fonts.length * init.cases.length * 2;
console.log(JSON.stringify({
  exports: results.exports.length,
  expectedExports,
  errors: r.errors,
  wrapped: r.wrapped,
  shapingSample: r.shaping.slice(0, 2),
  fonts: Object.fromEntries(Object.entries(r.fonts).map(([k, v]) => [k, { available: v.available, styles: v.styles.length, regular: v.loadedRegular, bold: v.loadedBold }])),
  apiProbe: r.apiProbe,
  frameChildren: pageChildren.find((n) => n.type === 'FRAME').children.length,
  orphanTextNodesOnPage: pageChildren.filter((n) => n.type !== 'FRAME' && !n.removed).length,
}, null, 2));
if (results.exports.length !== expectedExports || r.errors.length) process.exit(1);
console.log('MOCK RUN OK');
