/**
 * Phase 2 Figma spike: can one SVG <text> become ONE multi-line Figma text layer (a paragraph you can edit and
 * re-wrap), and do group ids with spaces and "·" survive as layer names? Writes out/editing.json for
 * media.html?board=editing. Each paragraph cell has pink stripes where the page's lines are (24 px line height for
 * Inter 16, 28 px for Tajawal 18) and a dashed box for the paragraph width, so the result can be compared by eye.
 * Run: node spikes/figma-svg/editing.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const EN = ['Discover handcrafted leather bags made', 'for everyday use, with free shipping', 'across the GCC and easy returns.'];
const AR = ['اكتشف حقائب جلدية مصنوعة يدويًا', 'للاستخدام اليومي، مع شحن مجاني إلى', 'جميع دول الخليج وإرجاع سهل.'];
const W = 320; // paragraph width
const en = { font: 'font-family="Inter, sans-serif" font-size="16" font-weight="400"', size: 16, lh: 24, lines: EN, anchor: 'start' };
const ar = { font: 'font-family="Tajawal-Regular, Tajawal" font-size="18" font-weight="400"', size: 18, lh: 28, lines: AR, anchor: 'end' };
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const label = (x, y, t) =>
  `<text font-family="Inter-SemiBold, Inter" font-size="13" font-weight="600" fill="rgb(17,24,39)" xml:space="preserve"><tspan x="${x}" y="${y}">${esc(t)}</tspan></text>`;
/** Pink stripes on alternate lines + dashed paragraph box: where the text should be. Kept in one named group. */
const guide = (id, x, y, p) => {
  const n = p.lines.length;
  const stripes = Array.from({ length: n }, (_, i) =>
    `<rect x="${x}" y="${y + i * p.lh}" width="${W}" height="${p.lh}" fill="${i % 2 ? 'rgb(255,228,236)' : 'rgb(255,241,245)'}"/>`).join('');
  return `<g id="guide ${id}">${stripes}<rect x="${x}" y="${y}" width="${W}" height="${n * p.lh}" fill="none" stroke="rgb(244,114,182)" stroke-dasharray="4 3"/></g>`;
};
const ax = (x, p) => (p.anchor === 'end' ? x + W : x);
// First baseline per the Phase 0 finding: box top = y − font-size; the line's half-leading puts the text
// (lh − size)/2 below the stripe top.
const base = (y, p) => y + (p.lh - p.size) / 2 + p.size;

const LS = '\u2028'; // LINE SEPARATOR: what Figma itself stores for Shift+Enter; not XML whitespace
const PS = '\u2029'; // PARAGRAPH SEPARATOR
const oneTspan = (sep, extra) => (id, x, y, p) =>
  `<text id="${id}" ${p.font} fill="rgb(17,24,39)" text-anchor="${p.anchor}" xml:space="preserve"${extra(p)}><tspan x="${ax(x, p)}" y="${base(y, p)}">${p.lines.map(esc).join(sep)}</tspan></text>`;

// Round 1 (createNodeFromSvg, 2026-11-11): line feeds → spaces (P1/P2), dy-only tspans → a group (P3), SVG2
// inline-size ignored (P4), foreignObject dropped (P5); only P0 (a group of line layers) keeps the lines.
// Round 2 (this board): Unicode separators inside ONE tspan, with and without a line-height hint.
const variants = {
  /** Today's output: one <text>, one <tspan x y> per line → a GROUP of line layers. */
  P0: (id, x, y, p) => `<text id="${id}" ${p.font} fill="rgb(17,24,39)" text-anchor="${p.anchor}" xml:space="preserve">${p.lines.map((l, i) => `<tspan x="${ax(x, p)}" y="${base(y, p) + i * p.lh}">${esc(l)}</tspan>`).join('')}</text>`,
  Q1: oneTspan(LS, () => ''),
  Q2: oneTspan(LS, (p) => ` style="line-height: ${p.lh}px"`),
  Q3: oneTspan(LS, (p) => ` line-height="${p.lh}"`),
  Q4: oneTspan(PS, () => ''),
  Q5: oneTspan(LS, (p) => ` style="font: ${p.size}px/${p.lh}px ${p === ar ? 'Tajawal' : 'Inter'}"`),
};
const what = {
  P0: 'today: tspan per line (x, y)',
  Q1: 'U+2028 line separator',
  Q2: 'U+2028 + style line-height',
  Q3: 'U+2028 + line-height attribute',
  Q4: 'U+2029 paragraph separator',
  Q5: 'U+2028 + font shorthand 16px/24px',
};

const parts = [];
const keys = Object.keys(variants);
keys.forEach((k, i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const x = 40 + col * 400;
  const y = 70 + row * 300;
  parts.push(label(x, y - 16, `${k} · ${what[k]}`));
  parts.push(guide(`${k} en`, x, y, en), variants[k](`${k} paragraph en`, x, y, en));
  const ya = y + 110;
  parts.push(guide(`${k} ar`, x, ya, ar), variants[k](`${k} paragraph ar`, x, ya, ar));
});

// N: layer names with spaces and "·", nested groups, a named image-like rect, a named single-line text.
const nx = 40;
const ny = 70 + 2 * 300;
parts.push(label(nx, ny - 16, 'N · layer names (check the Layers panel)'));
parts.push(
  `<g id="Card · New arrivals"><rect id="Card background" x="${nx}" y="${ny}" width="320" height="120" rx="12" fill="rgb(243,244,246)"/>` +
    `<rect id="Image · bag photo" x="${nx + 16}" y="${ny + 16}" width="88" height="88" rx="8" fill="rgb(209,213,219)"/>` +
    `<text id="Heading · Leather tote" font-family="Inter-SemiBold, Inter" font-size="16" font-weight="600" fill="rgb(17,24,39)" xml:space="preserve"><tspan x="${nx + 120}" y="${ny + 36}">Leather tote</tspan></text>` +
    `<g id="Button · Add to cart"><rect x="${nx + 120}" y="${ny + 60}" width="120" height="36" rx="8" fill="rgb(37,99,235)"/>` +
    `<text font-family="Inter-SemiBold, Inter" font-size="14" font-weight="600" fill="rgb(255,255,255)" xml:space="preserve"><tspan x="${nx + 136}" y="${ny + 83}">Add to cart</tspan></text></g></g>`,
  `<g id="زر · أضف إلى السلة"><rect x="${nx + 360}" y="${ny + 60}" width="140" height="36" rx="8" fill="rgb(22,163,74)"/>` +
    `<text font-family="Tajawal-Bold, Tajawal" font-size="15" font-weight="700" fill="rgb(255,255,255)" text-anchor="end" xml:space="preserve"><tspan x="${nx + 484}" y="${ny + 83}">أضف إلى السلة</tspan></text></g>`,
);

const H = ny + 160;
const board =
  `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="${H}" viewBox="0 0 1240 ${H}">` +
  `<rect id="Background" x="0" y="0" width="1240" height="${H}" fill="rgb(255,255,255)"/>${parts.join('')}</svg>`;
writeFileSync(join(out, 'editing.json'), JSON.stringify([{ id: 'editing-board', label: 'Paragraphs (P0 today, Q1–Q5 line separators) and layer names (N)', svg: board }]));
writeFileSync(join(out, 'editing-board.svg'), board);
console.log(`editing-board: ${(board.length / 1024).toFixed(1)} KB`);
