/**
 * Pure renderer: the Figma plugin's RenderPlan (buildPlan, the exact plan the plugin executes with figma.*) → HTML.
 * No second conversion engine: coordinates, font choices, dropped paints and placeholders come from the plugin.
 *
 * ⚠ This is a BROWSER drawing of the plan, not a Figma rendering: text layout uses the browser's engine (including
 * bidi for RTL, which in Figma is unverified), blur radii and stroke joins differ, and fonts may be substituted if
 * they can't be loaded.
 */
import type {
  EffectSpec,
  PlanBox,
  PlanNode,
  PlanImage,
  PlanPlaceholder,
  PlanSvg,
  PlanText,
  RenderPlan,
  SolidPaintSpec,
} from '@h2f/figma-plugin/plan';
import { parseStyleName } from '@h2f/figma-plugin/fonts';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => Math.round(v * 100) / 100;
const px = (v: number) => `${num(v)}px`;

export function rgba(
  p: { color: { r: number; g: number; b: number }; opacity?: number },
  alpha = p.opacity ?? 1,
): string {
  const c = p.color;
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${num(alpha)})`;
}

/** Fills are bottom → top (Figma order); CSS backgrounds are top → bottom. */
function backgroundCss(fills: SolidPaintSpec[]): string {
  if (fills.length === 0) return '';
  if (fills.length === 1) return `background:${rgba(fills[0]!)};`;
  const layers = [...fills].reverse().map((f) => `linear-gradient(${rgba(f)},${rgba(f)})`);
  return `background:${layers.join(',')};`;
}

/** Figma effects are bottom → top; CSS box-shadow lists top first. */
function effectsCss(effects: EffectSpec[]): string {
  const shadows: string[] = [];
  let css = '';
  for (const e of [...effects].reverse()) {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      const color = `rgba(${Math.round(e.color.r * 255)},${Math.round(e.color.g * 255)},${Math.round(e.color.b * 255)},${num(e.color.a)})`;
      shadows.push(
        `${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius)} ${px(e.spread)} ${color}`,
      );
    } else if (e.type === 'LAYER_BLUR') css += `filter:blur(${px(e.radius / 2)});`;
    else css += `backdrop-filter:blur(${px(e.radius / 2)});`;
  }
  return (shadows.length ? `box-shadow:${shadows.join(',')};` : '') + css;
}

const BLEND: Record<string, string> = {
  MULTIPLY: 'multiply',
  SCREEN: 'screen',
  OVERLAY: 'overlay',
  DARKEN: 'darken',
  LIGHTEN: 'lighten',
  COLOR_DODGE: 'color-dodge',
  COLOR_BURN: 'color-burn',
  HARD_LIGHT: 'hard-light',
  SOFT_LIGHT: 'soft-light',
  DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion',
  HUE: 'hue',
  SATURATION: 'saturation',
  COLOR: 'color',
  LUMINOSITY: 'luminosity',
};

function common(n: PlanNode, includeSize = true): string {
  let css = `left:${px(n.x)};top:${px(n.y)};`;
  if (includeSize) css += `width:${px(n.width)};height:${px(n.height)};`;
  if (n.opacity < 1) css += `opacity:${num(n.opacity)};`;
  if (n.blendMode && BLEND[n.blendMode]) css += `mix-blend-mode:${BLEND[n.blendMode]};`;
  return css;
}

function radiiCss(r: { tl: number; tr: number; br: number; bl: number } | undefined): string {
  return r ? `border-radius:${px(r.tl)} ${px(r.tr)} ${px(r.br)} ${px(r.bl)};` : '';
}

/**
 * Figma INSIDE strokes don't move children (children are positioned from the frame's outer edge), but a CSS border
 * would (absolute children are placed inside the padding box). So strokes are drawn as an overlay that takes no space.
 */
function strokeOverlay(n: PlanBox): string {
  if (!n.strokes) return '';
  const s = n.strokes;
  const style = s.dash
    ? s.dash[0] === s.dash[1] && s.dash[0]! <= Math.max(s.top, s.right, s.bottom, s.left)
      ? 'dotted'
      : 'dashed'
    : 'solid';
  const css = `border-style:${style};border-color:${rgba(s.paint)};border-width:${px(s.top)} ${px(s.right)} ${px(s.bottom)} ${px(s.left)};`;
  return `<div class="stroke" style="${css}"></div>`;
}

function box(n: PlanBox, images: RenderPlan['images']): string {
  let css = common(n) + backgroundCss(n.fills) + radiiCss(n.radii) + effectsCss(n.effects);
  if (n.clipsContent) css += 'overflow:hidden;';
  const kids = n.children.map((c) => node(c, images)).join('');
  return `<div class="n box" data-kind="${n.kind}" data-id="${esc(n.sourceId)}" title="${esc(n.name)}" style="${css}">${strokeOverlay(n)}${kids}</div>`;
}

const DECORATION = { NONE: 'none', UNDERLINE: 'underline', STRIKETHROUGH: 'line-through' } as const;
const CASE = {
  ORIGINAL: 'none',
  UPPER: 'uppercase',
  LOWER: 'lowercase',
  TITLE: 'capitalize',
} as const;
const ALIGN = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' } as const;

function text(n: PlanText): string {
  const st = parseStyleName(n.font.style) ?? { weight: 400, italic: false };
  let css = common(n, false);
  css += `width:${px(n.width)};`;
  css += `font-family:'${n.font.family.replace(/'/g, '')}',sans-serif;font-weight:${st.weight};font-style:${st.italic ? 'italic' : 'normal'};`;
  css += `font-size:${px(n.fontSize)};line-height:${n.lineHeight.unit === 'AUTO' ? 'normal' : px(n.lineHeight.value)};`;
  css += `letter-spacing:${px(n.letterSpacing.value)};color:${rgba(n.fill)};text-align:${ALIGN[n.align]};`;
  css += `text-decoration:${DECORATION[n.decoration]};text-transform:${CASE[n.textCase]};`;
  // Single line = Figma auto-width text anchored by its aligned edge (overflows instead of wrapping);
  // multi-line = fixed width, height grows.
  css += n.autoResize === 'WIDTH_AND_HEIGHT' ? 'white-space:pre;' : 'white-space:pre-wrap;';
  return `<div class="n text" data-kind="text" data-id="${esc(n.sourceId)}" dir="${n.direction}" title="${esc(n.name)}" style="${css}">${esc(n.characters)}</div>`;
}

