/**
 * Builds the PoC clipboard payloads: spike test document (V1–V3) → validateCapture → buildPlan (unchanged) →
 * encodeClipboardHtml, using the schema from the user's own Figma copy (newest results/sample-*.local.json).
 * Output: results/payloads.local.json (gitignored: contains Figma's schema bytes).
 * Usage: node build-payloads.mjs [fileKey]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBinarySchema } from 'kiwi-schema';
import { validateCapture } from '../../packages/schema/src/validate.ts';
import { buildPlan } from '../../packages/figma-plugin/src/plan/plan.ts';
import { KNOWN_FIGMA_FONTS } from '../../packages/figma-plugin/src/config/known-figma-fonts.ts';
import { testDoc, VARIANTS } from '../figma-official/testdoc.ts';
import { decompress, extractBuffer, parseContainer } from './decode.mjs';
import { encodeClipboardHtml } from './encode.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const results = join(here, 'results');

export function loadFormat() {
  const samples = readdirSync(results)
    .filter((f) => /^sample-.*\.local\.json$/.test(f))
    .map((f) => ({ f, html: JSON.parse(readFileSync(join(results, f), 'utf8')).html }))
    .filter((s) => extractBuffer(s.html))
    .sort((a, b) => (a.f < b.f ? 1 : -1));
  if (!samples.length) throw new Error('no Figma copy sample with a (figma) buffer in results/');
  const c = parseContainer(extractBuffer(samples[0].html));
  return {
    source: samples[0].f,
    version: c.version,
    schemaChunk: c.chunks[0],
    schema: decodeBinarySchema(new Uint8Array(decompress(c.chunks[0]).data)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fileKey = process.argv[2];
  const fmt = loadFormat();
  const payloads = {};
  for (const v of VARIANTS) {
    const doc = testDoc(v);
    if (!validateCapture(doc).ok) throw new Error(`${v}: invalid test document`);
    const plan = buildPlan(doc, KNOWN_FIGMA_FONTS);
    for (const mode of ['nofile', 'observed', ...(fileKey ? ['file'] : [])]) {
      const r = encodeClipboardHtml(fmt, plan, {
        ...(mode === 'file' ? { fileKey } : {}),
        textFields: mode === 'observed' ? 'observed' : 'minimal',
      });
      payloads[`${v}-${mode}`] = { html: r.html, text: plan.root.children.find((n) => n.kind === 'text')?.characters ?? '', bytes: r.bytes, skipped: r.skipped };
      console.log(`${v}-${mode}: ${r.bytes} B clipboard HTML (buffer ${r.bufferBytes} B), skipped: ${r.skipped.join(', ') || 'none'}`);
    }
  }
  writeFileSync(join(results, 'payloads.local.json'), JSON.stringify({ format: { source: fmt.source, version: fmt.version }, payloads }));
}
