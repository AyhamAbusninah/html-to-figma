/**
 * Letter-spacing round 4: how wide is a hair space (U+200A) in Figma, per font? Round 3 showed hair spaces are the
 * only way to space letters in a pasted SVG (Inter: ~3 px at 32 px, Chrome draws 2 px = its 1/16 em fallback).
 * One board; for each font two text layers at 50 px: "II" and "I" + 20 hair spaces + "I". Their width difference
 * / 20 / 50 = Figma's hair space in em (read back from the layer sizes). Writes out/spacing4.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const FONTS = [
  ['Inter', 'Inter-Regular'],
  ['Manrope', 'Manrope-Regular'],
  ['Cormorant Garamond', 'CormorantGaramond-Regular'],
  ['Roboto', 'Roboto-Regular'],
  ['Montserrat', 'Montserrat-Regular'],
  ['Playfair Display', 'PlayfairDisplay-Regular'],
];
const N = 20;
const SIZE = 50;
const rows = [];
let y = 40;
for (const [fam, ps] of FONTS) {
  const font = `font-family="${ps}, ${fam}" font-size="${SIZE}" font-weight="400" fill="rgb(17,24,39)" xml:space="preserve"`;
  rows.push(
    `<text id="${fam} ref" ${font}><tspan x="40" y="${y + SIZE}">II</tspan></text>`,
    `<text id="${fam} hair" ${font}><tspan x="200" y="${y + SIZE}">I${' '.repeat(N)}I</tspan></text>`,
  );
  y += 80;
}
const H = y + 20;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${H}" viewBox="0 0 640 ${H}"><rect id="Background" x="0" y="0" width="640" height="${H}" fill="rgb(255,255,255)"/>${rows.join('')}</svg>`;
writeFileSync(join(out, 'spacing4.json'), JSON.stringify([{ id: 'S4', label: 'Hair space width per font (one paste)', svg }]));
console.log(`${(svg.length / 1024).toFixed(1)} KB`);
