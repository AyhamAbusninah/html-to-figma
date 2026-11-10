/**
 * Route C spike (ISOLATED): RenderPlan (unchanged buildPlan output) → one SVG document for Figma's documented SVG
 * import (paste or file import). A serializer: every box, color and position comes from the plan.
 * The only measurements are what SVG needs and the plan doesn't carry: the text baseline (font ascent/descent) and,
 * for multi-line text, where the lines break. Both come from the caller's `measure` (the browser in copy.html), so
 * this module stays pure and runs in Node tests too.
 *
 * @typedef {import('../../packages/figma-plugin/src/plan/plan.ts').RenderPlan} RenderPlan
 * @typedef {import('../../packages/figma-plugin/src/plan/plan.ts').PlanNode} PlanNode
 * @typedef {{
 *   metrics(font: {family: string, weight: number, italic: boolean, size: number}): {ascent: number, descent: number},
 *   lines(text: {characters: string, family: string, weight: number, italic: boolean, size: number,
 *                lineHeight: number | null, letterSpacing: number, width: number, align: string}): string[]
 * }} Measure
 */

const WEIGHTS = [
  ['thin', 100], ['hairline', 100], ['extra light', 200], ['extralight', 200], ['ultra light', 200],
  ['semi bold', 600], ['semibold', 600], ['demi bold', 600], ['extra bold', 800], ['extrabold', 800],
  ['ultra bold', 800], ['light', 300], ['regular', 400], ['normal', 400], ['book', 400], ['medium', 500],
  ['bold', 700], ['black', 900], ['heavy', 900],
];

