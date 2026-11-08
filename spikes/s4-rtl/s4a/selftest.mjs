#!/usr/bin/env node
/**
 * S4-A pipeline self-test with synthetic "Figma-like" frame exports of KNOWN ground truth.
 * Validates slicing, the input adapter, the order check, geometry rejection and the unchanged classifier/verdict.
 * Not evidence about Figma (it uses no Figma data).
 *   node spikes/s4-rtl/s4a/selftest.mjs [--keep]
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { bidiRows, frameName, loadMatrix, shapingRows } from './matrix.mjs';
import { runS4A } from './pipeline.mjs';

const m = loadMatrix();
const SIZE_DELTA = 0.6; // px, mimics Figma vs Chromium metric differences
const OFFSET = 3; // px

/** Expected class for a row under a scenario. */
function behaviour(scenario, firstStrong, variant) {
  if (scenario === 'C') return 'nobidi';
  if (scenario === 'B') return 'rtl';
  return firstStrong === 'L' && variant === 'asIs' ? 'ltr' : 'rtl';
}
const CLASS = { rtl: 'RTL', ltr: 'LTR_BASE', nobidi: 'NO_BIDI' };

async function makeExports(dir, scenario, { opaque, swapRows = false, badGeometry = false }) {
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage();
  const fontsCss = m.ARABIC_FONTS.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;700`).join('&');
  await page.setContent(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fontsCss}&display=block">`);
  await page.evaluate(async (fonts) => {
    for (const f of fonts) await document.fonts.load(`400 28px "${f}"`, 'بسم abc');
  }, m.ARABIC_FONTS);

  for (const font of m.ARABIC_FONTS) {
    for (const variant of ['asIs', 'rlm']) {
      let rows = bidiRows(m, variant).map((r) => ({ text: r.text, mode: behaviour(scenario, r.firstStrong, variant) }));
      if (swapRows && font === m.ARABIC_FONTS[0] && variant === 'asIs') [rows[1], rows[3]] = [rows[3], rows[1]];
      if (badGeometry && font === m.ARABIC_FONTS[1] && variant === 'rlm') rows = rows.slice(0, 9);
      const png = await page.evaluate(
        ({ rows, font, W, LH, FS, opaque, sizeDelta, offset }) => {
          const c = document.createElement('canvas');
          c.width = W * 2;
          c.height = LH * 2 * rows.length;
          const g = c.getContext('2d');
          if (opaque) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
          g.scale(2, 2);
          g.fillStyle = '#000';
          g.font = `400 ${FS + sizeDelta}px "${font}"`;
          g.textAlign = 'right';
          g.textBaseline = 'middle';
          rows.forEach((r, i) => {
            g.direction = r.mode === 'rtl' ? 'rtl' : 'ltr';
            g.fillText(r.mode === 'nobidi' ? '‭' + r.text + '‬' : r.text, W - offset, i * LH + LH / 2);
          });
          return c.toDataURL('image/png');
        },
        { rows, font, W: m.BOX_W, LH: m.LINE_HEIGHT, FS: m.FONT_SIZE, opaque, sizeDelta: SIZE_DELTA, offset: OFFSET },
      );
      writeFileSync(join(dir, `${frameName(font, variant)}.png`), Buffer.from(png.split(',')[1], 'base64'));
    }
    // Shaping frame: scenario C simulates "no shaping" by drawing isolated forms for the joined rows too.
    const sRows = shapingRows(m).map((r) => (scenario === 'C' && r.form === 'joined' ? { ...r, text: m.isolate(r.text) } : r));
    const spng = await page.evaluate(
      ({ rows, font, LH, FS, opaque }) => {
        const g0 = document.createElement('canvas').getContext('2d');
        g0.font = `400 ${FS}px "${font}"`;
        const w = Math.ceil(Math.max(...rows.map((r) => g0.measureText(r.text).width))) + 4;
        const c = document.createElement('canvas');
        c.width = w * 2;
        c.height = LH * 2 * rows.length;
        const g = c.getContext('2d');
        if (opaque) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
        g.scale(2, 2);
        g.fillStyle = '#000';
        g.font = `400 ${FS}px "${font}"`;
        g.textBaseline = 'middle';
        g.direction = 'rtl';
        g.textAlign = 'left';
        rows.forEach((r, i) => g.fillText(r.text, 0, i * LH + LH / 2));
        return c.toDataURL('image/png');
      },
      { rows: sRows, font, LH: m.LINE_HEIGHT, FS: m.FONT_SIZE, opaque },
    );
    writeFileSync(join(dir, `${frameName(font, 'shaping')}.png`), Buffer.from(spng.split(',')[1], 'base64'));
    // Visual frame: any image (inspection only).
    writeFileSync(join(dir, `${frameName(font, 'visual')}.png`), Buffer.from(spng.split(',')[1], 'base64'));
  }
  await browser.close();
}

