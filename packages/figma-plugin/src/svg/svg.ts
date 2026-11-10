/**
 * Copy to Figma without the plugin: RenderPlan (unchanged buildPlan output) → one SVG that Figma Web turns into
 * editable layers on Ctrl+V (its documented SVG import). A serializer only: every box, color and position comes
 * from the plan; line breaks come from the page itself (CaptureResult.textLines).
 *
 * Figma's SVG import, measured in real Figma Web (docs/spikes/FIGMA_CLIPBOARD.md §4b, spikes/figma-svg):
 *   - `direction` is ignored and `text-anchor` is physical (start = left edge at x, end = right edge at x);
 *     Figma's own text engine shapes Arabic and orders bidi text.
 *   - A text box's top is placed at (y - font-size), whatever the font's real ascent.
 *   - Weights resolve only from a PostScript-style family name ("Cairo-SemiBold").
 *   - <svg> → FRAME, <g id> → GROUP named after id, shapes → VECTOR, clip-path → mask group, a multi-line <text>
 *     → a GROUP of single-line TEXT layers, a <text> without id is named after its characters.
 * The structure is kept flat (no wrapper group, masks only where content overflows) so items can be selected
 * and removed.
 */
import {
  withDirectionMark,
  type PlanBox,
  type PlanImage,
  type PlanNode,
  type PlanPlaceholder,
  type PlanSvg,
  type PlanText,
  type RenderPlan,
} from '../plan/plan.ts';

type Radii = NonNullable<PlanBox['radii']>;

export interface SvgOptions {
  /** The page's line breaks for a multi-line text node, by its CaptureDocument id (PlanText.sourceId). */
  lines?: (sourceId: string) => readonly string[] | undefined;
}

