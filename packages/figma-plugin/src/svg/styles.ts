/**
 * Styles board (Phase 2, easier editing): the page's colors and text styles as one SVG that Figma Web imports on
 * Ctrl+V, pasted next to the page. Every swatch and sample is a named layer ("Color · #1F2937",
 * "Text style · Tajawal Bold 28/36"), so a designer can select it and create a Figma style in a few clicks. Read from
 * the same render plan as Copy to Figma (fonts resolved the same way, PostScript names for exact weights). Pure.
 */
import {
  withDirectionMark,
  type PlanNode,
  type PlanText,
  type RenderPlan,
  type SolidPaintSpec,
} from '../plan/plan.ts';
import { fontFamilyList, styleToCss, titleCase } from './svg.ts';

export interface StylesBoardResult {
  svg: string;
  stats: { colors: number; textStyles: number };
}

const WIDTH = 960;
const PAD = 40;
const SWATCH = 72;
const SWATCH_GAP = 24;
const PER_ROW = Math.floor((WIDTH - 2 * PAD + SWATCH_GAP) / (SWATCH + SWATCH_GAP));
const MAX_COLORS = 16;
const MAX_TEXT_STYLES = 24;
const MAX_SAMPLE = 48;
/** Samples larger than this are drawn at this size (the label keeps the real one). */
const MAX_SAMPLE_SIZE = 64;
const UI_FONT = 'Inter-Regular, Inter, sans-serif';
const UI_FONT_BOLD = 'Inter-SemiBold, Inter, sans-serif';
const INK = 'rgb(17,24,39)';
const MUTED = 'rgb(107,114,128)';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => String(Math.round(v * 100) / 100);
const hex2 = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

/** "#1F2937", or "#1F2937 · 50%" for a translucent color. */
export function colorLabel(p: SolidPaintSpec): string {
  const h = `#${hex2(p.color.r)}${hex2(p.color.g)}${hex2(p.color.b)}`;
  return p.opacity < 0.995 ? `${h} · ${Math.round(p.opacity * 100)}%` : h;
}

interface ColorUse {
  paint: SolidPaintSpec;
  count: number;
}
/**
 * One entry of the type scale: a font, style and size. Line height, tracking and case variants are merged into it
 * (designers think in a type scale); `text` is a node of the most used variant, `sample` the most readable text.
 */
interface TextStyleUse {
  text: PlanText;
  sample: PlanText;
  key: string;
  count: number;
  variants: number;
}

const LETTERS = /\p{L}/u;
const words = (t: PlanText) => t.characters.trim().split(/\s+/).length;
/** A phrase with letters reads better as a sample than a label, a number or a symbol. */
const betterSample = (a: PlanText, b: PlanText) =>
  LETTERS.test(a.characters) !== LETTERS.test(b.characters)
    ? LETTERS.test(a.characters)
    : words(a) > words(b) && a.characters.length <= 80;

/** Colors and text styles of a plan, most used first. */
export function collectStyles(plan: RenderPlan): {
  text: ColorUse[];
  backgrounds: ColorUse[];
  borders: ColorUse[];
  textStyles: TextStyleUse[];
} {
  const groups = { text: new Map<string, ColorUse>(), backgrounds: new Map(), borders: new Map() };
  const add = (g: Map<string, ColorUse>, p: SolidPaintSpec, weight = 1) => {
    if (p.opacity <= 0.01) return;
    const k = colorLabel(p);
    const u = g.get(k) ?? { paint: p, count: 0 };
    u.count += weight;
    g.set(k, u);
  };
  const scale = new Map<
    string,
    { sample: PlanText; count: number; variants: Map<string, { text: PlanText; count: number }> }
  >();
  const visit = (n: PlanNode) => {
    if (n.kind === 'text') {
      add(groups.text, n.fill);
      const key = `${n.font.family}|${n.font.style}|${num(n.fontSize)}`;
      const lh = n.lineHeight.unit === 'PIXELS' ? num(n.lineHeight.value) : 'auto';
      const variant = `${lh}|${num(n.letterSpacing.value)}|${n.textCase}`;
      const u = scale.get(key) ?? { sample: n, count: 0, variants: new Map() };
      u.count++;
      if (betterSample(n, u.sample)) u.sample = n;
      const v = u.variants.get(variant) ?? { text: n, count: 0 };
      v.count++;
      u.variants.set(variant, v);
      scale.set(key, u);
      return;
    }
    if (n.kind === 'frame' || n.kind === 'rect') {
      for (const f of n.fills) if (f.type === 'SOLID') add(groups.backgrounds, f);
      if (n.strokes) add(groups.borders, n.strokes.paint);
      if (n.kind === 'frame') n.children.forEach(visit);
    }
  };
  visit(plan.root);
  const top = (g: Map<string, ColorUse>) =>
    [...g.values()].sort((a, b) => b.count - a.count).slice(0, MAX_COLORS);
  return {
    text: top(groups.text),
    backgrounds: top(groups.backgrounds),
    borders: top(groups.borders),
    textStyles: [...scale.entries()]
      .map(([key, u]) => ({
        key,
        sample: u.sample,
        count: u.count,
        variants: u.variants.size,
        text: [...u.variants.values()].sort((a, b) => b.count - a.count)[0]!.text,
      }))
      .sort((a, b) => b.text.fontSize - a.text.fontSize || b.count - a.count)
      .slice(0, MAX_TEXT_STYLES),
  };
}