function misclassified(report, scenario) {
  return report.bidi.filter((b) => {
    if (!b.confident || b.class === 'EMPTY' || b.orderMismatch) return false;
    const exp = CLASS[behaviour(scenario, b.firstStrong, b.variant)];
    if (!b.directionTestable && exp !== 'NO_BIDI' && b.class === 'RTL') return false; // RTL vs LTR not distinguishable
    return b.class !== exp;
  });
}

const root = mkdtempSync(join(tmpdir(), 's4a-selftest-'));
const cases = [
  { name: 'A-opaque', scenario: 'A', opaque: true, expect: 'A_RLM_WORKAROUND' },
  { name: 'A-transparent', scenario: 'A', opaque: false, expect: 'A_RLM_WORKAROUND' },
  { name: 'B-opaque', scenario: 'B', opaque: true, expect: 'B_NO_WORKAROUND_NEEDED' },
  { name: 'C-opaque', scenario: 'C', opaque: true, expect: 'C_ESCALATE' },
  { name: 'A-zip-swapped-badgeometry', scenario: 'A', opaque: true, expect: 'A_RLM_WORKAROUND', swapRows: true, badGeometry: true, zip: true },
];
const results = [];
let failed = 0;
for (const c of cases) {
  const inDir = join(root, c.name, 'in');
  await makeExports(inDir, c.scenario, c);
  let input = inDir;
  if (c.zip) {
    input = join(root, c.name, 'Figma Export.zip');
    execFileSync('zip', ['-q', '-j', input, ...m.ARABIC_FONTS.flatMap((f) => ['asIs', 'rlm', 'shaping', 'visual'].map((k) => join(inDir, `${frameName(f, k)}.png`)))]);
  }
  const report = await runS4A({ input, outDir: join(root, c.name, 'out'), browserLabel: 'synthetic', synthetic: true });
  const mis = misclassified(report, c.scenario);
  const checks = {
    outcome: report.verdict.r5Outcome.startsWith(c.expect),
    noMisclassification: mis.length === 0,
    geometry: c.badGeometry ? report.errors.some((e) => e.code === 'GEOMETRY') : report.errors.length === 0,
    orderCheck: c.swapRows ? report.summary.orderMismatches === 2 : report.summary.orderMismatches === 0,
  };
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failed++;
  results.push({ case: c.name, ok, outcome: report.verdict.r5Outcome.split(' ')[0], shaping: report.verdict.shaping, rows: report.summary.bidiRows, lowConf: report.summary.lowConfidence, mis: mis.map((b) => `${b.key}:${b.class}`), checks });
}
console.table(results.map(({ checks, mis, ...r }) => ({ ...r, misclassified: mis.length, failedChecks: Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(',') || '-' })));
if (!process.argv.includes('--keep')) rmSync(root, { recursive: true, force: true });
else console.log(`[selftest] kept outputs in ${root}`);
console.log(failed ? `[selftest] ${failed} case(s) FAILED` : '[selftest] all cases passed');
process.exit(failed ? 1 : 0);
