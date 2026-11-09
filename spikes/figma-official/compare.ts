/**
 * Geometry/fill comparison: RenderPlan (expected) vs nodes read back from real Figma (docs/spikes/figma-clipboard/evidence.json).
 * Boxes: x/y/w/h ±0.5 px, fill ±1/255, radius exact. Text: top ±0.5 px and the aligned edge (left for LEFT,
 * right for RIGHT) ±0.5 px; width is reported, not judged (Figma measures text with its own engine).
 * Run: node spikes/figma-official/compare.ts  → prints a table, writes docs/spikes/figma-clipboard/compare.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, type PlanBox, type PlanText } from '../../packages/figma-plugin/src/plan/plan.ts';
import { KNOWN_FIGMA_FONTS } from '../../packages/figma-plugin/src/config/known-figma-fonts.ts';
import { testDoc, VARIANTS } from './testdoc.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const evidencePath = join(repo, 'docs/spikes/figma-clipboard/evidence.json');
const ev = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
  routes: Record<string, Record<string, any>>;
};
const near = (a: number, b: number, t = 0.5) => Math.abs(a - b) <= t;
const rows: Record<string, unknown>[] = [];

for (const [route, variants] of Object.entries(ev.routes)) {
  for (const v of VARIANTS) {
    const got = variants[v];
    if (!got || got.missing) {
      rows.push({ route, v, result: 'NOT FOUND' });
      continue;
    }
    const plan = buildPlan(testDoc(v), KNOWN_FIGMA_FONTS);
    const rect = plan.root.children.find((n) => n.kind === 'rect') as PlanBox;
    const text = plan.root.children.find((n) => n.kind === 'text') as PlanText;
    const f = rect.fills[0]!.color;
    const boxOk =
      near(got.rect.x, rect.x) &&
      near(got.rect.y, rect.y) &&
      near(got.rect.w, rect.width) &&
      near(got.rect.h, rect.height) &&
      near(got.rect.fill[0], f.r, 1 / 255) &&
      near(got.rect.fill[1], f.g, 1 / 255) &&
      near(got.rect.fill[2], f.b, 1 / 255) &&
      got.rect.radius === rect.radii?.tl;
    const edgeExpected = text.anchor === 'right' ? text.x + text.width : text.x;
    const edgeGot = text.anchor === 'right' ? got.text.x + got.text.w : got.text.x;
    const textGeomOk = near(got.text.y, text.y) && near(edgeGot, edgeExpected);
    const fontOk = got.text.font === `${text.font.family} ${text.font.style}`;
    rows.push({
      route,
      v,
      rectType: got.rect.type,
      rectGeometryFill: boxOk ? 'PASS' : 'FAIL',
      textType: got.text.type,
      textTopAndEdge: textGeomOk ? 'PASS' : `FAIL (top ${got.text.y} vs ${text.y}, edge ${edgeGot} vs ${edgeExpected})`,
      textWidth: `${got.text.w} (captured ${text.width})`,
      font: fontOk ? 'PASS' : `FAIL (${got.text.font})`,
      visibleWithoutClick: got.text.visibleWithoutClick ? 'yes' : 'NO',
    });
  }
}
console.table(rows);
writeFileSync(join(repo, 'docs/spikes/figma-clipboard/compare.json'), JSON.stringify(rows, null, 2) + '\n');
