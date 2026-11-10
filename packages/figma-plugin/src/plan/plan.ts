/**
 * Pure render planner: CaptureDocument → RenderPlan (TST-4). Everything that can be decided without Figma is
 * decided here, so it's unit-testable on Fedora: parent-relative coordinates (PLG-R-2), paint/stroke/effect mapping
 * (PLG-R-4..6), text properties and sizing (PLG-R-9/9a), font resolution (PLG-F-*), RTL base-direction marks
 * (PLG-RTL-2), placeholders for content not captured (PLG-R-7).
 * The adapter (../adapter/render.ts) only executes the plan.
 */
import type {
  CaptureDocument,
  CaptureNode,
  Effect,
  FrameNode,
  Paint,
  RGBA,
  TextNode,
} from '@h2f/schema';
import { FontResolver, type FontName } from './fonts.ts';

export type { FontName } from './fonts.ts';

export type SolidPaintSpec = {
  type: 'SOLID';
  color: { r: number; g: number; b: number };
  opacity: number;
};
export type EffectSpec =
  | {
      type: 'DROP_SHADOW' | 'INNER_SHADOW';
      color: RGBA;
      offset: { x: number; y: number };
      radius: number;
      spread: number;
      visible: true;
      blendMode: 'NORMAL';
    }
  | { type: 'LAYER_BLUR' | 'BACKGROUND_BLUR'; blurType: 'NORMAL'; radius: number; visible: true };

interface PlanBase {
  sourceId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  blendMode?: string;
}

export interface PlanBox extends PlanBase {
  /** frame: has children or clips; rect: a leaf box. */
  kind: 'frame' | 'rect';
  fills: SolidPaintSpec[];
  strokes?: {
    paint: SolidPaintSpec;
    top: number;
    right: number;
    bottom: number;
    left: number;
    dash?: number[];
  };
  radii?: { tl: number; tr: number; br: number; bl: number };
  effects: EffectSpec[];
  clipsContent: boolean;
  children: PlanNode[];
}

export interface PlanText extends PlanBase {
  kind: 'text';
  characters: string;
  /** Paragraph direction from the page (used by the local preview; Figma infers direction itself, unverified). */
  direction: 'ltr' | 'rtl';
  font: FontName;
  fontSize: number;
  lineHeight: { unit: 'AUTO' } | { unit: 'PIXELS'; value: number };
  letterSpacing: { unit: 'PIXELS'; value: number };
  fill: SolidPaintSpec;
  align: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  decoration: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  textCase: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';
  /** Single line → WIDTH_AND_HEIGHT, anchored by its aligned edge (PLG-R-9a); multi-line → fixed width, HEIGHT. */
  autoResize: 'WIDTH_AND_HEIGHT' | 'HEIGHT';
  anchor: 'left' | 'center' | 'right';
}

export interface PlanPlaceholder extends PlanBase {
  kind: 'placeholder';
  reason: string;
  radii?: { tl: number; tr: number; br: number; bl: number };
}

/**
 * Captured pixels (`RenderPlan.images[assetId]`) or SVG markup. Drawn by Copy to Figma (SVG) and the preview; the
 * plugin adapter still draws them as placeholders with `reason` (image/SVG node creation in the plugin is pending).
 */
export interface PlanImage extends Omit<PlanPlaceholder, 'kind'> {
  kind: 'image';
  assetId: string;
  scaleMode: 'FILL' | 'FIT' | 'STRETCH';
}
export interface PlanSvg extends Omit<PlanPlaceholder, 'kind'> {
  kind: 'svg';
  svg: string;
}

export type PlanNode = PlanBox | PlanText | PlanPlaceholder | PlanImage | PlanSvg;

export interface FontSubstitution {
  requested: string;
  weight: number;
  italic: boolean;
  used: FontName;
  arabicRule: boolean;
  count: number;
}