function placeholder(n: PlanPlaceholder): string {
  const css = common(n) + radiiCss(n.radii);
  return `<div class="n ph" data-kind="placeholder" data-id="${esc(n.sourceId)}" title="${esc(`${n.name}: ${n.reason}`)}" style="${css}"><span class="ph-label">${esc(n.reason)}</span></div>`;
}

const FIT = { FILL: 'cover', FIT: 'contain', STRETCH: 'fill' } as const;

/** Captured pixels or SVG drawn as <img> (an SVG in <img> never runs scripts). */
function media(n: PlanImage | PlanSvg, images: RenderPlan['images']): string {
  const src =
    n.kind === 'svg'
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(n.svg)}`
      : `data:${images[n.assetId]!.mime};base64,${images[n.assetId]!.data}`;
  const css =
    common(n) + radiiCss(n.radii) + (n.kind === 'image' ? `object-fit:${FIT[n.scaleMode]};` : '');
  return `<img class="n media" data-kind="${n.kind}" data-id="${esc(n.sourceId)}" title="${esc(n.name)}" alt="" src="${src}" style="${css}">`;
}

function node(n: PlanNode, images: RenderPlan['images']): string {
  if (n.kind === 'text') return text(n);
  if (n.kind === 'placeholder') return placeholder(n);
  if (n.kind === 'image' || n.kind === 'svg') return media(n, images);
  return box(n, images);
}

/** HTML for the whole plan. The root is positioned at (0, 0) at its natural size; zoom/pan are applied outside. */
export function renderPlanHtml(plan: RenderPlan): string {
  const r = plan.root;
  const css = `left:0;top:0;width:${px(r.width)};height:${px(r.height)};${backgroundCss(r.fills.length ? r.fills : [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }])}overflow:hidden;`;
  return `<div class="n box root" data-kind="frame" data-id="${esc(r.sourceId)}" title="${esc(r.name)}" style="${css}">${r.children.map((c) => node(c, plan.images)).join('')}</div>`;
}

/** Google Fonts stylesheet URLs for the families the plan uses (one per family, so one unknown family can't break all). */
export function fontStylesheets(plan: RenderPlan): string[] {
  const byFamily = new Map<string, Set<string>>();
  for (const f of plan.fonts) {
    const st = parseStyleName(f.style) ?? { weight: 400, italic: false };
    const set = byFamily.get(f.family) ?? new Set<string>();
    set.add(`${st.italic ? 1 : 0},${st.weight}`);
    byFamily.set(f.family, set);
  }
  return [...byFamily.entries()].map(([family, axes]) => {
    const list = [...axes].sort().join(';');
    return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${list}&display=swap`;
  });
}

/** Counts of rendered elements by kind (for stats and tests). */
export function planCounts(plan: RenderPlan): Record<PlanNode['kind'], number> {
  const c = { frame: 0, rect: 0, text: 0, placeholder: 0, image: 0, svg: 0 };
  const visit = (n: PlanNode) => {
    c[n.kind]++;
    if (n.kind === 'frame' || n.kind === 'rect') n.children.forEach(visit);
  };
  visit(plan.root);
  return c;
}
