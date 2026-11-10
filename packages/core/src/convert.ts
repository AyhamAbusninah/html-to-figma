/**
 * RawElement tree → CaptureDocument nodes (pure). Implements, for the MVP slice:
 * geometry (EXT-G-1, EXT-RTL-4), pruning/hoisting (EXT-T-5/6), simplified paint order (EXT-T-8), box styles
 * (EXT-V-2/4/5/6/7/8), text (EXT-X-1..5, EXT-RTL-1/2/5), form controls (EXT-X-6/7), replaced elements as explicit
 * placeholders, and warnings for everything not captured yet.
 */
import type {
  CaptureNode,
  CaptureWarning,
  Effect,
  FrameNode,
  ImageNode,
  Paint,
  RGBA,
  SvgNode,
  TextNode,
} from '@h2f/schema';
import {
  isTranslationOnly,
  isVisuallyHidden,
  parseBlendMode,
  parseBorder,
  parseBoxShadow,
  parseRadii,
  px,
  solidOrNull,
} from './css.ts';
import { isTransparent, parseCssColor } from './color.ts';
import { gradientTextColor, parseBackgroundLayers } from './gradient.ts';
import type { RawElement, RawImageAsset, RawRect, RawText, RawTextLine } from './raw-snapshot.ts';
import {
  countLines,
  groupLines,
  normalizeWhitespace,
  resolveTextAlign,
  textStyle,
} from './text.ts';

export const MAX_NODES = 10_000;

export class CaptureTooLargeError extends Error {
  readonly nodeCount: number;
  constructor(nodeCount: number) {
    super(`Page has more than ${MAX_NODES} visible elements. Capture a section instead.`);
    this.nodeCount = nodeCount;
  }
}

/** Codes reported once per document with a count (high-volume, low per-node value). */
const AGGREGATED = new Set([
  'BACKGROUND_IMAGE_NOT_CAPTURED',
  'GRADIENT_NOT_CAPTURED',
  'PSEUDO_ELEMENT_NOT_CAPTURED',
  'BORDER_STYLE_DEGRADED',
  'BLEND_MODE_UNSUPPORTED',
  'FILTER_UNSUPPORTED',
  'CLIP_MASK_UNSUPPORTED',
  'ARABIC_LETTER_SPACING_IGNORED',
  'TRANSFORM_UNSUPPORTED',
  'TEXT_ELLIPSIS_NOT_APPLIED',
  'IMAGE_FETCH_FAILED',
  'GRADIENT_UNSUPPORTED',
]);

/** Serialized SVGs above this become raster-only / placeholders (EXT-S-6). */
export const MAX_SVG_BYTES = 512 * 1024;

const AGGREGATED_MESSAGE: Record<string, string> = {
  BACKGROUND_IMAGE_NOT_CAPTURED:
    'CSS background images are not captured yet (R4); layers are named "⚠ bg-image".',
  GRADIENT_NOT_CAPTURED: 'CSS gradients are not captured yet; layers are named "⚠ gradient".',
  PSEUDO_ELEMENT_NOT_CAPTURED: '::before/::after content is not captured yet.',
  BORDER_STYLE_DEGRADED: 'double/groove/ridge/inset/outset borders rendered as solid.',
  BLEND_MODE_UNSUPPORTED: 'Unsupported mix-blend-mode values ignored.',
  FILTER_UNSUPPORTED: 'CSS filters other than blur ignored.',
  CLIP_MASK_UNSUPPORTED: 'clip-path / mask ignored (element rendered unclipped).',
  ARABIC_LETTER_SPACING_IGNORED: 'letter-spacing set to 0 on Arabic text (EXT-RTL-5).',
  TRANSFORM_UNSUPPORTED: 'Rotated/scaled/skewed elements captured as their bounding box.',
  GRADIENT_UNSUPPORTED:
    'Repeating and conic gradients are replaced by their first color (EXT-V-3).',
  IMAGE_FETCH_FAILED:
    'Some images could not be read (cross-origin without CORS, or not loaded); placeholders instead (EXT-I-5).',
  TEXT_ELLIPSIS_NOT_APPLIED:
    'text-overflow: ellipsis not reproduced yet; truncated text is clipped without "…" (EXT-X-8).',
};

