/** node --test spikes/figma-svg/svg.test.mjs : the serializer copies plan geometry and encodes RTL as chosen. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlan } from '../../packages/figma-plugin/src/plan/plan.ts';
import { KNOWN_FIGMA_FONTS } from '../../packages/figma-plugin/src/config/known-figma-fonts.ts';
import { testDoc } from '../figma-official/testdoc.ts';
import { fontFamilyList, planToSvg, styleToCss } from './svg.mjs';

const measure = {
  metrics: ({ size }) => ({ ascent: size * 0.9, descent: size * 0.3 }),
  lines: (t) => [t.characters],
};

test('V1: frame, rounded rectangle and left-anchored text at plan coordinates', () => {
  const { svg, stats } = planToSvg(buildPlan(testDoc('v1'), KNOWN_FIGMA_FONTS), measure);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="400" height="300"/);
  assert.match(svg, /<rect id="Rectangle" x="20" y="20" width="120" height="80" rx="8" fill="rgb\(51,102,255\)"\/>/);
  // top = 140 + (32 - 28.8) / 2 = 141.6; Figma target: y = top + font-size 24 = 165.6
  assert.match(svg, /font-family="Inter-Regular, Inter"[^>]*text-anchor="start"[^>]*><tspan x="20" y="165.6">Hello world<\/tspan>/);
  // browser target: y = top + ascent 21.6 = 163.2
  const b = planToSvg(buildPlan(testDoc('v1'), KNOWN_FIGMA_FONTS), measure, { target: 'browser' }).svg;
  assert.match(b, /<tspan x="20" y="163.2">Hello world/);
  assert.deepEqual(stats, { boxes: 2, texts: 1, placeholders: 0, lines: 1 });
});

test('V2 Arabic: default physical anchors (Figma); direction mode anchors "start" at the right edge', () => {
  const plan = buildPlan(testDoc('v2'), KNOWN_FIGMA_FONTS);
  const p = planToSvg(plan, measure).svg;
  assert.match(p, /text-anchor="end"[^>]*><tspan x="380"[^>]*>مرحبا بالعالم</);
  assert.doesNotMatch(p, /direction=|\u200F/);
  const a = planToSvg(plan, measure, { rtl: 'direction' }).svg;
  assert.match(a, /text-anchor="start" direction="rtl"[^>]*><tspan x="380"/);
  const b = planToSvg(plan, measure, { rtl: 'marks' }).svg;
  assert.match(b, /text-anchor="end"[^>]*><tspan x="380"[^>]*>‏مرحبا بالعالم‏</);
  assert.doesNotMatch(b, /direction=/);
});

test('style names map to CSS weights', () => {
  assert.deepEqual(styleToCss('Semi Bold Italic'), { weight: 600, italic: true });
  assert.deepEqual(styleToCss('Extra Bold'), { weight: 800, italic: false });
  assert.deepEqual(styleToCss('Regular'), { weight: 400, italic: false });
  assert.equal(fontFamilyList({ family: 'Noto Sans Arabic', style: 'Semi Bold' }), 'NotoSansArabic-SemiBold, Noto Sans Arabic');
});
