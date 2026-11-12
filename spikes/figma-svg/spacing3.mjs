/**
 * Letter-spacing round 3 (rounds 1–2: every attribute/style form ignored, see README). One SVG per technique so a
 * failing one cannot hide the others. "THE NEW SEASON", Inter 32 px, 6 px tracking; pink bar = Chrome's width with
 * the spacing (x of each letter measured in Chrome with canvas TextMetrics + 6 px per gap), gray = without.
 * Writes out/spacing3.json for media.html?board=spacing3. Run: node spikes/figma-svg/spacing3.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const T = 'THE NEW SEASON';
const SIZE = 32;
const LS = 6;
// Chrome, Inter 400 32 px: x of each letter with 6 px tracking; width without tracking 287.5.
const XS = [0, 26.66, 56.44, 81.67, 96.67, 126.78, 152.02, 189.55, 204.55, 231.08, 256.31, 284.39, 310.92, 341.39];
const PLAIN = 287.5;
const TARGET = PLAIN + (T.length - 1) * LS;
const X0 = 40;
const BASE = 104;

const cases = [
  ['U1', "Figma's own SVG export: style=\"white-space: pre\" + letter-spacing in em",
    `<text fill="#111827" xml:space="preserve" style="white-space: pre" font-family="Inter" font-size="${SIZE}" letter-spacing="${LS / SIZE}em"><tspan x="${X0}" y="${BASE}">${T}</tspan></text>`],
  ['U2', 'style="white-space: pre" + letter-spacing="6px"',
    `<text fill="#111827" xml:space="preserve" style="white-space: pre" font-family="Inter" font-size="${SIZE}" letter-spacing="${LS}px"><tspan x="${X0}" y="${BASE}">${T}</tspan></text>`],
  ['U3', 'one tspan, one x per letter',
    `<text fill="#111827" xml:space="preserve" font-family="Inter-Regular, Inter" font-size="${SIZE}"><tspan x="${XS.map((x) => +(X0 + x).toFixed(2)).join(' ')}" y="${BASE}">${T}</tspan></text>`],
  ['U4', 'one tspan per letter, same baseline',
    `<text fill="#111827" xml:space="preserve" font-family="Inter-Regular, Inter" font-size="${SIZE}">${[...T].map((c, i) => `<tspan x="${+(X0 + XS[i]).toFixed(2)}" y="${BASE}">${c}</tspan>`).join('')}</text>`],
  ['U5', 'two hair spaces per gap (Figma drew one ≈ 3 px in Inter)',
    `<text fill="#111827" xml:space="preserve" font-family="Inter-Regular, Inter" font-size="${SIZE}"><tspan x="${X0}" y="${BASE}">${[...T].join('  ')}</tspan></text>`],
];

const boards = cases.map(([id, what, text]) => {
  const label = `<text font-family="Inter-SemiBold, Inter" font-size="13" font-weight="600" fill="rgb(107,114,128)" xml:space="preserve"><tspan x="${X0}" y="38">${id} · ${what.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}</tspan></text>`;
  const bars = `<rect x="${X0}" y="52" width="${TARGET}" height="6" fill="rgb(244,114,182)"/><rect x="${X0}" y="60" width="${PLAIN}" height="4" fill="rgb(209,213,219)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="140" viewBox="0 0 640 140"><rect id="Background" x="0" y="0" width="640" height="140" fill="rgb(255,255,255)"/>${label}${bars}${text}</svg>`;
  return { id, label: `${id} · ${what}`, svg };
});
writeFileSync(join(out, 'spacing3.json'), JSON.stringify(boards));
console.log(boards.map((b) => `${b.id} ${(b.svg.length / 1024).toFixed(1)} KB`).join('\n'));