interface Ctx {
  offsetX: number;
  offsetY: number;
  nextId: number;
  nodeCount: number;
  textCount: number;
  imageCount: number;
  svgCount: number;
  warnings: CaptureWarning[];
  aggregated: Map<string, { count: number; nodeIds: string[] }>;
  /** Side output, not part of CaptureDocument: the page's own line breaks of multi-line TEXT nodes, by node id. */
  textLines: Map<string, string[]>;
  /** Encoded images from the collector, and the ids actually referenced by emitted nodes (only those are kept). */
  assets?: Record<string, RawImageAsset>;
  usedAssets: Set<string>;
  /** Set while converting the content of a `background-clip: text` element: color for its transparent text. */
  clipTextColor?: RGBA | null;
}

interface OrderKey {
  layer: number; // 0 negative z · 1 in-flow · 2 positioned auto/0 · 3 positive z
  z: number;
  path: number[]; // DOM order
}

interface Emitted {
  node: CaptureNode;
  key: OrderKey;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function createContext(offsetX: number, offsetY: number): Ctx {
  return {
    offsetX,
    offsetY,
    nextId: 1,
    nodeCount: 1,
    textCount: 0,
    imageCount: 0,
    svgCount: 0,
    warnings: [],
    aggregated: new Map(),
    textLines: new Map(),
    usedAssets: new Set(),
  };
}

/** Exported side output of a conversion (see Ctx.textLines). */
export function collectTextLines(ctx: Ctx): Record<string, string[]> {
  return Object.fromEntries(ctx.textLines);
}

function warn(ctx: Ctx, code: string, nodeId: string, message: string, detail?: string) {
  if (AGGREGATED.has(code)) {
    const a = ctx.aggregated.get(code) ?? { count: 0, nodeIds: [] };
    a.count++;
    if (a.nodeIds.length < 20) a.nodeIds.push(nodeId);
    ctx.aggregated.set(code, a);
    return;
  }
  ctx.warnings.push({ code, message, nodeId, ...(detail ? { detail } : {}) });
}

/** Final warnings list: per-node warnings + one entry per aggregated code. */
export function collectWarnings(ctx: Ctx): CaptureWarning[] {
  const agg = [...ctx.aggregated.entries()].map(([code, a]) => ({
    code,
    message: `${AGGREGATED_MESSAGE[code] ?? code} (${a.count}×)`,
    detail: `nodes: ${a.nodeIds.join(', ')}${a.count > a.nodeIds.length ? ', …' : ''}`,
  }));
  return [...ctx.warnings, ...agg];
}

/** Ids are unique and deterministic (traversal order); pruned wrappers leave gaps (NFR-2). */
function newId(ctx: Ctx): string {
  return `n${ctx.nextId++}`;
}

/** Counts an emitted node and enforces the hard limit (EXT-T-10). */
function countNode(ctx: Ctx): void {
  ctx.nodeCount++;
  if (ctx.nodeCount > MAX_NODES) throw new CaptureTooLargeError(ctx.nodeCount);
}

function toDoc(ctx: Ctx, r: RawRect) {
  return {
    x: round2(r.x + ctx.offsetX),
    y: round2(r.y + ctx.offsetY),
    width: round2(Math.max(0, r.width)),
    height: round2(Math.max(0, r.height)),
  };
}

function unionRect(rects: readonly RawRect[]): RawRect {
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.width));
  const y2 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function layerName(el: RawElement): string {
  const name =
    el.tag +
    (el.idAttr ? `#${el.idAttr}` : '') +
    el.classes
      .slice(0, 3)
      .map((c) => `.${c}`)
      .join('');
  return name.length > 64 ? `${name.slice(0, 63)}…` : name;
}

