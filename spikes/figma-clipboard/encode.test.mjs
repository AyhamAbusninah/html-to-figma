/**
 * Spike-local test (node:test, not part of the repo's Vitest/CI): encode → decode round trip.
 * Needs a Figma copy sample in results/ (gitignored, the user's own data); skips when absent.
 * Run: node --test spikes/figma-clipboard/encode.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../../packages/figma-plugin/src/plan/plan.ts';
import { KNOWN_FIGMA_FONTS } from '../../packages/figma-plugin/src/config/known-figma-fonts.ts';
import { testDoc, VARIANTS } from '../figma-official/testdoc.ts';
import { decodeSample } from './decode.mjs';
import { encodeClipboardHtml, planToNodeChanges } from './encode.mjs';
import { loadFormat } from './build-payloads.mjs';

let fmt = null;
try {
  fmt = loadFormat();
} catch {
  /* no sample → skip */
}

for (const v of VARIANTS) {
  test(`round trip equals the plan: ${v}`, { skip: !fmt && 'no Figma copy sample in results/' }, () => {
    const plan = buildPlan(testDoc(v), KNOWN_FIGMA_FONTS);
    for (const textFields of ['minimal', 'observed']) {
      const { html } = encodeClipboardHtml(fmt, plan, { textFields });
      const r = decodeSample(html);
      assert.equal(r.stop, undefined);
      assert.equal(r.prelude, 'fig-kiwi');
      const nodes = r.message.nodeChanges.filter((n) => !['DOCUMENT', 'CANVAS'].includes(n.type));
      assert.deepEqual(
        nodes.map((n) => n.type),
        ['FRAME', 'ROUNDED_RECTANGLE', 'TEXT'],
      );
      const [frame, rect, text] = nodes;
      const pr = plan.root.children[0];
      const pt = plan.root.children[1];
      assert.deepEqual([frame.size.x, frame.size.y], [plan.root.width, plan.root.height]);
      assert.deepEqual([rect.transform.m02, rect.transform.m12, rect.size.x, rect.size.y], [pr.x, pr.y, pr.width, pr.height]);
      assert.equal(rect.rectangleTopLeftCornerRadius, pr.radii.tl);
      assert.ok(Math.abs(rect.fillPaints[0].color.b - pr.fills[0].color.b) < 1e-6);
      assert.equal(text.textData.characters, pt.characters);
      assert.deepEqual([text.transform.m02, text.transform.m12], [pt.x, pt.y]);
      assert.deepEqual(text.fontName.family, pt.font.family);
      assert.equal(text.textAlignHorizontal, pt.align);
      assert.equal(text.derivedTextData, undefined, 'no glyph layout is produced (the blocking gap)');
    }
  });
}

test('plan features outside PoC scope are reported, not silently dropped', () => {
  const plan = buildPlan(testDoc('v1'), KNOWN_FIGMA_FONTS);
  plan.root.children[0].effects = [{ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: 4, visible: true }];
  assert.deepEqual(planToNodeChanges(plan).skipped, ['n1: effects']);
});
