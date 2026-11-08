/**
 * Strict mock of the subset of the Figma Plugin API used by the plugin main thread.
 *
 * ⚠ Verification level: FIGMA MOCK. It checks API *usage* (shapes, argument validity, call order) against the
 * documented contract. It cannot show that Figma renders anything correctly. Real-Figma verification happens in
 * R5 on macOS/Windows (plan §7). Never treat a pass here as real-Figma validation.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

type Paint = { type: string; color?: { r: number; g: number; b: number }; opacity?: number };

const in01 = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;

function assertPaints(paints: unknown): asserts paints is Paint[] {
  if (!Array.isArray(paints)) throw new Error('fills must be an array');
  for (const p of paints as Paint[]) {
    if (p.type !== 'SOLID') throw new Error(`mock supports SOLID paints only, got ${p.type}`);
    const keys = Object.keys(p).sort().join(',');
    if (keys !== 'color,opacity,type' && keys !== 'color,type')
      throw new Error(`unexpected SolidPaint keys: ${keys}`);
    const c = p.color!;
    if (Object.keys(c).sort().join(',') !== 'b,g,r')
      throw new Error('SolidPaint.color must be {r,g,b} (no alpha)');
    if (![c.r, c.g, c.b].every(in01)) throw new Error('color channels must be 0..1');
    if (p.opacity !== undefined && !in01(p.opacity)) throw new Error('opacity must be 0..1');
  }
}

export class MockFrame {
  readonly type = 'FRAME';
  name = 'Frame';
  x = 0;
  y = 0;
  width = 100;
  height = 100;
  clipsContent = true;
  #fills: Paint[] = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  resize(w: number, h: number) {
    if (!(w >= 0.01 && h >= 0.01))
      throw new Error(`resize: width and height must be >= 0.01 (got ${w}×${h})`);
    this.width = w;
    this.height = h;
  }
  get fills(): Paint[] {
    return this.#fills;
  }
  set fills(v: Paint[]) {
    assertPaints(v);
    this.#fills = v;
  }
}

export interface MockRun {
  posted: unknown[];
  page: { children: (MockFrame | { x: number; width: number })[]; selection: unknown[] };
  ui: { html?: string; options?: Record<string, unknown> };
  scrolledTo: unknown[][];
  closed: boolean;
  send(msg: unknown): Promise<void>;
}

/** Loads a built plugin `code.js` into a sandboxed context with the mock `figma` global. */
export function runPluginCode(
  codePath: string,
  existingNodes: { x: number; width: number }[] = [],
): MockRun {
  let onmessage: ((msg: unknown) => void) | undefined;
  const run: MockRun = {
    posted: [],
    page: { children: [...existingNodes], selection: [] },
    ui: {},
    scrolledTo: [],
    closed: false,
    async send(msg) {
      if (!onmessage) throw new Error('plugin did not register figma.ui.onmessage');
      onmessage(msg);
      await new Promise((r) => setTimeout(r, 10));
    },
  };
  const figma = {
    showUI(html: unknown, options: Record<string, unknown>) {
      if (typeof html !== 'string') throw new Error('showUI(__html__) expects a string');
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
        return run.page.children.slice(); // Figma returns a snapshot array
      },
      get selection() {
        return run.page.selection;
      },
      set selection(nodes: unknown[]) {
        if (!Array.isArray(nodes)) throw new Error('selection must be an array');
        run.page.selection = nodes;
      },
    },
    createFrame() {
      const f = new MockFrame();
      run.page.children.push(f);
      return f;
    },
    viewport: {
      scrollAndZoomIntoView(nodes: unknown[]) {
        if (!Array.isArray(nodes)) throw new Error('scrollAndZoomIntoView expects an array');
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
    setTimeout,
  });
  return run;
}