function compareKeys(a: OrderKey, b: OrderKey): number {
  if (a.layer !== b.layer) return a.layer - b.layer;
  if (a.z !== b.z) return a.z - b.z;
  const n = Math.min(a.path.length, b.path.length);
  for (let i = 0; i < n; i++) if (a.path[i] !== b.path[i]) return a.path[i]! - b.path[i]!;
  return a.path.length - b.path.length;
}

const sorted = (items: Emitted[]) =>
  [...items].sort((a, b) => compareKeys(a.key, b.key)).map((e) => e.node);

const CLIPPING = new Set(['hidden', 'clip', 'auto', 'scroll']);

function textNode(
  ctx: Ctx,
  characters: string,
  rect: ReturnType<typeof toDoc>,
  lineCount: number,
  style: RawElement['style'],
  colorOverride?: string,
): TextNode {
  const id = newId(ctx);
  const { style: ts, arabicLetterSpacingIgnored } = textStyle(
    colorOverride ? { ...style, color: colorOverride } : style,
    characters,
  );
  if (arabicLetterSpacingIgnored) warn(ctx, 'ARABIC_LETTER_SPACING_IGNORED', id, '');
  countNode(ctx);
  ctx.textCount++;
  return {
    id,
    name: characters.replace(/\s+/g, ' ').slice(0, 40),
    type: 'TEXT',
    rect,
    opacity: 1,
    characters,
    lineCount,
    style: ts,
  };
}

/**
 * Line ranges from the collector, or undefined when they are absent or inconsistent (then the text node is
 * converted as one block, the pre-OQ-11 behavior).
 */
function usableLines(raw: RawText): RawTextLine[] | undefined {
  const lines = raw.lines;
  if (!lines || lines.length < 2) return undefined;
  let prev = 0;
  for (const l of lines) {
    if (l.start < prev || l.end <= l.start || l.end > raw.text.length) return undefined;
    if (!l.rects.some((r) => r.width > 0 && r.height > 0)) return undefined;
    prev = l.end;
  }
  return lines;
}

function convertText(raw: RawText, parent: RawElement, ctx: Ctx, path: number[]): Emitted[] {
  if (parent.style.visibility !== 'visible' || raw.rects.length === 0) return [];
  // Transparent text inside a background-clip:text element takes the gradient's color.
  const clip = ctx.clipTextColor;
  const override =
    clip && isTransparent(parseCssColor(parent.style.color))
      ? `rgba(${Math.round(clip.r * 255)}, ${Math.round(clip.g * 255)}, ${Math.round(clip.b * 255)}, ${clip.a})`
      : undefined;
  const whiteSpace = parent.style['white-space'];
  const characters = normalizeWhitespace(raw.text, whiteSpace);
  if (!characters) return [];
  const lines = usableLines(raw);
  const runs = lines
    ? groupLines(
        lines.map((l) => ({ rects: l.rects.filter((r) => r.width > 0 && r.height > 0) })),
        resolveTextAlign(parent.style['text-align'], parent.style.direction),
        parent.style.direction,
      )
    : [];
  // The browser's line breaks for each line of the text node (used by Copy to Figma, which can't re-wrap text).
  const lineText = (l: RawTextLine) =>
    normalizeWhitespace(raw.text.slice(l.start, l.end), whiteSpace).replace(/\n$/, '');
  if (lines && runs.length > 1) {
    // One TEXT per run of lines that share their aligned edge (OQ-11): exact position for a text node that
    // starts or ends mid-line, and a plain paragraph still stays one editable layer.
    const out: Emitted[] = [];
    runs.forEach(([first, last], i) => {
      const slice = raw.text.slice(lines[first]!.start, lines[last]!.end);
      const chars = normalizeWhitespace(slice, whiteSpace).replace(/\n$/, '');
      if (!chars) return;
      const rects = lines.slice(first, last + 1).flatMap((l) => l.rects);
      const visible = rects.filter((r) => r.width > 0 && r.height > 0);
      const node = textNode(
        ctx,
        chars,
        toDoc(ctx, unionRect(visible)),
        last - first + 1,
        parent.style,
        override,
      );
      if (last > first) ctx.textLines.set(node.id, lines.slice(first, last + 1).map(lineText));
      out.push({ node, key: { layer: 1, z: 0, path: [...path, i] } });
    });
    return out;
  }
  const node = textNode(
    ctx,
    characters,
    toDoc(ctx, unionRect(raw.rects)),
    countLines(raw.rects),
    parent.style,
    override,
  );
  if (lines) ctx.textLines.set(node.id, lines.map(lineText));
  return [{ node, key: { layer: 1, z: 0, path } }];
}

