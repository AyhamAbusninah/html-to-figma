#!/usr/bin/env node
/**
 * Generates s4a/kit.html: the operator kit for building the S4-A layers in Figma Web.
 * Every string comes from spikes/s4-rtl/code.js (matrix.mjs), with copy buttons so invisible characters
 * (RLM U+200F, ZWNJ U+200C) reach Figma exactly.   Usage: node spikes/s4-rtl/s4a/make-kit.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bidiRows, codepoints, fontKey, frameName, loadMatrix, shapingRows } from './matrix.mjs';

const m = loadMatrix();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
let copyId = 0;
const strings = [];
const copyBtn = (text) => {
  strings.push(text);
  return `<button class="copy" data-i="${copyId++}">Copy</button>`;
};

function bidiSection(font, variant) {
  const rows = bidiRows(m, variant)
    .map(
      (r, i) => `<tr><td>${i + 1}</td><td>${r.caseId}${variant === 'rlm' ? ' <span class="tag">+ invisible RLM</span>' : ''}</td><td>${r.firstStrong}</td>
      <td class="pv" style="font-family:'${font}'" dir="rtl">${esc(r.referenceText)}</td>
      <td>${copyBtn(r.text)}</td><td class="cp">${codepoints(r.text).split(' ').slice(0, 2).join(' ')}…</td></tr>`,
    )
    .join('');
  return `<section><h3>Frame <code>${frameName(font, variant)}</code></h3>
  <table><tr><th>#</th><th>Case</th><th>1st strong</th><th>Text (preview)</th><th></th><th>starts with</th></tr>${rows}</table></section>`;
}

function shapingSection(font) {
  const rows = shapingRows(m)
    .map(
      (r, i) => `<tr><td>${i + 1}</td><td>${r.caseId} ${r.form}</td>
      <td class="pv" style="font-family:'${font}'" dir="rtl">${esc(r.text)}</td><td>${copyBtn(r.text)}</td>
      <td class="cp">${codepoints(r.text)}</td></tr>`,
    )
    .join('');
  return `<section><h3>Frame <code>${frameName(font, 'shaping')}</code></h3>
  <table><tr><th>#</th><th>Row</th><th>Text</th><th></th><th>Code points</th></tr>${rows}</table></section>`;
}

function visualSection(font) {
  const rows = m.VISUAL_CASES.map((v, i) => {
    const cfg = v.width
      ? `Fixed width <b>${v.width}</b>, auto height, align <b>right</b>`
      : v.letterSpacing
        ? `Auto width, letter spacing <b>${v.letterSpacing} px</b>`
        : `Auto width, weight <b>Bold</b>`;
    return `<tr><td>${i + 1}</td><td>${v.id}</td><td>${cfg}</td><td class="pv" style="font-family:'${font}'${v.bold ? ';font-weight:700' : ''}" dir="rtl">${esc(v.text)}</td><td>${copyBtn(v.text)}</td></tr>`;
  }).join('');
  return `<section><h3>Frame <code>${frameName(font, 'visual')}</code> <small>(visual-only, inspected by eye)</small></h3>
  <table><tr><th>#</th><th>Case</th><th>Layer settings (otherwise as base)</th><th>Text</th><th></th></tr>${rows}</table></section>`;
}

const fontsCss = m.ARABIC_FONTS.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;700`).join('&');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>S4-A operator kit</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fontsCss}&display=block">
<style>
:root{color-scheme:light;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--accent:#0969da}
body{margin:0 auto;max-width:1100px;padding:24px 16px 64px;font:14px/1.5 system-ui,sans-serif;color:var(--fg);background:#fff}
h1{font-size:22px;margin:0 0 4px} h2{margin-top:36px;border-bottom:1px solid var(--line);padding-bottom:4px} h3{margin:24px 0 8px;font-size:15px}
table{border-collapse:collapse;width:100%} td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:middle}
th{font-size:12px;color:var(--muted);font-weight:600} .pv{font-size:22px} .cp{font:12px ui-monospace,monospace;color:var(--muted)}
.tag{font:11px system-ui;background:#fff8c5;border:1px solid #d4a72c;border-radius:4px;padding:0 4px;margin-left:6px}
button.copy{font:inherit;padding:4px 12px;border:1px solid var(--accent);color:var(--accent);background:#fff;border-radius:6px;cursor:pointer}
button.copy.done{background:var(--accent);color:#fff} code{background:#f6f8fa;padding:1px 4px;border-radius:4px}
.cfg td:first-child{color:var(--muted);width:280px} ol li{margin:6px 0} .warn{background:#fff8c5;border:1px solid #d4a72c;border-radius:8px;padding:10px 14px}
</style></head><body>
<h1>S4-A operator kit: Figma Web (Fedora)</h1>
<p>Spike S4 matrix v${m.SPIKE_VERSION}, generated from <code>spikes/s4-rtl/code.js</code>. Build the frames below in a
<b>draft file in Figma Web</b>, export them, and run <code>node spikes/s4-rtl/s4a/classify.mjs &lt;export.zip&gt;</code>.</p>
<p class="warn"><b>Scope:</b> S4-A tests Figma's text engine on text created in the <b>editor UI</b>. It does <b>not</b> test text created by
the Plugin API (that is S4-B). Use the <b>Copy</b> buttons and don't type strings by hand: several contain invisible characters.</p>

<h2>1. Base text-layer settings (all layers unless a row says otherwise)</h2>
<table class="cfg">
<tr><td>Font family</td><td>per frame: ${m.ARABIC_FONTS.join(' · ')}</td></tr>
<tr><td>Style</td><td>Regular</td></tr>
<tr><td>Font size</td><td><b>${m.FONT_SIZE}</b></td></tr>
<tr><td>Line height</td><td><b>${m.LINE_HEIGHT} px</b> (pixels, not %)</td></tr>
<tr><td>Letter spacing</td><td>0</td></tr>
<tr><td>Fill</td><td>default black (#000000, 100%)</td></tr>
<tr><td>Bidi frames (asIs / rlm)</td><td>text align <b>Right</b>, resizing <b>Fixed width = ${m.BOX_W}</b> (auto height). Every row must stay on <b>one line</b> (height ${m.LINE_HEIGHT}).</td></tr>
<tr><td>Shaping frames</td><td>text align <b>Left</b>, resizing <b>Auto width</b></td></tr>
<tr><td>Frames</td><td>Auto layout <b>vertical</b>, gap <b>0</b>, padding <b>0</b>, <b>no fill</b> (transparent), names exactly as shown</td></tr>
</table>

<h2>2. Procedure (about 25–35 min)</h2>
<ol>
<li>Figma Web → new <b>draft</b> design file. Record your browser name and version (needed for the report).</li>
<li><b>First bidi frame</b> (<code>${frameName(m.ARABIC_FONTS[0], 'asIs')}</code>): press <b>T</b>, click the canvas, paste row 1 (Copy → Ctrl+V), press Esc.
Apply the base settings above (font ${m.ARABIC_FONTS[0]}, ${m.FONT_SIZE}/${m.LINE_HEIGHT}px, Right, Fixed width ${m.BOX_W}).</li>
<li>With the layer selected press <b>Shift+A</b> (auto layout). Set vertical, gap 0, padding 0, remove the frame fill, and rename the frame.</li>
<li>Select the text layer and press <b>Ctrl+D</b> 9 times (10 rows). For rows 2–10: double-click the row, <b>Ctrl+A</b>, paste the matching string. Keep row order = table order.</li>
<li>Duplicate the frame (Ctrl+D on the frame), rename it <code>${frameName(m.ARABIC_FONTS[0], 'rlm')}</code>, and replace all 10 texts with the <b>RLM</b> strings (rows look identical; the RLM is invisible).</li>
<li>Duplicate both frames for each other font: select the frame, press <b>Enter</b> (selects its text layers), change the <b>font family</b>, rename the frame.</li>
<li><b>Shaping frames</b>: same approach with 6 rows per font, <b>Left</b> aligned, <b>Auto width</b>.</li>
<li><b>Visual frames</b>: 3 layers per font with the per-row settings (V1 fixed width 360 / V2 letter spacing 4 px / V3 Bold).</li>
<li>Check: every bidi frame is <b>${m.BOX_W} × ${m.LINE_HEIGHT * m.BIDI_CASES.length}</b>, and no row wraps to two lines.</li>
<li>Select all ${m.ARABIC_FONTS.length * 4} frames → Export: <b>PNG, 2x</b> → <b>Export</b>. You get one zip with one PNG per frame, named after the frame.</li>
<li>Copy the zip to this machine and run <code>node spikes/s4-rtl/s4a/classify.mjs ~/Downloads/&lt;zip&gt; --browser "&lt;browser + version&gt;"</code>.</li>
</ol>

<h2>3. Frames and strings</h2>
${m.ARABIC_FONTS.map((f) => `<h2 style="margin-top:28px">${f}</h2>${bidiSection(f, 'asIs')}${bidiSection(f, 'rlm')}${shapingSection(f)}${visualSection(f)}`).join('\n')}

<script>
const STRINGS = ${JSON.stringify(strings)};
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button.copy'); if (!b) return;
  const text = STRINGS[Number(b.dataset.i)];
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  b.classList.add('done'); b.textContent = 'Copied';
  setTimeout(() => { b.classList.remove('done'); b.textContent = 'Copy'; }, 1500);
});
</script>
</body></html>
`;

const out = fileURLToPath(new URL('./kit.html', import.meta.url));
writeFileSync(out, html);
console.log(`[make-kit] wrote ${out} (${strings.length} copy buttons, fonts: ${m.ARABIC_FONTS.map(fontKey).join(', ')})`);