const label = (x: number, y: number, t: string, size = 12, bold = false, fill = MUTED) =>
  `<text font-family="${bold ? UI_FONT_BOLD : UI_FONT}" font-size="${size}" font-weight="${bold ? 600 : 400}" fill="${fill}" xml:space="preserve"><tspan x="${num(x)}" y="${num(y + size)}">${esc(t)}</tspan></text>`;

const rgb = (p: SolidPaintSpec) =>
  `rgb(${Math.round(p.color.r * 255)},${Math.round(p.color.g * 255)},${Math.round(p.color.b * 255)})`;

/** One section of swatches; returns the markup and the y below it. */
function swatches(title: string, uses: ColorUse[], y: number): [string, number] {
  if (!uses.length) return ['', y];
  const parts = [label(PAD, y, title, 14, true, INK)];
  y += 30;
  uses.forEach((u, i) => {
    const x = PAD + (i % PER_ROW) * (SWATCH + SWATCH_GAP);
    const top = y + Math.floor(i / PER_ROW) * (SWATCH + 56);
    const name = colorLabel(u.paint);
    parts.push(
      `<g id="${esc(`Color · ${name}`)}">` +
        `<rect x="${x}" y="${top}" width="${SWATCH}" height="${SWATCH}" rx="12" fill="${rgb(u.paint)}"` +
        `${u.paint.opacity < 0.995 ? ` fill-opacity="${num(u.paint.opacity)}"` : ''} stroke="rgb(229,231,235)"/>` +
        label(x, top + SWATCH + 8, name, 11, true, INK) +
        label(x, top + SWATCH + 24, `${u.count}×`, 11) +
        `</g>`,
    );
  });
  const rows = Math.ceil(uses.length / PER_ROW);
  return [parts.join(''), y + rows * (SWATCH + 56) + 16];
}

/** The text styles section: a spec line and a sample in the style for each. */
function textStyles(uses: TextStyleUse[], y: number): [string, number] {
  if (!uses.length) return ['', y];
  const parts = [label(PAD, y, 'Text styles', 14, true, INK)];
  y += 34;
  for (const u of uses) {
    const t = u.text;
    const lh = t.lineHeight.unit === 'PIXELS' ? `/${num(t.lineHeight.value)}` : '';
    const name = `${t.font.family} ${t.font.style} ${num(t.fontSize)}${lh}`;
    const spacing = t.letterSpacing.value ? ` · tracking ${num(t.letterSpacing.value)}px` : '';
    const textCase = t.textCase !== 'ORIGINAL' ? ` · ${t.textCase.toLowerCase()} case` : '';
    const more = u.variants > 1 ? ` (+${u.variants - 1} variant${u.variants > 2 ? 's' : ''})` : '';
    parts.push(label(PAD, y, `${name}${spacing}${textCase} · ${u.count}×${more}`, 11));
    y += 22;
    const size = Math.min(t.fontSize, MAX_SAMPLE_SIZE);
    let sample = u.sample.characters
      .replace(/[\u200e\u200f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (sample.length > MAX_SAMPLE) sample = `${sample.slice(0, MAX_SAMPLE - 1).trimEnd()}…`;
    // The sample shows the case it has on the page.
    if (u.sample.textCase === 'UPPER') sample = sample.toUpperCase();
    else if (u.sample.textCase === 'LOWER') sample = sample.toLowerCase();
    else if (u.sample.textCase === 'TITLE') sample = titleCase(sample);
    sample = withDirectionMark(sample, u.sample.direction); // same bidi hint as the page's own text (PLG-RTL-2)
    const { weight, italic } = styleToCss(t.font.style);
    parts.push(
      `<text id="${esc(`Text style · ${name}`)}" font-family="${esc(fontFamilyList(t.font))}" font-size="${num(size)}"` +
        ` font-weight="${weight}"${italic ? ' font-style="italic"' : ''}` +
        `${t.letterSpacing.value ? ` letter-spacing="${num(t.letterSpacing.value)}"` : ''}` +
        ` fill="${INK}" xml:space="preserve">` +
        // Left-aligned like its label, Arabic included (Figma shapes and orders it).
        `<tspan x="${PAD}" y="${num(y + size)}">${esc(sample)}</tspan></text>`,
    );
    y += Math.round(size * 1.3) + 22;
  }
  return [parts.join(''), y];
}

/** The board: title, colors (text, backgrounds, borders) and text styles, in one SVG for Ctrl+V in Figma. */
export function stylesBoardSvg(plan: RenderPlan, title: string): StylesBoardResult {
  const s = collectStyles(plan);
  let y = PAD;
  const parts = [label(PAD, y, `Styles · ${title}`.slice(0, 90), 24, true, INK)];
  y += 40;
  parts.push(
    label(
      PAD,
      y,
      'Select a swatch or sample, then create a color or text style from it in Figma.',
      12,
    ),
  );
  y += 40;
  for (const [name, uses] of [
    ['Text colors', s.text],
    ['Backgrounds', s.backgrounds],
    ['Borders', s.borders],
  ] as const) {
    const [markup, next] = swatches(name, uses, y);
    parts.push(markup);
    y = next;
  }
  const [ts, end] = textStyles(s.textStyles, y);
  parts.push(ts);
  const height = end + PAD;
  const colors = s.text.length + s.backgrounds.length + s.borders.length;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">` +
    `<rect id="Background" x="0" y="0" width="${WIDTH}" height="${height}" fill="rgb(255,255,255)"/>` +
    `${parts.join('')}</svg>`;
  return { svg, stats: { colors, textStyles: s.textStyles.length } };
}