export interface RenderPlan {
  root: PlanBox;
  /** Encoded images referenced by PlanImage nodes (the document's assets). */
  images: CaptureDocument['assets']['images'];
  /** Unique fonts to load before creating text (PLG-F-1). */
  fonts: FontName[];
  substitutions: FontSubstitution[];
  counts: { boxes: number; texts: number; placeholders: number; total: number };
  unsupported: string[];
}

const RLM = '\u200F';
const LRM = '\u200E';
// Strong-direction detection for PLG-RTL-2 (Latin/Greek/Cyrillic vs Hebrew/Arabic blocks; digits are weak).
const STRONG_L = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
const STRONG_R = /[֐-ࣿיִ-﷿ﹰ-\uFEFF]/;
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-\uFEFF]/;

function firstStrong(s: string): 'L' | 'R' | null {
  for (const ch of s) {
    if (STRONG_R.test(ch)) return 'R';
    if (STRONG_L.test(ch)) return 'L';
  }
  return null;
}

/**
 * PLG-RTL-2 (provisional, pending S4): prefix an invisible direction mark when the paragraph direction from the page
 * disagrees with the first strong character. UNVERIFIED in Figma (S4-A deferred, S4-B outstanding).
 */
export function withDirectionMark(characters: string, direction: 'ltr' | 'rtl'): string {
  const fs = firstStrong(characters);
  if (direction === 'rtl' && fs === 'L') return RLM + characters;
  if (direction === 'ltr' && fs === 'R') return LRM + characters;
  return characters;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const solid = (c: RGBA): SolidPaintSpec => ({
  type: 'SOLID',
  color: { r: r4(c.r), g: r4(c.g), b: r4(c.b) },
  opacity: r4(c.a),
});

function mapFills(fills: Paint[], unsupported: Set<string>): SolidPaintSpec[] {
  const out: SolidPaintSpec[] = [];
  for (const p of fills) {
    if (p.type === 'SOLID') out.push(solid(p.color));
    else unsupported.add(`${p.type} paint`); // gradients/images: R2+/R4
  }
  return out;
}

function mapEffects(effects: Effect[] | undefined): EffectSpec[] {
  if (!effects) return [];
  // CSS paints the first shadow on top. Assumed: Figma stacks effects in array order (later on top), so the CSS
  // order is reversed. UNVERIFIED in real Figma (R5).
  return [...effects].reverse().map((e): EffectSpec =>
    'color' in e
      ? {
          type: e.type,
          color: e.color,
          offset: e.offset,
          radius: e.radius,
          spread: e.spread,
          visible: true,
          blendMode: 'NORMAL',
        }
      : { type: e.type, blurType: 'NORMAL', radius: e.radius, visible: true },
  );
}

function mapStrokes(node: FrameNode): PlanBox['strokes'] {
  const b = node.strokes;
  if (!b) return undefined;
  const sides = [b.top, b.right, b.bottom, b.left];
  const widest = sides.reduce((a, s) => (s.width > a.width ? s : a));
  const dash =
    widest.style === 'dashed'
      ? [widest.width * 3, widest.width * 3]
      : widest.style === 'dotted'
        ? [widest.width, widest.width]
        : undefined;
  return {
    paint: solid(widest.color),
    top: b.top.width,
    right: b.right.width,
    bottom: b.bottom.width,
    left: b.left.width,
    ...(dash ? { dash } : {}),
  };
}

const ALIGN = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED' } as const;
const DECORATION = {
  none: 'NONE',
  underline: 'UNDERLINE',
  'line-through': 'STRIKETHROUGH',
} as const;
const CASE = { none: 'ORIGINAL', upper: 'UPPER', lower: 'LOWER', title: 'TITLE' } as const;

export function buildPlan(doc: CaptureDocument, availableFonts: readonly FontName[]): RenderPlan {
  const resolver = new FontResolver(availableFonts, doc.meta.lang);
  const fonts = new Map<string, FontName>();
  const subs = new Map<string, FontSubstitution>();
  const unsupported = new Set<string>();
  const counts = { boxes: 0, texts: 0, placeholders: 0, total: 0 };

  const base = (n: CaptureNode, parent: { x: number; y: number }) => ({
    sourceId: n.id,
    name: n.name,
    x: n.rect.x - parent.x,
    y: n.rect.y - parent.y,
    width: n.rect.width,
    height: n.rect.height,
    opacity: n.opacity,
    ...(n.blendMode ? { blendMode: n.blendMode } : {}),
  });

  const text = (n: TextNode, parent: { x: number; y: number }): PlanText => {
    const s = n.style;
    const arabic = ARABIC.test(n.characters);
    const r = resolver.resolve({
      families: s.fontFamilies,
      weight: s.fontWeight,
      italic: s.fontStyle === 'italic',
      arabic,
    });
    fonts.set(`${r.font.family}|${r.font.style}`, r.font);
    if (r.substituted) {
      const key = `${r.requested}|${s.fontWeight}|${s.fontStyle}|${r.font.family}|${r.font.style}`;
      const prev = subs.get(key);
      if (prev) prev.count++;
      else
        subs.set(key, {
          requested: r.requested,
          weight: s.fontWeight,
          italic: s.fontStyle === 'italic',
          used: r.font,
          arabicRule: r.arabicRule,
          count: 1,
        });
    }
    const single = n.lineCount <= 1;
    counts.texts++;
    return {
      ...base(n, parent),
      kind: 'text',
      characters: withDirectionMark(n.characters, s.direction),
      direction: s.direction,
      font: r.font,
      fontSize: Math.max(1, s.fontSize), // Figma requires >= 1
      lineHeight:
        s.lineHeight === 'normal' ? { unit: 'AUTO' } : { unit: 'PIXELS', value: s.lineHeight },
      letterSpacing: { unit: 'PIXELS', value: s.letterSpacing },
      fill: solid(s.color),
      align: ALIGN[s.textAlign],
      decoration: DECORATION[s.textDecoration],
      textCase: CASE[s.textCase],
      autoResize: single ? 'WIDTH_AND_HEIGHT' : 'HEIGHT',
      anchor: s.textAlign === 'right' ? 'right' : s.textAlign === 'center' ? 'center' : 'left',
    };
  };

  const visit = (n: CaptureNode, parent: { x: number; y: number }): PlanNode => {
    counts.total++;
    if (n.type === 'TEXT') return text(n, parent);
    if (n.type === 'IMAGE' || n.type === 'SVG') {
      counts.placeholders++;
      const reason =
        n.type === 'SVG'
          ? 'SVG not captured yet (R4)'
          : n.assetId === null
            ? 'image not captured'
            : 'image assets not rendered yet (R4)';
      if (n.type === 'SVG' || n.assetId !== null) unsupported.add(`${n.type} rendering`);
      const radii = n.type === 'IMAGE' && n.radii ? { radii: n.radii } : {};
      if (n.type === 'SVG')
        return { ...base(n, parent), kind: 'svg', reason, svg: n.svg, ...radii };
      if (n.assetId !== null && doc.assets.images[n.assetId])
        return {
          ...base(n, parent),
          kind: 'image',
          reason,
          assetId: n.assetId,
          scaleMode: n.scaleMode,
          ...radii,
        };
      return { ...base(n, parent), kind: 'placeholder', reason, ...radii };
    }
    counts.boxes++;
    const children = n.children.map((c) => visit(c, n.rect));
    return {
      ...base(n, parent),
      kind: children.length > 0 || n.clipsContent ? 'frame' : 'rect',
      fills: mapFills(n.fills, unsupported),
      ...(n.strokes ? { strokes: mapStrokes(n) } : {}),
      ...(n.radii ? { radii: n.radii } : {}),
      effects: mapEffects(n.effects),
      clipsContent: n.clipsContent,
      children,
    };
  };

  const root = visit(doc.root, { x: 0, y: 0 }) as PlanBox;
  root.kind = 'frame';
  return {
    root,
    images: doc.assets.images,
    fonts: [...fonts.values()],
    substitutions: [...subs.values()],
    counts,
    unsupported: [...unsupported],
  };
}
