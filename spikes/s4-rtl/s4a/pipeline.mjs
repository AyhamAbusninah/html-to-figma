/**
 * S4-A analysis pipeline. Classifies Figma Web frame exports with the UNCHANGED S4 classifier.
 *
 * The real spikes/s4-rtl/ui.html is loaded in Playwright's Chromium, and its own functions are called
 * (loadFonts, renderCanvas, profileOf, ncc, classify, verdict). Nothing here re-implements classification.
 * Additions, all documented in the report:
 *   - input adapter: frame PNG → per-row "ink" canvas (composite over white, ink = 255 − luminance as alpha), because
 *     Figma frame exports may be opaque while the classifier reads ink from alpha;
 *   - row slicing: a bidi frame holds 10 rows of LINE_HEIGHT px (×2 export scale);
 *   - shaping metric: ink-extent width per row (S4-B uses TextNode.width, not available from an image export).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { bidiRows, frameName, loadMatrix, shapingRows, UI_HTML } from './matrix.mjs';

const SCALE = 2;

const BROWSER_HELPERS = `
window.s4a = {
  async decode(b64) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0); return c;
  },
  /** Region of src → canvas whose alpha = ink (composite over white; ink = 255 - luminance), rgb = 0. */
  inkCanvas(src, y, h) {
    const w = src.width, d = src.getContext('2d').getImageData(0, y, w, h).data;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const ctx = out.getContext('2d'), img = ctx.createImageData(w, h);
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      const r = d[i] * a + 255 * (1 - a), g = d[i + 1] * a + 255 * (1 - a), b = d[i + 2] * a + 255 * (1 - a);
      img.data[i + 3] = Math.round(255 - (0.2126 * r + 0.7152 * g + 0.0722 * b));
    }
    ctx.putImageData(img, 0, 0); return out;
  },
  /** Horizontal ink extent in px (columns whose ink sum exceeds a small threshold). */
  inkExtent(canvas) {
    const { width, height } = canvas, d = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    let first = -1, last = -1;
    for (let x = 0; x < width; x++) {
      let col = 0; for (let y = 0; y < height; y++) col += d[(y * width + x) * 4 + 3];
      if (col > 255) { if (first < 0) first = x; last = x; }
    }
    return first < 0 ? 0 : last - first + 1;
  },
  /** Black-on-white strip for visual sheets. */
  whiteStrip(inkCanvas) {
    const c = document.createElement('canvas'); c.width = inkCanvas.width; c.height = inkCanvas.height;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(inkCanvas, 0, 0); return c;
  },
};`;

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Copies the PNG exports (dir or zip) into outDir/exports, preserving the original files as evidence. */
export function collectExports(input, outDir) {
  const exportsDir = join(outDir, 'exports');
  mkdirSync(exportsDir, { recursive: true });
  if (statSync(input).isFile() && input.endsWith('.zip')) {
    copyFileSync(input, join(outDir, basename(input)));
    execFileSync('unzip', ['-o', '-j', '-q', input, '*.png', '-d', exportsDir]);
  } else {
    for (const f of readdirSync(input)) if (f.toLowerCase().endsWith('.png')) copyFileSync(join(input, f), join(exportsDir, f));
  }
  return exportsDir;
}

/** Finds `<frame>.png` tolerating Figma's export suffixes (e.g. "S4A-Cairo-rlm@2x.png", "S4A-Cairo-rlm 1.png"). */
function findExport(exportsDir, name) {
  const files = readdirSync(exportsDir);
  const exact = files.find((f) => f === `${name}.png`);
  if (exact) return join(exportsDir, exact);
  const loose = files.find((f) => f.replace(/(@\dx)?( \d+)?\.png$/i, '') === name);
  return loose ? join(exportsDir, loose) : null;
}

export async function runS4A({ input, outDir, browserLabel = 'unspecified', operator = 'unspecified', synthetic = false }) {
  const m = loadMatrix();
  mkdirSync(outDir, { recursive: true });
  const exportsDir = collectExports(input, outDir);
  const box = { w: m.BOX_W, h: m.LINE_HEIGHT, fontSize: m.FONT_SIZE };
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(pathToFileURL(UI_HTML).href);
  await page.addScriptTag({ content: BROWSER_HELPERS });
  const fontLoad = await page.evaluate(async (fonts) => {
    state.fontLoad = await loadFonts(fonts, 28); // ui.html's own function and state
    for (const f of fonts) await document.fonts.load(`700 28px "${f}"`, 'بسم abc');
    return state.fontLoad;
  }, m.ARABIC_FONTS);

  const report = {
    spike: 'S4-A',
    method:
      'Figma Web editor UI (manual layer creation) → frame PNG export @2x → unchanged S4 classifier (spikes/s4-rtl/ui.html) in Chromium',
    validatesPluginApi: false,
    synthetic,
    spikeMatrixVersion: m.SPIKE_VERSION,
    createdAt: new Date().toISOString(),
    environment: {
      figmaBrowser: browserLabel,
      operator,
      referenceRenderer: `Chromium ${browser.version()} (Playwright)`,
      os: `${process.platform} ${process.arch}`,
      node: process.version,
    },
    params: { fontSize: m.FONT_SIZE, lineHeight: m.LINE_HEIGHT, boxWidth: m.BOX_W, exportScale: SCALE, fonts: m.ARABIC_FONTS },
    adaptations: [
      'Creation path: Figma Web editor UI instead of Plugin API (the defining S4-A limitation)',
      'Export: one PNG per frame (rows sliced at LINE_HEIGHT×2) instead of TextNode.exportAsync per node',
      'Input adapter: composite over white, ink = 255 − luminance, so opaque or transparent exports both work',
      'Shaping metric: ink-extent width per row instead of TextNode.width (same thresholds S1 < 0.85, S3 < 0.92)',
    ],
    inputs: {},
    errors: [],
    fontLoadReference: fontLoad,
    shaping: [],
    bidi: [],
  };

  mkdirSync(join(outDir, 'sheets'), { recursive: true });
  for (const font of m.ARABIC_FONTS) {
    // ── Bidi frames ──────────────────────────────────────────────────────────────────────────────────────────
    for (const variant of ['asIs', 'rlm']) {
      const name = frameName(font, variant);
      const file = findExport(exportsDir, name);
      if (!file) {
        report.errors.push({ frame: name, code: 'MISSING_EXPORT' });
        continue;
      }
      report.inputs[name] = { file: basename(file), sha256: sha256(file) };
      const rows = bidiRows(m, variant);
      const res = await page.evaluate(
        async ({ b64, rows, cases, font, box, scale }) => {
          const src = await s4a.decode(b64);
          const want = { w: box.w * scale, h: box.h * scale * rows.length };
          if (src.width !== want.w || src.height !== want.h) return { geometryError: { got: [src.width, src.height], want: [want.w, want.h] } };
          const refs = {};
          for (const c of cases) {
            refs[c.id] = {
              rtl: profileOf(renderCanvas(c.text, font, 'rtl', box)).prof,
              ltr: profileOf(renderCanvas(c.text, font, 'ltr', box)).prof,
              nobidi: profileOf(renderCanvas('‭' + c.text + '‬', font, 'ltr', box)).prof,
            };
          }
          const out = [], strips = [];
          rows.forEach((row, i) => {
            const ink = s4a.inkCanvas(src, i * box.h * scale, box.h * scale);
            const { prof, ink: total } = profileOf(ink);
            // Order check: which case does this row resemble most?
            let bestCase = null, bestScore = -2;
            for (const c of cases) {
              const s = Math.max(ncc(prof, refs[c.id].rtl), ncc(prof, refs[c.id].ltr), ncc(prof, refs[c.id].nobidi));
              if (s > bestScore) { bestScore = s; bestCase = c.id; }
            }
            const cls = total === 0 ? { class: 'EMPTY', confident: true } : classify(prof, refs[row.caseId]);
            out.push({ row: i + 1, ...cls, detectedCase: total === 0 ? null : bestCase, inkTotal: total });
            const mk = (txt, dir) => s4a.whiteStrip(renderCanvas(txt, font, dir, box));
            strips.push([s4a.whiteStrip(ink), mk(row.referenceText, 'rtl'), mk(row.referenceText, 'ltr'), mk('‭' + row.referenceText + '‬', 'ltr')]);
          });
          // Contact sheet: columns Figma | RTL (correct) | LTR_BASE | NO_BIDI, at 50%.
          const cw = box.w, ch = box.h, labelW = 300, headH = 28;
          const sheet = document.createElement('canvas');
          sheet.width = labelW + cw * 4; sheet.height = headH + rows.length * (ch + 8);
          const g = sheet.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, sheet.width, sheet.height);
          g.fillStyle = '#333'; g.font = '13px sans-serif';
          ['Figma Web export', 'Chromium RTL (correct)', 'LTR_BASE reference', 'NO_BIDI reference'].forEach((t, k) => g.fillText(t, labelW + k * cw + 6, 18));
          strips.forEach((s, i) => {
            const y = headH + i * (ch + 8), r = out[i];
            g.fillStyle = r.class === 'RTL' ? '#1a7f37' : r.class === 'EMPTY' ? '#999' : '#cf222e';
            g.fillText(rows[i].caseId + '  ' + r.class + (r.confident ? '' : ' (low conf.)'), 6, y + 20);
            g.fillStyle = '#666'; g.font = '11px sans-serif';
            if (r.scores) g.fillText('RTL ' + r.scores.RTL + '  LTR ' + r.scores.LTR_BASE + '  NB ' + r.scores.NO_BIDI, 6, y + 38);
            g.font = '13px sans-serif';
            s.forEach((c, k) => { g.drawImage(c, labelW + k * cw, y, cw, ch); g.strokeStyle = '#ddd'; g.strokeRect(labelW + k * cw, y, cw, ch); });
          });
          return { rows: out, sheet: sheet.toDataURL('image/png') };
        },
        { b64: readFileSync(file).toString('base64'), rows, cases: m.BIDI_CASES, font, box, scale: SCALE },
      );
      if (res.geometryError) {
        report.errors.push({ frame: name, code: 'GEOMETRY', ...res.geometryError, note: 'frame size ≠ 10 single-line rows; not classified' });
        continue;
      }
      writeFileSync(join(outDir, 'sheets', `${name}.png`), Buffer.from(res.sheet.split(',')[1], 'base64'));
      res.rows.forEach((r, i) => {
        const row = rows[i];
        report.bidi.push({
          key: `${row.caseId}|${font}|${variant}`,
          caseId: row.caseId,
          font,
          variant,
          firstStrong: row.firstStrong,
          wrapped: false,
          ...r,
          orderMismatch: r.detectedCase !== null && r.detectedCase !== row.caseId,
        });
      });
    }

    // ── Shaping frame ────────────────────────────────────────────────────────────────────────────────────────
    const sName = frameName(font, 'shaping');
    const sFile = findExport(exportsDir, sName);
    if (!sFile) report.errors.push({ frame: sName, code: 'MISSING_EXPORT' });
    else {
      report.inputs[sName] = { file: basename(sFile), sha256: sha256(sFile) };
      const sRows = shapingRows(m);
      const widths = await page.evaluate(
        async ({ b64, n, rowH }) => {
          const src = await s4a.decode(b64);
          if (src.height !== n * rowH) return { geometryError: { got: [src.width, src.height], want: ['any', n * rowH] } };
          return { widths: Array.from({ length: n }, (_, i) => s4a.inkExtent(s4a.inkCanvas(src, i * rowH, rowH))) };
        },
        { b64: readFileSync(sFile).toString('base64'), n: sRows.length, rowH: m.LINE_HEIGHT * SCALE },
      );
      if (widths.geometryError) report.errors.push({ frame: sName, code: 'GEOMETRY', ...widths.geometryError });
      else {
        for (const c of m.SHAPING_CASES) {
          const j = sRows.findIndex((r) => r.caseId === c.id && r.form === 'joined');
          const iso = sRows.findIndex((r) => r.caseId === c.id && r.form === 'isolated');
          const jw = widths.widths[j] / SCALE, iw = widths.widths[iso] / SCALE;
          report.shaping.push({
            font,
            caseId: c.id,
            note: c.note,
            metric: 'ink-extent',
            joinedWidth: jw,
            isolatedWidth: iw,
            ratio: iw > 0 ? Math.round((jw / iw) * 1000) / 1000 : null,
          });
        }
      }
    }

    // ── Visual frame (inspection only) + Chromium reference rendering ────────────────────────────────────────
    const vName = frameName(font, 'visual');
    const vFile = findExport(exportsDir, vName);
    if (!vFile) report.errors.push({ frame: vName, code: 'MISSING_EXPORT' });
    else report.inputs[vName] = { file: basename(vFile), sha256: sha256(vFile) };
    await page.setContent(
      `<div id="v" style="display:inline-flex;flex-direction:column;background:#fff;font-family:'${font}';font-size:${m.FONT_SIZE}px;line-height:${m.LINE_HEIGHT}px" dir="rtl">` +
        m.VISUAL_CASES.map(
          (v) => `<div style="${v.width ? `width:${v.width}px;text-align:right;` : 'white-space:nowrap;'}${v.letterSpacing ? `letter-spacing:${v.letterSpacing}px;` : ''}${v.bold ? 'font-weight:700;' : ''}">${v.text.replace(/</g, '&lt;')}</div>`,
        ).join('') +
        '</div>',
    );
    await page.addStyleTag({ url: `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}:wght@400;700&display=block` });
    await page.evaluate(async (f) => { await document.fonts.load(`400 28px "${f}"`, 'بسم'); await document.fonts.load(`700 28px "${f}"`, 'بسم'); }, font);
    await page.locator('#v').screenshot({ path: join(outDir, 'sheets', `${vName}.chromium-reference.png`), scale: 'device' });
    await page.goto(pathToFileURL(UI_HTML).href);
    await page.addScriptTag({ content: BROWSER_HELPERS });
    await page.evaluate(async (fonts) => { state.fontLoad = await loadFonts(fonts, 28); }, m.ARABIC_FONTS);
  }

  // Rows that look like a different case (operator put them in the wrong position) are excluded from the verdict
  // and listed, never silently re-interpreted.
  report.excludedFromVerdict = report.bidi.filter((b) => b.orderMismatch).map((b) => b.key);
  const verdictRows = report.bidi.filter((b) => !b.orderMismatch);
  report.verdict = await page.evaluate(({ shaping, bidi }) => verdict({ shaping }, bidi), { shaping: report.shaping, bidi: verdictRows });
  report.summary = summarize(report);
  await browser.close();
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, 'report.md'), renderMarkdown(report));
  return report;
}

function summarize(r) {
  const count = (pred) => r.bidi.filter(pred).length;
  return {
    bidiRows: r.bidi.length,
    expectedBidiRows: r.params.fonts.length * 10 * 2,
    classes: Object.fromEntries(['RTL', 'LTR_BASE', 'NO_BIDI', 'EMPTY'].map((c) => [c, count((b) => b.class === c)])),
    lowConfidence: count((b) => !b.confident),
    orderMismatches: count((b) => b.orderMismatch),
    errors: r.errors.length,
  };
}

function renderMarkdown(r) {
  const v = r.verdict;
  const lines = [
    `# S4-A results${r.synthetic ? ' (SYNTHETIC SELF-TEST, not Figma data)' : ''}`,
    '',
    `> Proxy test of Figma's text engine on text created in the **editor UI**. **Does not validate the Plugin API** (S4-B).`,
    '',
    `| | |`,
    `|---|---|`,
    `| Figma browser | ${r.environment.figmaBrowser} |`,
    `| Operator | ${r.environment.operator} |`,
    `| Reference renderer | ${r.environment.referenceRenderer} |`,
    `| Matrix | spike v${r.spikeMatrixVersion}: ${r.params.fonts.join(', ')} · ${r.params.fontSize}px / LH ${r.params.lineHeight}px · box ${r.params.boxWidth} · export @${r.params.exportScale}x |`,
    `| Rows classified | ${r.summary.bidiRows} / ${r.summary.expectedBidiRows} · low confidence ${r.summary.lowConfidence} · order mismatches ${r.summary.orderMismatches} · errors ${r.summary.errors} |`,
    '',
    '## Verdict (computed by the unchanged S4 `verdict()`)',
    '',
    `| Item | Value |`,
    `|---|---|`,
    `| Shaping | ${v.shaping} |`,
    `| Bidi | ${v.bidi} |`,
    `| Base direction | ${v.baseDirection} |`,
    `| RLM fixes Latin-first | ${v.rlmFixesLatinFirst} |`,
    `| Reference fonts loaded | ${v.referenceFontsLoaded} |`,
    `| S4 outcome label | ${v.r5Outcome} |`,
    '',
    '_The outcome label wording comes from the S4 classifier. In S4-A it describes editor-UI text only._',
    '',
    '## Shaping (ink-extent width, px)',
    '',
    '| Font | Case | Joined | Isolated | Ratio |',
    '|---|---|---|---|---|',
    ...r.shaping.map((s) => `| ${s.font} | ${s.caseId} | ${s.joinedWidth} | ${s.isolatedWidth} | ${s.ratio} |`),
    '',
    '## Bidi / base direction (every row)',
    '',
    '| Case | 1st strong | Font | Variant | Class | Confident | Margin | RTL | LTR_BASE | NO_BIDI | Order |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...r.bidi.map(
      (b) =>
        `| ${b.caseId} | ${b.firstStrong} | ${b.font} | ${b.variant} | ${b.class} | ${b.confident ? 'yes' : 'no'} | ${b.margin ?? ''} | ${b.scores?.RTL ?? ''} | ${b.scores?.LTR_BASE ?? ''} | ${b.scores?.NO_BIDI ?? ''} | ${b.orderMismatch ? `⚠ looks like ${b.detectedCase}` : 'ok'} |`,
    ),
    '',
    '## Errors',
    '',
    r.errors.length ? r.errors.map((e) => `- ${JSON.stringify(e)}`).join('\n') : '- none',
    '',
    `Rows excluded from the verdict (order mismatch): ${r.excludedFromVerdict.length ? r.excludedFromVerdict.join(', ') : 'none'}`,
    '',
    '## Adaptations vs S4-B (disclosed)',
    '',
    ...r.adaptations.map((a) => `- ${a}`),
    '',
    '## Inputs (sha256)',
    '',
    ...Object.entries(r.inputs).map(([k, x]) => `- ${k}: \`${x.file}\` ${x.sha256}`),
    '',
  ];
  return lines.join('\n');
}