/** Figma style name ("Semi Bold Italic") → CSS weight + italic. */
export function styleToCss(style) {
  const s = style.toLowerCase();
  const hit = WEIGHTS.find(([name]) => s.includes(name));
  return { weight: hit ? hit[1] : 400, italic: /italic|oblique/.test(s) };
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v) => String(Math.round(v * 100) / 100);
const rgb = (c) =>
  `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;

/** PostScript-style name ("Noto Sans Arabic" + "Semi Bold" → "NotoSansArabic-SemiBold"), which Figma's SVG import
 * resolves to the exact style, followed by the CSS family for browsers. */
export function fontFamilyList(font) {
  const ps = `${font.family.replace(/\s+/g, '')}-${font.style.replace(/\s+/g, '')}`;
  return `${ps}, ${font.family}`;
}

/** Unique XML id from the layer name (Figma names imported layers after `id`). */
function idFactory() {
  const used = new Map();
  return (name) => {
    const base = (name || 'layer').replace(/[^\w.-]+/g, '_').replace(/^[^A-Za-z_]+/, 'n_').slice(0, 60) || 'layer';
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  };
}

/** Rounded-rect path with per-corner radii (SVG <rect> only has one radius). */
function roundedPath(x, y, w, h, r) {
  const k = (v) => Math.max(0, Math.min(v, w / 2, h / 2));
  const tl = k(r.tl), tr = k(r.tr), br = k(r.br), bl = k(r.bl);
  return (
    `M${num(x + tl)},${num(y)}H${num(x + w - tr)}` +
    (tr ? `A${num(tr)},${num(tr)} 0 0 1 ${num(x + w)},${num(y + tr)}` : '') +
    `V${num(y + h - br)}` +
    (br ? `A${num(br)},${num(br)} 0 0 1 ${num(x + w - br)},${num(y + h)}` : '') +
    `H${num(x + bl)}` +
    (bl ? `A${num(bl)},${num(bl)} 0 0 1 ${num(x)},${num(y + h - bl)}` : '') +
    `V${num(y + tl)}` +
    (tl ? `A${num(tl)},${num(tl)} 0 0 1 ${num(x + tl)},${num(y)}` : '') +
    'Z'
  );
}

/** <rect> when the corners match, else a <path>. `attrs` is appended verbatim. */
function shape(id, x, y, w, h, radii, attrs) {
  const r = radii ?? { tl: 0, tr: 0, br: 0, bl: 0 };
  const idAttr = id ? ` id="${esc(id)}"` : '';
  if (r.tl === r.tr && r.tr === r.br && r.br === r.bl)
    return `<rect${idAttr} x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${r.tl ? ` rx="${num(r.tl)}"` : ''}${attrs}/>`;
  return `<path${idAttr} d="${roundedPath(x, y, w, h, r)}"${attrs}/>`;
}

/**
 * @param {RenderPlan} plan
 * @param {Measure} measure
 * @param {{ rtl?: 'physical' | 'direction' | 'marks' }} [options]
 *   How right-to-left text is encoded:
 *   'physical' (default): text-anchor in physical terms (start = left edge, end = right edge), no direction
 *     attribute. Figma's SVG import reads text-anchor this way and ignores `direction` (measured 2026-11-10),
 *     and its text engine orders Arabic itself. Browsers misplace neutral characters at line ends in this mode.
 *   'direction': SVG direction="rtl", text-anchor resolved in that direction (standard SVG; right in browsers,
 *     wrong in Figma: right-aligned lines start at the right edge).
 *   'marks': physical anchors with U+200F RIGHT-TO-LEFT MARKs around each line.
 * @param {{ target?: 'figma' | 'browser' }} [options]
 *   'figma' (default): Figma's SVG import puts a text box's top at (y - font-size) whatever the font's real ascent,
 *     and only resolves weights from a PostScript-style family name ("Cairo-SemiBold"); both measured 2026-11-10.
 *     So y = line top + font-size, and font-family lists the PostScript name first, the CSS family second.
 *   'browser': y = line top + measured ascent (correct when a browser draws the SVG).
 * @returns {{ svg: string, stats: { boxes: number, texts: number, placeholders: number, lines: number }, skipped: string[] }}
 */
export function planToSvg(plan, measure, options = {}) {
  const rtlMode = options.rtl ?? 'physical';
  const target = options.target ?? 'figma';
  const id = idFactory();
  const defs = [];
  const skipped = new Set();
  const stats = { boxes: 0, texts: 0, placeholders: 0, lines: 0 };
  /** Expected boxes of each emitted text (absolute), keyed by the SVG id, for comparing against Figma. */
  const textBoxes = [];
  let defId = 0;

  const filterFor = (effects) => {
    const prims = [];
    for (const e of effects) {
      if (e.type === 'DROP_SHADOW') {
        if (e.spread) skipped.add('shadow spread');
        prims.push(
          `<feDropShadow dx="${num(e.offset.x)}" dy="${num(e.offset.y)}" stdDeviation="${num(e.radius / 2)}" flood-color="${rgb(e.color)}" flood-opacity="${num(e.color.a)}"/>`,
        );
      } else if (e.type === 'LAYER_BLUR') prims.push(`<feGaussianBlur stdDeviation="${num(e.radius / 2)}"/>`);
      else skipped.add(e.type.toLowerCase());
    }
    if (!prims.length) return '';
    const fid = `fx${++defId}`;
    defs.push(`<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%">${prims.join('')}</filter>`);
    return ` filter="url(#${fid})"`;
  };

  const strokesFor = (n, ax, ay) => {
    const s = n.strokes;
    if (!s) return '';
    const paint = ` fill="none" stroke="${rgb(s.paint.color)}"${s.paint.opacity < 1 ? ` stroke-opacity="${num(s.paint.opacity)}"` : ''}${s.dash ? ` stroke-dasharray="${s.dash.map(num).join(' ')}"` : ''}`;
    if (s.top === s.right && s.right === s.bottom && s.bottom === s.left) {
      // CSS borders sit inside the box; an SVG stroke is centered on the path, so inset by half the width.
      const w = s.top, h2 = w / 2;
      const r = n.radii && {
        tl: Math.max(0, n.radii.tl - h2), tr: Math.max(0, n.radii.tr - h2),
        br: Math.max(0, n.radii.br - h2), bl: Math.max(0, n.radii.bl - h2),
      };
      return shape(id(`${n.name} border`), ax + h2, ay + h2, n.width - w, n.height - w, r, `${paint} stroke-width="${num(w)}"`);
    }
    skipped.add('per-side borders drawn as filled bars');
    const fill = ` fill="${rgb(s.paint.color)}"${s.paint.opacity < 1 ? ` fill-opacity="${num(s.paint.opacity)}"` : ''}`;
    const bars = [];
    if (s.top) bars.push(shape(null, ax, ay, n.width, s.top, null, fill));
    if (s.bottom) bars.push(shape(null, ax, ay + n.height - s.bottom, n.width, s.bottom, null, fill));
    if (s.left) bars.push(shape(null, ax, ay, s.left, n.height, null, fill));
    if (s.right) bars.push(shape(null, ax + n.width - s.right, ay, s.right, n.height, null, fill));
    return `<g id="${esc(id(`${n.name} border`))}">${bars.join('')}</g>`;
  };

  const text = (n, ax, ay) => {
    stats.texts++;
    const { weight, italic } = styleToCss(n.font.style);
    const font = { family: n.font.family, weight, italic, size: n.fontSize };
    const { ascent, descent } = measure.metrics(font);
    // Distance from a line's content top to the y written in the SVG (see options.target).
    const baselineOffset = target === 'figma' ? n.fontSize : ascent;
    const lh = n.lineHeight.unit === 'PIXELS' ? n.lineHeight.value : null;
    let chars = n.characters;
    if (n.textCase === 'UPPER') chars = chars.toUpperCase();
    else if (n.textCase === 'LOWER') chars = chars.toLowerCase();
    else if (n.textCase === 'TITLE') skipped.add('title case');
    const lines =
      n.autoResize === 'HEIGHT'
        ? measure.lines({ characters: chars, ...font, lineHeight: lh, letterSpacing: n.letterSpacing.value, width: n.width, align: n.align })
        : [chars];
    stats.lines += lines.length;
    const pitch = lh ?? ascent + descent;
    // Center the line stack in the captured box: for captured text the box is the glyph content area (offset 0);
    // for a box of full line height this is CSS half-leading.
    const top = ay + (n.height - ((lines.length - 1) * pitch + ascent + descent)) / 2;
    const rtl = n.direction === 'rtl';
    const useDir = rtl && rtlMode === 'direction';
    // text-anchor start/end follow the text direction: in an rtl chunk "start" is the right edge.
    const physical = n.anchor === 'center' ? 'middle' : (n.anchor === 'right') !== useDir ? 'end' : 'start';
    const anchor = physical;
    const mark = rtl && rtlMode === 'marks' ? '\u200F' : '';
    const x = n.anchor === 'right' ? ax + n.width : n.anchor === 'center' ? ax + n.width / 2 : ax;
    if (n.align === 'JUSTIFIED') skipped.add('justified text drawn start-aligned');
    const deco = n.decoration === 'UNDERLINE' ? ' text-decoration="underline"' : n.decoration === 'STRIKETHROUGH' ? ' text-decoration="line-through"' : '';
    const attrs =
      ` font-family="${esc(fontFamilyList(n.font))}" font-size="${num(n.fontSize)}" font-weight="${weight}"` +
      (italic ? ' font-style="italic"' : '') +
      (n.letterSpacing.value ? ` letter-spacing="${num(n.letterSpacing.value)}"` : '') +
      ` fill="${rgb(n.fill.color)}"${n.fill.opacity < 1 ? ` fill-opacity="${num(n.fill.opacity)}"` : ''}` +
      (n.opacity < 1 ? ` opacity="${num(n.opacity)}"` : '') +
      ` text-anchor="${anchor}"${useDir ? ' direction="rtl"' : ''}${deco} xml:space="preserve"`;
    const body =
      lines.length === 1
        ? `<tspan x="${num(x)}" y="${num(top + baselineOffset)}">${esc(mark + lines[0] + mark)}</tspan>`
        : lines.map((l, i) => `<tspan x="${num(x)}" y="${num(top + baselineOffset + i * pitch)}">${esc(mark + l + mark)}</tspan>`).join('');
    const tid = id(n.name);
    textBoxes.push({ id: tid, x: ax, y: ay, width: n.width, height: n.height, anchor: n.anchor, lines: lines.length });
    return `<text id="${esc(tid)}"${attrs}>${body}</text>`;
  };

  const visit = (n, ox, oy) => {
    const ax = ox + n.x, ay = oy + n.y;
    if (n.blendMode) skipped.add(`blend mode ${n.blendMode}`);
    if (n.kind === 'text') return text(n, ax, ay);
    if (n.kind === 'placeholder') {
      stats.placeholders++;
      return shape(id(`${n.name} (${n.reason})`), ax, ay, n.width, n.height, n.radii,
        ' fill="rgb(230,232,236)" stroke="rgb(156,163,175)" stroke-dasharray="4 4"');
    }
    stats.boxes++;
    const fill = n.fills[0];
    if (n.fills.length > 1) skipped.add('multiple fills (first kept)');
    const paint =
      (fill ? ` fill="${rgb(fill.color)}"${fill.opacity < 1 ? ` fill-opacity="${num(fill.opacity)}"` : ''}` : ' fill="none"') +
      filterFor(n.effects);
    const op = n.opacity < 1 ? ` opacity="${num(n.opacity)}"` : '';
    const name = id(n.name);
    const kids = n.children.map((c) => visit(c, ax, ay)).join('');
    // Leaf box: one shape named after the layer (no wrapper group).
    if (!kids && !n.strokes) return shape(name, ax, ay, n.width, n.height, n.radii, paint + op);
    const bg = shape(null, ax, ay, n.width, n.height, n.radii, paint);
    let inner = kids;
    if (n.clipsContent && kids) {
      const cid = `clip${++defId}`;
      defs.push(`<clipPath id="${cid}">${shape(null, ax, ay, n.width, n.height, n.radii, '')}</clipPath>`);
      inner = `<g clip-path="url(#${cid})">${kids}</g>`;
    }
    return `<g id="${esc(name)}"${op}>${bg}${inner}${strokesFor(n, ax, ay)}</g>`;
  };

  const root = plan.root;
  const body = visit({ ...root, x: 0, y: 0 }, 0, 0);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(root.width)}" height="${num(root.height)}" viewBox="0 0 ${num(root.width)} ${num(root.height)}">` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
    body +
    '</svg>';
  return { svg, stats, skipped: [...skipped], textBoxes };
}
