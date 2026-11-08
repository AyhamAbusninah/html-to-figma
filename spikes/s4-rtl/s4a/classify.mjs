#!/usr/bin/env node
/**
 * S4-A classifier CLI.
 *   node spikes/s4-rtl/s4a/classify.mjs <figma-export.zip | dir-of-pngs> --browser "Firefox 145" [--operator "<name>"] [--out <dir>]
 * Default output: spikes/s4-rtl/results/s4a-<YYYY-MM-DD>/ (exports, contact sheets, report.json, report.md).
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runS4A } from './pipeline.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const input = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!input) {
  console.error('usage: classify.mjs <export.zip | png-dir> --browser "<browser + version>" [--operator <name>] [--out <dir>]');
  process.exit(2);
}
const day = new Date().toISOString().slice(0, 10);
const outDir = opt('out') ?? join(fileURLToPath(new URL('../results', import.meta.url)), `s4a-${day}`);

const report = await runS4A({ input, outDir, browserLabel: opt('browser') ?? 'unspecified', operator: opt('operator') ?? 'unspecified' });
const v = report.verdict;
console.log(`[s4a] rows ${report.summary.bidiRows}/${report.summary.expectedBidiRows} · classes ${JSON.stringify(report.summary.classes)} · low-conf ${report.summary.lowConfidence} · order mismatches ${report.summary.orderMismatches} · errors ${report.errors.length}`);
console.log(`[s4a] shaping=${v.shaping} bidi=${v.bidi} baseDirection=${v.baseDirection} rlmFixesLatinFirst=${v.rlmFixesLatinFirst}`);
console.log(`[s4a] report: ${join(outDir, 'report.md')}`);
if (report.errors.length) process.exitCode = 1;