export interface SvgResult {
  svg: string;
  stats: {
    boxes: number;
    texts: number;
    images: number;
    svgs: number;
    placeholders: number;
    lines: number;
  };
  /** What SVG can't express, for the user-facing note. */
  skipped: string[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => String(Math.round(v * 100) / 100);
const rgb = (c: { r: number; g: number; b: number }) =>
  `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
const paintAttr = (
  p: { color: { r: number; g: number; b: number }; opacity: number } | undefined,
) =>
  p
    ? ` fill="${rgb(p.color)}"${p.opacity < 1 ? ` fill-opacity="${num(p.opacity)}"` : ''}`
    : ' fill="none"';

const WEIGHTS: [string, number][] = [
  ['thin', 100],
  ['hairline', 100],
  ['extra light', 200],
  ['extralight', 200],
  ['ultra light', 200],
  ['semi bold', 600],
  ['semibold', 600],
  ['demi bold', 600],
  ['extra bold', 800],
  ['extrabold', 800],
  ['ultra bold', 800],
  ['light', 300],
  ['regular', 400],
  ['normal', 400],
  ['book', 400],
  ['medium', 500],
  ['bold', 700],
  ['black', 900],
  ['heavy', 900],
];

/** Figma style name ("Semi Bold Italic") → CSS weight + italic (for browsers drawing the SVG). */
export function styleToCss(style: string): { weight: number; italic: boolean } {
  const s = style.toLowerCase();
  const hit = WEIGHTS.find(([name]) => s.includes(name));
  return { weight: hit ? hit[1] : 400, italic: /italic|oblique/.test(s) };
}

/** "<PostScript-style name>, <family>": Figma resolves the exact style from the first, browsers use the second. */
export function fontFamilyList(font: { family: string; style: string }): string {
  return `${font.family.replace(/\s+/g, '')}-${font.style.replace(/\s+/g, '')}, ${font.family}`;
}

/** Unique XML ids from layer names. XML names allow Unicode letters, so Arabic names survive. */
function idFactory(): (name: string) => string {
  const used = new Map<string, number>();
  return (name) => {
    const base =
      (name || 'layer')
        .trim()
        .replace(/[^\p{L}\p{M}\p{N}_.-]+/gu, '_')
        .replace(/^[^\p{L}_]+/u, 'n_')
        .slice(0, 60) || 'layer';
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  };
}

function roundedPath(x: number, y: number, w: number, h: number, r: Radii): string {
  const k = (v: number) => Math.max(0, Math.min(v, w / 2, h / 2));
  const [tl, tr, br, bl] = [k(r.tl), k(r.tr), k(r.br), k(r.bl)];
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

/** <rect> when the corners match, else a <path>. */
function shape(
  id: string | null,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: Radii | undefined | null,
  attrs: string,
): string {
  const r = radii ?? { tl: 0, tr: 0, br: 0, bl: 0 };
  const idAttr = id ? ` id="${esc(id)}"` : '';
  if (r.tl === r.tr && r.tr === r.br && r.br === r.bl)
    return `<rect${idAttr} x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${r.tl ? ` rx="${num(r.tl)}"` : ''}${attrs}/>`;
  return `<path${idAttr} d="${roundedPath(x, y, w, h, r)}"${attrs}/>`;
}

export function planToSvg(plan: RenderPlan, options: SvgOptions = {}): SvgResult {
  const id = idFactory();
  const defs: string[] = [];
  const skipped = new Set<string>();
  const stats = { boxes: 0, texts: 0, images: 0, svgs: 0, placeholders: 0, lines: 0 };
  let defId = 0;

  const filterFor = (effects: PlanBox['effects']): string => {
    const prims: string[] = [];
    for (const e of effects) {
      if (e.type === 'DROP_SHADOW') {
        if (e.spread) skipped.add('shadow spread');
        prims.push(
          `<feDropShadow dx="${num(e.offset.x)}" dy="${num(e.offset.y)}" stdDeviation="${num(e.radius / 2)}" flood-color="${rgb(e.color)}" flood-opacity="${num(e.color.a)}"/>`,
        );
      } else if (e.type === 'LAYER_BLUR')
        prims.push(`<feGaussianBlur stdDeviation="${num(e.radius / 2)}"/>`);
      else skipped.add(e.type === 'INNER_SHADOW' ? 'inner shadows' : 'background blur');
    }
    if (!prims.length) return '';
    const fid = `fx${++defId}`;
    defs.push(
      `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%">${prims.join('')}</filter>`,
    );
    return ` filter="url(#${fid})"`;
  };

  const strokesFor = (n: PlanBox, ax: number, ay: number): string => {
    const s = n.strokes;
    if (!s) return '';
    const name = id(`${n.name} border`);
    if (s.top === s.right && s.right === s.bottom && s.bottom === s.left) {
      // CSS borders sit inside the box; an SVG stroke is centered on its path, so inset by half the width.
      const w = s.top;
      const h2 = w / 2;
      const r = n.radii && {
        tl: Math.max(0, n.radii.tl - h2),
        tr: Math.max(0, n.radii.tr - h2),
        br: Math.max(0, n.radii.br - h2),
        bl: Math.max(0, n.radii.bl - h2),
      };
      const stroke =
        ` fill="none" stroke="${rgb(s.paint.color)}"` +
        (s.paint.opacity < 1 ? ` stroke-opacity="${num(s.paint.opacity)}"` : '') +
        (s.dash ? ` stroke-dasharray="${s.dash.map(num).join(' ')}"` : '') +
        ` stroke-width="${num(w)}"`;
      return shape(name, ax + h2, ay + h2, n.width - w, n.height - w, r, stroke);
    }
    skipped.add('borders of different widths (drawn as bars)');
    const fill = paintAttr(s.paint);
    const bars: [number, number, number, number][] = [];
    if (s.top) bars.push([ax, ay, n.width, s.top]);
    if (s.bottom) bars.push([ax, ay + n.height - s.bottom, n.width, s.bottom]);
    if (s.left) bars.push([ax, ay, s.left, n.height]);
    if (s.right) bars.push([ax + n.width - s.right, ay, s.right, n.height]);
    if (bars.length === 1) return shape(name, ...bars[0]!, null, fill);
    return `<g id="${esc(name)}">${bars.map((b) => shape(null, ...b, null, fill)).join('')}</g>`;
  };

  const text = (n: PlanText, ax: number, ay: number): string => {
    stats.texts++;
    const { weight, italic } = styleToCss(n.font.style);
    const pageLines = n.autoResize === 'HEIGHT' ? options.lines?.(n.sourceId) : undefined;
    // Each line becomes its own Figma text layer, so each gets the planner's direction mark (PLG-RTL-2).
    let lines: readonly string[] = pageLines?.map((l) => withDirectionMark(l, n.direction)) ?? [
      n.characters,
    ];
    if (n.autoResize === 'HEIGHT' && lines.length < 2)
      skipped.add('some line breaks unknown (one long line)');
    if (n.textCase === 'UPPER') lines = lines.map((l) => l.toUpperCase());
    else if (n.textCase === 'LOWER') lines = lines.map((l) => l.toLowerCase());
    else if (n.textCase === 'TITLE') skipped.add('title case');
    if (n.align === 'JUSTIFIED' && lines.length > 1) skipped.add('justified text (start-aligned)');
    stats.lines += lines.length;
    // The captured box spans the glyph content areas of its lines: the first line's content starts at its top,
    // lines follow at the line height (or at the content height when line-height is normal).
    const lh = n.lineHeight.unit === 'PIXELS' ? n.lineHeight.value : null;
    const L = lines.length;
    const pitch = L > 1 ? (lh ?? n.height / L) : 0;
    const x = n.anchor === 'right' ? ax + n.width : n.anchor === 'center' ? ax + n.width / 2 : ax;
    const anchor = n.anchor === 'right' ? 'end' : n.anchor === 'center' ? 'middle' : 'start';
    const deco =
      n.decoration === 'UNDERLINE'
        ? ' text-decoration="underline"'
        : n.decoration === 'STRIKETHROUGH'
          ? ' text-decoration="line-through"'
          : '';
    const attrs =
      ` font-family="${esc(fontFamilyList(n.font))}" font-size="${num(n.fontSize)}" font-weight="${weight}"` +
      (italic ? ' font-style="italic"' : '') +
      (n.letterSpacing.value ? ` letter-spacing="${num(n.letterSpacing.value)}"` : '') +
      paintAttr(n.fill) +
      (n.opacity < 1 ? ` opacity="${num(n.opacity)}"` : '') +
      ` text-anchor="${anchor}"${deco} xml:space="preserve"`;
    // Figma puts the box top at y - font-size, so y = line top + font-size lands each box on its captured top.
    const body = lines
      .map(
        (l, i) => `<tspan x="${num(x)}" y="${num(ay + i * pitch + n.fontSize)}">${esc(l)}</tspan>`,
      )
      .join('');
    // Single line: no id, so Figma names the layer after its text. Several lines become a group named by line 1.
    return `<text${L > 1 ? ` id="${esc(id(lines[0]!.slice(0, 40)))}"` : ''}${attrs}>${body}</text>`;
  };

  /** True when some descendant is painted outside n's box (a clip elsewhere would only add a mask layer). */
  const overflows = (n: PlanBox): boolean => {
    const out = (c: PlanNode, ox: number, oy: number): boolean => {
      const x = ox + c.x;
      const y = oy + c.y;
      if (x < -0.5 || y < -0.5 || x + c.width > n.width + 0.5 || y + c.height > n.height + 0.5)
        return true;
      return c.kind === 'frame' && !c.clipsContent && c.children.some((k) => out(k, x, y));
    };
    return n.children.some((c) => out(c, 0, 0));
  };

  const placeholder = (n: Omit<PlanPlaceholder, 'kind'>, ax: number, ay: number): string => {
    stats.placeholders++;
    return shape(
      id(`${n.name} (${n.reason})`),
      ax,
      ay,
      n.width,
      n.height,
      n.radii,
      ' fill="rgb(230,232,236)" stroke="rgb(156,163,175)" stroke-dasharray="4 4"',
    );
  };

  /** Rounded corners → a clip path (Figma imports it as a mask, verified with the circle avatar case). */
  const roundClip = (
    n: { radii?: Radii; width: number; height: number },
    ax: number,
    ay: number,
  ): string => {
    const r = n.radii;
    if (!r || !(r.tl || r.tr || r.br || r.bl)) return '';
    const cid = `clip${++defId}`;
    defs.push(`<clipPath id="${cid}">${shape(null, ax, ay, n.width, n.height, r, '')}</clipPath>`);
    return ` clip-path="url(#${cid})"`;
  };

  // object-fit → preserveAspectRatio: cover crops, contain letterboxes, fill stretches (case I verified in Figma).
  const ASPECT = { FILL: 'xMidYMid slice', FIT: 'xMidYMid meet', STRETCH: 'none' } as const;

  const image = (n: PlanImage, ax: number, ay: number): string => {
    const asset = plan.images[n.assetId];
    if (!asset) return placeholder(n, ax, ay);
    stats.images++;
    return (
      `<image id="${esc(id(n.name))}" x="${num(ax)}" y="${num(ay)}" width="${num(n.width)}" height="${num(n.height)}"` +
      ` preserveAspectRatio="${ASPECT[n.scaleMode]}"${n.opacity < 1 ? ` opacity="${num(n.opacity)}"` : ''}` +
      `${roundClip(n, ax, ay)} href="data:${asset.mime};base64,${asset.data}"/>`
    );
  };

  /** Captured SVG placed as a nested <svg> at the node's box: Figma keeps it as editable vectors (case E). */
  const nestedSvg = (n: PlanSvg, ax: number, ay: number): string => {
    const open = /^<svg\b([^>]*)>/.exec(n.svg);
    if (!open) return placeholder(n, ax, ay);
    stats.svgs++;
    const attrs = open[1]!.replace(/\s(?:x|y|width|height|id)\s*=\s*("[^"]*"|'[^']*')/g, '');
    const svg =
      `<svg id="${esc(id(n.name))}" x="${num(ax)}" y="${num(ay)}" width="${num(n.width)}" height="${num(n.height)}"${attrs}>` +
      n.svg.slice(open[0].length);
    return n.opacity < 1 ? `<g opacity="${num(n.opacity)}">${svg}</g>` : svg;
  };

  const visit = (n: PlanNode, ox: number, oy: number): string => {
    const ax = ox + n.x;
    const ay = oy + n.y;
    if (n.blendMode) skipped.add('blend modes');
    if (n.kind === 'text') return text(n, ax, ay);
    if (n.kind === 'placeholder') return placeholder(n, ax, ay);
    if (n.kind === 'image') return image(n, ax, ay);
    if (n.kind === 'svg') return nestedSvg(n, ax, ay);
    stats.boxes++;
    const fill = n.fills[0];
    if (n.fills.length > 1) skipped.add('multiple fills (first kept)');
    const paint = paintAttr(fill) + filterFor(n.effects);
    const op = n.opacity < 1 ? ` opacity="${num(n.opacity)}"` : '';
    const name = id(n.name);
    const kids = n.children.map((c) => visit(c, ax, ay)).join('');
    // Leaf box: one shape named after the layer (no wrapper group).
    if (!kids && !n.strokes) return shape(name, ax, ay, n.width, n.height, n.radii, paint + op);
    // An unpainted box only exists for its border or children: no empty background layer.
    const bg =
      fill || n.effects.length
        ? shape(id(`${n.name} background`), ax, ay, n.width, n.height, n.radii, paint)
        : '';
    let inner = kids;
    if (n.clipsContent && kids && overflows(n)) {
      const cid = `clip${++defId}`;
      defs.push(
        `<clipPath id="${cid}">${shape(null, ax, ay, n.width, n.height, n.radii, '')}</clipPath>`,
      );
      inner = `<g clip-path="url(#${cid})">${kids}</g>`;
    }
    return `<g id="${esc(name)}"${op}>${bg}${inner}${strokesFor(n, ax, ay)}</g>`;
  };

  // Root: the SVG becomes a Figma frame that already clips, so content goes straight into it (no wrapper group,
  // no mask): a click selects a page section, not the whole page.
  const root = plan.root;
  const body =
    shape(
      'Background',
      0,
      0,
      root.width,
      root.height,
      null,
      root.fills[0] ? paintAttr(root.fills[0]) : ' fill="rgb(255,255,255)"',
    ) + root.children.map((c) => visit(c, 0, 0)).join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(root.width)}" height="${num(root.height)}" viewBox="0 0 ${num(root.width)} ${num(root.height)}">` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
    body +
    '</svg>';
  return { svg, stats, skipped: [...skipped] };
}