/** Text for <input>/<textarea>/<select>, placed in the content box (EXT-X-6). Passwords stay masked (EXT-X-7). */
function controlText(el: RawElement, ctx: Ctx): TextNode | null {
  const c = el.control!;
  let text = c.text;
  if (c.inputType === 'password' && !c.isPlaceholder) text = '•'.repeat([...text].length); // defense in depth
  if (c.kind === 'other' || !text) return null;
  const s = el.style;
  const cb = {
    x: el.rect.x + px(s['border-left-width']) + px(s['padding-left']),
    y: el.rect.y + px(s['border-top-width']) + px(s['padding-top']),
    width:
      el.rect.width -
      px(s['border-left-width']) -
      px(s['border-right-width']) -
      px(s['padding-left']) -
      px(s['padding-right']),
    height:
      el.rect.height -
      px(s['border-top-width']) -
      px(s['border-bottom-width']) -
      px(s['padding-top']) -
      px(s['padding-bottom']),
  };
  const fontSize = px(s['font-size'], 16);
  const lh = s['line-height'] === 'normal' ? fontSize * 1.2 : px(s['line-height'], fontSize * 1.2);
  const lines =
    c.kind === 'textarea'
      ? Math.max(1, Math.min(text.split('\n').length, Math.floor(cb.height / lh) || 1))
      : 1;
  const height = lines === 1 ? lh : Math.min(cb.height, lines * lh);
  const y = lines === 1 ? cb.y + (cb.height - lh) / 2 : cb.y;
  const characters = c.kind === 'textarea' ? text : text.replace(/\s+/g, ' ');
  return textNode(
    ctx,
    characters,
    toDoc(ctx, { x: cb.x, y, width: Math.max(0, cb.width), height }),
    lines,
    s,
    c.isPlaceholder ? c.placeholderColor : undefined,
  );
}

const OBJECT_FIT: Record<string, ImageNode['scaleMode']> = {
  cover: 'FILL',
  contain: 'FIT',
  'scale-down': 'FIT',
};

