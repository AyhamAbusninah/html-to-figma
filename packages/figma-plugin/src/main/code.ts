/**
 * Plugin main thread (Figma sandbox). Built as one IIFE: dist/code.js.
 * CaptureDocument → buildPlan (pure) → executePlan (figma.*) → select + report.
 * Verification: FIGMA MOCK only. Real-Figma behavior unverified until R5 (B-1).
 */
import type { CaptureDocument } from '@h2f/schema';
import { executePlan } from '../adapter/render.ts';
import { buildPlan } from '../plan/plan.ts';
import type { MainToUi, UiToMain } from '../shared/messages.ts';
import { placementX, rootFrameName } from '../shared/naming.ts';

const post = (msg: MainToUi) => figma.ui.postMessage(msg);

async function render(doc: CaptureDocument): Promise<void> {
  const started = Date.now();
  post({ type: 'progress', text: 'Resolving fonts…' });
  const available = (await figma.listAvailableFontsAsync()).map((f) => f.fontName);
  const plan = buildPlan(doc, available);
  plan.root.width = Math.max(plan.root.width, 1);
  plan.root.height = Math.max(plan.root.height, 1);

  // Snapshot positions before creating the root (createFrame appends to the page).
  const existing = figma.currentPage.children.map((n) => ({ x: n.x, width: n.width }));
  post({ type: 'progress', text: `Creating ${plan.counts.total} layers…` });
  const outcome = await executePlan(plan, {
    rootName: rootFrameName(doc.meta),
    rootX: placementX(existing),
    onProgress: (done, total) =>
      post({ type: 'progress', text: `Creating layers ${done} / ${total}…` }),
  });

  figma.currentPage.selection = [outcome.root];
  figma.viewport.scrollAndZoomIntoView([outcome.root]);
  post({
    type: 'rendered',
    report: {
      rootName: outcome.root.name,
      layersCreated: outcome.layersCreated,
      layersFailed: outcome.layersFailed,
      durationMs: Date.now() - started,
      fontSubstitutions: plan.substitutions,
      fontsFallback: outcome.fontsFallback,
      placeholders: plan.counts.placeholders,
      unsupported: plan.unsupported,
      captureWarnings: doc.meta.warnings.length,
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
