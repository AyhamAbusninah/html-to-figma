/**
 * Route B input: test document → validateCapture → buildPlan (unchanged plugin planner) → renderPlanHtml (unchanged
 * preview renderer) → one self-contained HTML page per variant, plus the plan as JSON for compare.ts.
 * Run: node spikes/figma-official/make-html.ts   (Node ≥ 22.18 strips types natively)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCapture } from '../../packages/schema/src/validate.ts';
import { buildPlan } from '../../packages/figma-plugin/src/plan/plan.ts';
import { KNOWN_FIGMA_FONTS } from '../../packages/figma-plugin/src/config/known-figma-fonts.ts';
import { fontStylesheets, renderPlanHtml } from '../../packages/preview/src/render.ts';
import { testDoc, VARIANTS } from './testdoc.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });

for (const v of VARIANTS) {
  const doc = testDoc(v);
  const res = validateCapture(doc);
  if (!res.ok) throw new Error(`${v}: invalid test document: ${JSON.stringify(res)}`);
  const plan = buildPlan(doc, KNOWN_FIGMA_FONTS);
  const fonts = fontStylesheets(plan)
    .map((u) => `<link rel="stylesheet" href="${u.replace(/&/g, '&amp;')}">`)
    .join('\n');
  const html = `<!doctype html>
<html lang="${doc.meta.lang}" dir="${doc.meta.direction}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${doc.meta.title}</title>
${fonts}
${process.argv.includes('--figma-capture') ? '<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>' : ''}
<style>
html,body{margin:0;padding:0;background:#fff}
body{position:relative;width:${plan.root.width}px;height:${plan.root.height}px}
.n{position:absolute;box-sizing:border-box;margin:0}
.n.text{overflow:visible}
.stroke{position:absolute;inset:0;box-sizing:border-box;border-radius:inherit;pointer-events:none}
</style>
</head>
<body>
${renderPlanHtml(plan)}
</body>
</html>
`;
  writeFileSync(join(out, `${v}.html`), html);
  writeFileSync(join(out, `${v}.plan.json`), JSON.stringify(plan, null, 2));
  console.log(`${v}: ${plan.counts.total} nodes, fonts ${plan.fonts.map((f) => `${f.family} ${f.style}`).join(', ')}, ${html.length} B`);
}
