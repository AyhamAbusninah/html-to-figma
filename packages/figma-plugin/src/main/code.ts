/**
 * Plugin main thread (Figma sandbox). Built as one IIFE: dist/code.js.
 *
 * R0: walking skeleton. Renders only the root frame (name, size, placement, background, clipping), then selects it
 * and scrolls it into view. The node renderer (planner + adapter) arrives in R3.
 */
import type { CaptureDocument } from '@h2f/schema';
import type { MainToUi, UiToMain } from '../shared/messages.ts';
import { placementX, rootFrameName, solidPaint } from '../shared/naming.ts';

const post = (msg: MainToUi) => figma.ui.postMessage(msg);

async function render(doc: CaptureDocument): Promise<void> {
  const started = Date.now();
  post({ type: 'progress', text: 'Creating root frame…' });

  // Snapshot positions before creating the frame (createFrame appends to the page).
  const existing = figma.currentPage.children.map((n) => ({ x: n.x, width: n.width }));
  const root = figma.createFrame();
  root.name = rootFrameName(doc.meta);
  root.resize(Math.max(doc.root.rect.width, 1), Math.max(doc.root.rect.height, 1));
  root.x = placementX(existing);
  root.y = 0;
  root.clipsContent = doc.root.clipsContent;
  const solid = doc.root.fills.find((p) => p.type === 'SOLID');
  root.fills = [
    solidPaint(solid && solid.type === 'SOLID' ? solid.color : { r: 1, g: 1, b: 1, a: 1 }),
  ];

  figma.currentPage.selection = [root];
  figma.viewport.scrollAndZoomIntoView([root]);
  post({
    type: 'rendered',
    report: {
      rootName: root.name,
      layersCreated: 1,
      layersFailed: [],
      durationMs: Date.now() - started,
    },
  });
}

figma.showUI(__html__, { width: 420, height: 560, themeColors: true });

figma.ui.onmessage = (msg: UiToMain) => {
  if (msg.type === 'render') {
    render(msg.document).catch((e: unknown) =>
      post({ type: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  } else if (msg.type === 'close') {
    figma.closePlugin();
  }
};
