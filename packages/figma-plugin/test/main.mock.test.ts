/**
 * Plugin main thread against the strict Figma mock.
 *  - Shared invariants (root frame, placement, selection, viewport, close) for BOTH the rebuilt bundle and the
 *    recovered R0 reference bundle.
 *  - Full-tree rendering (R2 slice) for the rebuilt bundle only.
 *
 * ⚠ Verification level: FIGMA MOCK. Proves API usage. It does NOT prove real Figma renders correctly (R5, B-1).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { kitchenSink, minimal } from '../../schema/test/samples.ts';
import { descendants, MockFrame, MockRect, MockText, runPluginCode } from './figma-mock.ts';

const repo = join(import.meta.dirname, '../../..');
const bundles = {
  rebuilt: join(repo, 'packages/figma-plugin/dist/code.js'),
  reference: join(repo, 'recovery/2026-11-08/figma-plugin-dist/code.js'),
};
const capturedAt = new Date(2026, 10, 8, 14, 32).toISOString();
const rendered = (run: ReturnType<typeof runPluginCode>) =>
  run.posted.find((m) => (m as { type: string }).type === 'rendered') as
    { report: Record<string, unknown> } | undefined;

afterEach(() => {
  MockText.failToken = null;
});

describe.each(Object.entries(bundles))(
  'plugin main, shared invariants (%s bundle)',
  (_label, codePath) => {
    it('bundle exists (run `pnpm build` first)', () => {
      expect(existsSync(codePath), codePath).toBe(true);
    });

    it('opens the UI with the expected options', () => {
      expect(runPluginCode(codePath).ui.options).toEqual({
        width: 420,
        height: 560,
        themeColors: true,
      });
    });

    it('root frame: name, size, placement, clipping, background, selection, viewport', async () => {
      const run = runPluginCode(codePath, [
        { x: 0, width: 500 },
        { x: 600, width: 400 },
      ]);
      const doc = minimal();
      doc.meta.capturedAt = capturedAt;
      doc.meta.title = 'Kitchen Sink';
      doc.meta.sourceUrl = 'https://erp.example/app';
      doc.root.clipsContent = false;
      doc.root.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.6, a: 0.8 } }];
      await run.send({ type: 'render', document: doc });
      const frame = run.page.children.at(-1) as MockFrame;
      expect(frame).toBeInstanceOf(MockFrame);
      expect(frame.name).toBe('Kitchen Sink — erp.example — 2026-11-08 14:32');
      expect([frame.width, frame.height]).toEqual([1280, 2000]);
      expect([frame.x, frame.y]).toEqual([1100, 0]);
      expect(frame.clipsContent).toBe(false);
      expect(frame.fills).toEqual([
        { type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.6 }, opacity: 0.8 },
      ]);
      expect(run.page.selection).toEqual([frame]);
      expect(run.scrolledTo).toEqual([[frame]]);
      expect(rendered(run)?.report).toMatchObject({ rootName: frame.name, layersFailed: [] });
    });

    it('empty page → x = 0; zero-size root clamps to 1 px; no SOLID fill → white', async () => {
      const run = runPluginCode(codePath);
      const doc = minimal();
      doc.root.rect = { x: 0, y: 0, width: 0, height: 0 };
      doc.root.fills = [];
      await run.send({ type: 'render', document: doc });
      const frame = run.page.children.at(-1) as MockFrame;
      expect([frame.x, frame.width, frame.height]).toEqual([0, 1, 1]);
      expect(frame.fills).toEqual([{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }]);
    });

    it('close message closes the plugin', async () => {
      const run = runPluginCode(codePath);
      await run.send({ type: 'close' });
      expect(run.closed).toBe(true);
    });
  },
);

describe('plugin main, full tree (rebuilt bundle, R2 slice)', () => {
  const codePath = bundles.rebuilt;

  it('renders every node: frames, editable text, placeholders, in paint order', async () => {
    const run = runPluginCode(codePath);
    await run.send({ type: 'render', document: kitchenSink() });
    const root = run.page.children.at(-1) as MockFrame;
    const all = descendants(root).slice(1);
    expect(all.map((n) => n.type)).toEqual([
      'FRAME',
      'TEXT',
      'RECTANGLE',
      'RECTANGLE',
      'RECTANGLE',
    ]);
    const card = root.children[0] as MockFrame;
    // Parent-relative coordinates (PLG-R-2): card at doc (10,20); its text at doc (20,30) → (10,10).
    expect([card.x, card.y, card.width, card.height]).toEqual([10, 20, 300, 200]);
    const text = card.children[0] as MockText;
    expect(text.characters).toBe('فاتورة INV-2026-00042');
    expect(text.y).toBe(10);
    expect(text.fontName).toEqual({ family: 'Tajawal', style: 'Bold' }); // Arabic text → Arabic-capable family
    expect(run.loadedFonts.has('Tajawal|Bold')).toBe(true);
    expect(text.textAlignHorizontal).toBe('RIGHT');
    expect(text.textDecoration).toBe('UNDERLINE');
    expect(text.lineHeight).toEqual({ unit: 'AUTO' });
    expect(text.textAutoResize).toBe('WIDTH_AND_HEIGHT');
    // Right-anchored single line (PLG-R-9a): right edge stays at the source right edge.
    expect(text.x + text.width).toBeCloseTo(10 + 200, 5);
    // Placeholders for content not captured (PLG-R-7), named with the reason.
    const placeholders = all.filter((n) => n instanceof MockRect) as MockRect[];
    expect(placeholders.map((p) => p.name)).toEqual([
      'img.logo — image assets not rendered yet (R4)',
      'img.broken — image not captured',
      'svg.icon — SVG not captured yet (R4)',
    ]);
    expect(placeholders[0]!.dashPattern).toEqual([4, 4]);
  });

  it('box styles: per-side strokes (widest color), radii, effects (CSS order reversed, blurType)', async () => {
    const run = runPluginCode(codePath);
    await run.send({ type: 'render', document: kitchenSink() });
    const card = (run.page.children.at(-1) as MockFrame).children[0] as MockFrame;
    expect(card.strokeWeights).toEqual({ top: 1, right: 2, bottom: 0, left: 1.5 });
    expect(card.dashPattern).toEqual([6, 6]); // widest side (right, 2px) is dashed
    expect(card.radii).toEqual({ tl: 8, tr: 8, br: 0, bl: 100 });
    expect(card.opacity).toBe(0.5);
    expect(card.blendMode).toBe('MULTIPLY');
    expect((card.effects as { type: string }[]).map((e) => e.type)).toEqual([
      'BACKGROUND_BLUR',
      'LAYER_BLUR',
      'INNER_SHADOW',
      'DROP_SHADOW',
    ]);
    expect(card.fills).toEqual([
      { type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 }, opacity: 0.4 },
    ]);
  });

  it('report: layers, unsupported paints, placeholders, warnings count', async () => {
    const run = runPluginCode(codePath);
    await run.send({ type: 'render', document: kitchenSink() });
    expect(rendered(run)?.report).toMatchObject({
      layersCreated: 6,
      layersFailed: [],
      placeholders: 3,
      unsupported: expect.arrayContaining([
        'GRADIENT_LINEAR paint',
        'GRADIENT_RADIAL paint',
        'IMAGE paint',
      ]),
      captureWarnings: 2,
    });
  });

  it('a failing node is reported and skipped; the rest still renders (PLG-R-11)', async () => {
    MockText.failToken = 'INV-2026';
    const run = runPluginCode(codePath);
    await run.send({ type: 'render', document: kitchenSink() });
    const report = rendered(run)?.report as {
      layersCreated: number;
      layersFailed: { path: string; error: string }[];
    };
    expect(report.layersFailed).toHaveLength(1);
    expect(report.layersFailed[0]!.path).toBe('/root/0/0');
    expect(report.layersFailed[0]!.error).toContain('injected failure');
    expect(report.layersCreated).toBe(5);
    expect(
      descendants(run.page.children.at(-1) as MockFrame).some((n) => n instanceof MockText),
    ).toBe(false);
  });

  it('unavailable font family falls back with a reported substitution', async () => {
    const run = runPluginCode(codePath);
    const doc = minimal();
    doc.root.children = [
      {
        id: 't1',
        name: 'Hello',
        type: 'TEXT',
        rect: { x: 0, y: 0, width: 100, height: 20 },
        opacity: 1,
        characters: 'Hello',
        lineCount: 1,
        style: {
          fontFamilies: ['Brand Sans', 'Helvetica Neue', 'sans-serif'],
          fontWeight: 600,
          fontStyle: 'normal',
          fontSize: 16,
          lineHeight: 24,
          letterSpacing: 0.5,
          color: { r: 0, g: 0, b: 0, a: 1 },
          direction: 'ltr',
          textAlign: 'left',
          textDecoration: 'none',
          textCase: 'upper',
        },
      },
    ];
    await run.send({ type: 'render', document: doc });
    const text = (run.page.children.at(-1) as MockFrame).children[0] as MockText;
    expect(text.fontName).toEqual({ family: 'Inter', style: 'Semi Bold' });
    expect(text.lineHeight).toEqual({ unit: 'PIXELS', value: 24 });
    expect(text.letterSpacing).toEqual({ unit: 'PIXELS', value: 0.5 });
    expect(text.textCase).toBe('UPPER');
    expect(rendered(run)?.report.fontSubstitutions).toEqual([
      {
        requested: 'Brand Sans',
        weight: 600,
        italic: false,
        used: { family: 'Inter', style: 'Semi Bold' },
        arabicRule: false,
        count: 1,
      },
    ]);
  });
});
