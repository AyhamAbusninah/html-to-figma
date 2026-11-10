/**
 * Route C inputs: render plans (unchanged buildPlan) for
 *   - the shared spike test document V1–V3 (frame + rectangle + Latin / Arabic / mixed text), and
 *   - two real captures of fixture pages (made with the built extension content script, 1280 px wide).
 * Writes out/index.json, out/<id>.plan.json and out/<id>.page.png (page screenshots, fixture pages only).
 * Run from the repo root after `pnpm build`: node spikes/figma-svg/build.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { validateCapture } from '../../packages/schema/src/validate.ts';
import type { CaptureDocument } from '../../packages/schema/src/schema.ts';
import { buildPlan } from '../../packages/figma-plugin/src/plan/plan.ts';
import { KNOWN_FIGMA_FONTS } from '../../packages/figma-plugin/src/config/known-figma-fonts.ts';
import { fontStylesheets } from '../../packages/preview/src/render.ts';
import { testDoc, VARIANTS } from '../figma-official/testdoc.ts';
// @ts-expect-error: plain ESM module without type declarations
import { start } from '../../fixtures/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const PAGES = ['rtl-arabic.html', 'landing-page.html'];

const index: { id: string; label: string; fonts: string[]; nodes: number; width: number; height: number }[] = [];
function add(id: string, label: string, doc: CaptureDocument) {
  const v = validateCapture(doc);
  if (!v.ok) throw new Error(`${id}: invalid CaptureDocument`);
  const plan = buildPlan(doc, KNOWN_FIGMA_FONTS);
  writeFileSync(join(out, `${id}.plan.json`), JSON.stringify(plan));
  index.push({ id, label, fonts: fontStylesheets(plan), nodes: plan.counts.total, width: plan.root.width, height: plan.root.height });
  console.log(`${id}: ${plan.counts.total} nodes (${plan.counts.texts} text, ${plan.counts.placeholders} placeholders)`);
}

for (const v of VARIANTS) add(v, `Test ${v.toUpperCase()}`, testDoc(v));

const fixtures = await start({ quiet: true, ports: { main: 0, second: 0, third: 0 } });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  for (const name of PAGES) {
    await page.goto(`${fixtures.origins.main}/pages/${name}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.addScriptTag({ path: join(repo, 'packages/extension/dist/content.js') });
    const r = (await page.evaluate(() =>
      (globalThis as unknown as { __h2fCapture: () => Promise<unknown> }).__h2fCapture(),
    )) as { ok: boolean; document: CaptureDocument; message?: string };
    if (!r.ok) throw new Error(`${name}: capture failed: ${r.message}`);
    const id = name.replace('.html', '');
    await page.screenshot({ path: join(out, `${id}.page.png`), fullPage: true });
    add(id, `Page ${name}`, r.document);
  }
} finally {
  await browser.close();
  await fixtures.close();
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2));