export function convertElement(el: RawElement, ctx: Ctx, path: number[]): Emitted[] {
  const s = el.style;
  const opacity = px(s.opacity, 1);
  if (opacity <= 0) return [];

  const positioned = s.position !== 'static';
  const zRaw = s['z-index'];
  const z = positioned && zRaw !== 'auto' ? parseInt(zRaw, 10) || 0 : null;
  const key: OrderKey = {
    layer: !positioned ? 1 : z !== null && z < 0 ? 0 : z === null || z === 0 ? 2 : 3,
    z: z ?? 0,
    path,
  };
  const rect = toDoc(ctx, el.rect);
  if (isVisuallyHidden(s, rect.width, rect.height)) return []; // screen-reader-only content
  const zeroArea = rect.width <= 0 || rect.height <= 0;
  const hidden = s.visibility !== 'visible';
  const radii = zeroArea ? null : parseRadii(s, rect.width, rect.height);

  // Replaced content: SVG markup or encoded pixels from the collector's asset phase (R4), else a placeholder.
  if (el.replaced) {
    if (zeroArea || hidden) return [];
    const id = newId(ctx);
    const kind = el.replaced.kind;
    const op = Math.round(opacity * 1000) / 1000;
    if (el.svg && el.svg.length <= MAX_SVG_BYTES) {
      countNode(ctx);
      ctx.svgCount++;
      const node: SvgNode = {
        id,
        name: layerName(el),
        type: 'SVG',
        rect,
        opacity: op,
        svg: el.svg,
        fallbackAssetId: null,
      };
      return [{ node, key }];
    }
    if (el.svg)
      warn(
        ctx,
        'SVG_TOO_LARGE',
        id,
        `Serialized SVG is ${Math.round(el.svg.length / 1024)} KB, above the 512 KB limit; placeholder.`,
      );
    if (el.assetId && ctx.assets?.[el.assetId]) {
      countNode(ctx);
      ctx.imageCount++;
      ctx.usedAssets.add(el.assetId);
      const node: ImageNode = {
        id,
        name: layerName(el),
        type: 'IMAGE',
        rect,
        opacity: op,
        assetId: el.assetId,
        scaleMode: OBJECT_FIT[s['object-fit']] ?? 'STRETCH',
        ...(radii ? { radii } : {}),
      };
      return [{ node, key }];
    }
    if (el.assetFailed) warn(ctx, 'IMAGE_FETCH_FAILED', id, '');
    const code =
      kind === 'svg'
        ? 'SVG_NOT_CAPTURED'
        : kind === 'iframe'
          ? 'IFRAME_NOT_CAPTURED'
          : 'IMAGE_NOT_CAPTURED';
    if (!el.assetFailed && !el.svg)
      warn(
        ctx,
        code,
        id,
        `<${kind}> content is not captured yet (R4); rendered as a placeholder.`,
        kind,
      );
    countNode(ctx);
    if (kind === 'svg') ctx.svgCount++;
    else ctx.imageCount++;
    const node: ImageNode = {
      id,
      name: `⚠ ${layerName(el)}`,
      type: 'IMAGE',
      rect,
      opacity: Math.round(opacity * 1000) / 1000,
      assetId: null,
      scaleMode: OBJECT_FIT[s['object-fit']] ?? 'STRETCH',
      ...(radii ? { radii } : {}),
    };
    return [{ node, key }];
  }

  const id = newId(ctx);
  const rootish = el.tag === 'html' || el.tag === 'body';
  const fills: Paint[] = [];
  const bg = solidOrNull(s['background-color']);
  if (bg && !hidden && !rootish && !zeroArea) fills.push({ type: 'SOLID', color: bg });

  // Background layers (EXT-V-3, EXT-I-8): CSS lists them top first; Figma fills go bottom → top, above the color.
  const bgImage = s['background-image'] ?? 'none';
  const painted = !hidden && !zeroArea;
  // background-clip: text paints the background through the glyphs: approximated by giving the (transparent) text
  // the gradient's first color, with no background fill (GRADIENT_UNSUPPORTED).
  const clipText = /\btext\b/.test(s['background-clip'] ?? '');
  const textColor = clipText ? gradientTextColor(bgImage, rect.width, rect.height) : null;
  if (clipText && bgImage !== 'none') warn(ctx, 'GRADIENT_UNSUPPORTED', id, '');
  const layers =
    painted && !rootish && !clipText ? parseBackgroundLayers(bgImage, rect.width, rect.height) : [];
  let hasBgUrl = painted && rootish && /url\(/.test(bgImage); // page backgrounds: color only (root frame)
  let unsupportedGradient = false;
  for (const layer of [...layers].reverse()) {
    if (layer.kind === 'paint') fills.push(layer.paint);
    else if (layer.kind === 'url') {
      const assetId = el.bgAssets?.[layer.urlIndex];
      if (assetId && ctx.assets?.[assetId]) {
        fills.push({ type: 'IMAGE', assetId, scaleMode: 'FILL' });
        ctx.usedAssets.add(assetId);
      } else hasBgUrl = true;
    } else {
      unsupportedGradient = true;
      if (layer.fallback && !isTransparent(layer.fallback))
        fills.push({ type: 'SOLID', color: layer.fallback });
    }
  }
  const hasGradient = false;
  if (hasBgUrl) warn(ctx, 'BACKGROUND_IMAGE_NOT_CAPTURED', id, '');
  if (unsupportedGradient) warn(ctx, 'GRADIENT_UNSUPPORTED', id, '');

  const { border, degraded } = hidden || zeroArea ? { border: null, degraded: [] } : parseBorder(s);
  if (degraded.length) warn(ctx, 'BORDER_STYLE_DEGRADED', id, '');
  const effects: Effect[] = hidden || zeroArea ? [] : parseBoxShadow(s['box-shadow']);
  const filter = s.filter ?? 'none';
  const blur = /^blur\(([\d.]+)px\)$/.exec(filter.trim());
  if (blur) effects.push({ type: 'LAYER_BLUR', radius: parseFloat(blur[1]!) });
  else if (filter !== 'none') warn(ctx, 'FILTER_UNSUPPORTED', id, '');
  if ((s['clip-path'] ?? 'none') !== 'none') warn(ctx, 'CLIP_MASK_UNSUPPORTED', id, ''); // (fully hidden insets skipped above)
  if (!isTranslationOnly(s.transform)) warn(ctx, 'TRANSFORM_UNSUPPORTED', id, '');
  const { blendMode, unsupported } = parseBlendMode(s['mix-blend-mode']);
  if (unsupported) warn(ctx, 'BLEND_MODE_UNSUPPORTED', id, '', unsupported);
  if (el.pseudo?.before) warn(ctx, 'PSEUDO_ELEMENT_NOT_CAPTURED', id, '');
  if (el.pseudo?.after) warn(ctx, 'PSEUDO_ELEMENT_NOT_CAPTURED', id, '');
  if (el.ellipsisTruncated) warn(ctx, 'TEXT_ELLIPSIS_NOT_APPLIED', id, '');
  if (el.control?.kind === 'other') {
    warn(
      ctx,
      'NATIVE_CONTROL_APPROXIMATED',
      id,
      `Native <input type="${el.control.inputType}"> is approximated by its box styles.`,
    );
  }

  const clips = !zeroArea && (CLIPPING.has(s['overflow-x']) || CLIPPING.has(s['overflow-y']));
  const stackingContext =
    (z !== null || opacity < 1 || !isTranslationOnly(s.transform) || filter !== 'none') &&
    !zeroArea;

  // Children (controls render their value instead of DOM children).
  const children: Emitted[] = [];
  if (el.control) {
    const t = controlText(el, ctx);
    if (t) children.push({ node: t, key: { layer: 1, z: 0, path: [...path, 0] } });
  }
  const outerClipText = ctx.clipTextColor;
  if (textColor) ctx.clipTextColor = textColor;
  el.children.forEach((child, i) => {
    const childPath = [...path, i + 1];
    if (child.kind === 'text') children.push(...convertText(child, el, ctx, childPath));
    else children.push(...convertElement(child, ctx, childPath));
  });
  ctx.clipTextColor = outerClipText;

  const paints = fills.length > 0 || border !== null || effects.length > 0;
  const needsFrame =
    !zeroArea &&
    (paints || clips || stackingContext || Boolean(blendMode) || hasBgUrl || hasGradient);
  if (!needsFrame) return children; // hoisted, keeping their own order keys (EXT-T-5/6)
  countNode(ctx);

  const suffix = hasBgUrl ? ' ⚠ bg-image' : hasGradient ? ' ⚠ gradient' : '';
  const frame: FrameNode = {
    id,
    name: `${layerName(el)}${suffix}`,
    type: 'FRAME',
    rect,
    opacity: Math.round(opacity * 1000) / 1000,
    ...(blendMode ? { blendMode } : {}),
    fills,
    ...(border ? { strokes: border } : {}),
    ...(radii ? { radii } : {}),
    ...(effects.length ? { effects } : {}),
    clipsContent: clips,
    children: sorted(children),
  };
  return [{ node: frame, key }];
}

/** Converts the <html> subtree into root children (html/body never paint a fill; the root carries it). */
export function convertTree(tree: RawElement, ctx: Ctx): CaptureNode[] {
  return sorted(convertElement(tree, ctx, [0]));
}
