/**
 * Plugin main thread against the strict Figma mock, for BOTH the rebuilt bundle and the recovered reference bundle,
 * which must behave identically.
 *
 * ⚠ Verification level: FIGMA MOCK. Proves API usage and behavioral equivalence with the reference build. It does
 * NOT prove real Figma renders the frame (that requires macOS/Windows, plan §7 / B-1).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kitchenSink, minimal } from '../../schema/test/samples.ts';
import { MockFrame, runPluginCode } from './figma-mock.ts';

const repo = join(import.meta.dirname, '../../..');
const bundles = {
  rebuilt: join(repo, 'packages/figma-plugin/dist/code.js'),
  reference: join(repo, 'recovery/2026-11-08/figma-plugin-dist/code.js'),
};

const capturedAt = new Date(2026, 10, 8, 14, 32).toISOString();

describe.each(Object.entries(bundles))('plugin main (%s bundle)', (_label, codePath) => {
  it('bundle exists (run `pnpm build` first)', () => {
    expect(existsSync(codePath), codePath).toBe(true);
  });

  it('opens the UI with the expected options', () => {
    const run = runPluginCode(codePath);
    expect(run.ui.options).toEqual({ width: 420, height: 560, themeColors: true });
  });

  it('renders the root frame: name, size, placement, clipping, background, selection, viewport, report', async () => {
    const run = runPluginCode(codePath, [
      { x: 0, width: 500 },
      { x: 600, width: 400 },
    ]);
    const doc = kitchenSink();
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
    expect(run.posted[0]).toEqual({ type: 'progress', text: 'Creating root frame…' });
    expect(run.posted[1]).toMatchObject({
      type: 'rendered',
      report: { rootName: frame.name, layersCreated: 1, layersFailed: [] },
    });
  });

  it('empty page → x = 0; zero-size root clamps to the 1 px minimum; no SOLID fill → white', async () => {
    const run = runPluginCode(codePath);
    const doc = minimal();
    doc.root.rect = { x: 0, y: 0, width: 0, height: 0 };
    doc.root.fills = [];
    await run.send({ type: 'render', document: doc });
    const frame = run.page.children.at(-1) as MockFrame;
    expect([frame.x, frame.width, frame.height]).toEqual([0, 1, 1]);
    expect(frame.fills).toEqual([{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }]);
  });

  it('reports render failures to the UI instead of throwing', async () => {
    const run = runPluginCode(codePath);
    await run.send({
      type: 'render',
      document: {
        ...minimal(),
        root: { ...minimal().root, rect: { width: Number.NaN, height: 5 } },
      },
    });
    expect(run.posted.at(-1)).toMatchObject({ type: 'error' });
  });

  it('close message closes the plugin', async () => {
    const run = runPluginCode(codePath);
    await run.send({ type: 'close' });
    expect(run.closed).toBe(true);
  });
});
