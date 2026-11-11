/**
 * Phase 2 follow-up spike: which way of writing letter spacing does Figma's SVG import keep? Writes
 * out/spacing.json for media.html?board=spacing. Each case is "THE NEW SEASON" in Inter with 6 px tracking (and a
 * small 11.5 px / 2.53 px label), next to a pink bar as wide as Chrome draws it with the spacing (measured in
 * Chrome, passed in as argv JSON) and a gray bar for no spacing. Run: node spikes/figma-svg/spacing.mjs '<widths>'
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const w = JSON.parse(process.argv[2]); // { big: [withSpacing, without], small: [withSpacing, without] }

const BIG = 'THE NEW SEASON';
const SMALL = 'FOR HER';
const font = (size) => `font-family="Inter-Regular, Inter" font-size="${size}" font-weight="400" fill="rgb(17,24,39)" xml:space="preserve"`;
const label = (x, y, t) =>
  `<text font-family="Inter-SemiBold, Inter" font-size="13" font-weight="600" fill="rgb(107,114,128)" xml:space="preserve"><tspan x="${x}" y="${y}">${t}</tspan></text>`;
/** Per-character dx: the spacing as explicit offsets after each character. */
const dx = (text, ls) => [...text].map((_, i) => (i ? ls : 0)).join(' ');

const cases = [
  ['S0', 'no spacing (reference)', () => ''],
  ['S1', 'letter-spacing="6" (today)', (ls) => ` letter-spacing="${ls}"`],
  ['S2', 'letter-spacing="6px"', (ls) => ` letter-spacing="${ls}px"`],
  ['S3', 'style="letter-spacing: 6px"', (ls) => ` style="letter-spacing: ${ls}px"`],
  ['S4', 'letter-spacing in em', (ls, size) => ` letter-spacing="${Math.round((ls / size) * 1000) / 1000}em"`],
  ['S5', 'per-character dx on the tspan', () => ''],
  // Round 2 (round 1: S1–S5 all ignored by Figma, the text matched S0).
  ['S6', 'textLength + lengthAdjust="spacing"', () => ''],
  ['S7', 'class from a <style> sheet', (ls) => ` class="ls${String(ls).replace('.', '_')}"`],
  ['S8', 'hair spaces (U+200A) between letters', () => ''],
];
const HAIR_EM = 0.0625; // Inter's U+200A advance (measured in Chrome: 2 px at 32 px)
const hair = (text, ls, size) =>
  [...text].join('\u200A'.repeat(Math.max(1, Math.round(ls / (HAIR_EM * size)))));

const parts = [];
let y = 40;
for (const [id, what, attr] of cases) {
  parts.push(label(40, y, `${id} · ${what}`));
  y += 14;
  for (const [text, size, ls, [wWith, wWithout]] of [
    [BIG, 32, 6, w.big],
    [SMALL, 11.5, 2.53, w.small],
  ]) {
    // Bars: pink = width with spacing (target), gray = without; the text sits on top, starting at the same x.
    parts.push(
      `<rect x="40" y="${y}" width="${wWith}" height="6" fill="rgb(244,114,182)"/>` +
        `<rect x="40" y="${y + 8}" width="${wWithout}" height="4" fill="rgb(209,213,219)"/>`,
    );
    const base = y + 16 + size;
    const target = Math.round(wWith * 10) / 10;
    const t =
      id === 'S5'
        ? `<tspan x="40" y="${base}" dx="${dx(text, ls)}">${text}</tspan>`
        : id === 'S6'
          ? `<tspan x="40" y="${base}" textLength="${target}" lengthAdjust="spacing">${text}</tspan>`
          : id === 'S8'
            ? `<tspan x="40" y="${base}">${hair(text, ls, size)}</tspan>`
            : `<tspan x="40" y="${base}">${text}</tspan>`;
    const tl = id === 'S6' ? ` textLength="${target}" lengthAdjust="spacing"` : '';
    parts.push(`<text id="${id} ${text}" ${font(size)}${attr(ls, size)}${tl}>${t}</text>`);
    y = base + 18;
  }
  y += 16;
}
const H = y + 20;
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${H}" viewBox="0 0 640 ${H}">` +
  `<style>.ls6{letter-spacing:6px}.ls2_53{letter-spacing:2.53px}</style>` +
  `<rect id="Background" x="0" y="0" width="640" height="${H}" fill="rgb(255,255,255)"/>${parts.join('')}</svg>`;
writeFileSync(join(out, 'spacing.json'), JSON.stringify([{ id: 'spacing-board', label: 'Letter spacing (S0–S8)', svg }]));
writeFileSync(join(out, 'spacing-board.svg'), svg);
console.log(`spacing-board ${(svg.length / 1024).toFixed(1)} KB`);
