/** Pure parsers for computed-style values (strings as returned by getComputedStyle). */
import type { BlendMode, Border, Effect, RGBA } from '@h2f/schema';
import { isTransparent, parseCssColor } from './color.ts';
import type { RawStyle } from './raw-snapshot.ts';

const round2 = (v: number) => Math.round(v * 100) / 100;

/** "12.5px" → 12.5; anything unparseable → fallback. */
export function px(value: string | undefined, fallback = 0): number {
  if (!value) return fallback;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Splits on top-level commas (ignores commas inside parentheses and quotes). */
export function splitTopLevel(value: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** CSS font-family stack → unquoted family names in order (EXT-X-4). */
export function parseFontFamilies(value: string): string[] {
  const families = splitTopLevel(value)
    .map((f) => f.replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
  return families.length ? families : ['sans-serif'];
}

const BORDER_STYLES: Record<string, 'solid' | 'dashed' | 'dotted'> = {
  solid: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
  double: 'solid',
  groove: 'solid',
  ridge: 'solid',
  inset: 'solid',
  outset: 'solid',
};

/** Per-side borders; null when no side is visible. `degraded` lists styles mapped to solid (EXT-V-4). */
export function parseBorder(s: RawStyle): { border: Border | null; degraded: string[] } {
  const degraded: string[] = [];
  const side = (name: 'top' | 'right' | 'bottom' | 'left') => {
    const style = s[`border-${name}-style`];
    const width = px(s[`border-${name}-width`]);
    const color = parseCssColor(s[`border-${name}-color`]) ?? { r: 0, g: 0, b: 0, a: 1 };
    const mapped = BORDER_STYLES[style];
    const visible = Boolean(mapped) && width > 0 && !isTransparent(color);
    if (visible && mapped === 'solid' && style !== 'solid') degraded.push(style);
    return { width: visible ? round2(width) : 0, color, style: mapped ?? 'solid' };
  };
  const border: Border = {
    top: side('top'),
    right: side('right'),
    bottom: side('bottom'),
    left: side('left'),
  };
  const any = border.top.width || border.right.width || border.bottom.width || border.left.width;
  return { border: any ? border : null, degraded };
}

/** Per-corner radii resolved to px, clamped to min(w, h) / 2 (EXT-V-5). Null when all zero. */
export function parseRadii(
  s: RawStyle,
  width: number,
  height: number,
): { tl: number; tr: number; br: number; bl: number } | null {
  const max = Math.min(width, height) / 2;
  const corner = (value: string) => {
    const first = value.trim().split(/\s+/)[0] ?? '0';
    const v = first.endsWith('%') ? (parseFloat(first) / 100) * width : px(first);
    return round2(Math.max(0, Math.min(v, max)));
  };
  const r = {
    tl: corner(s['border-top-left-radius']),
    tr: corner(s['border-top-right-radius']),
    br: corner(s['border-bottom-right-radius']),
    bl: corner(s['border-bottom-left-radius']),
  };
  return r.tl || r.tr || r.br || r.bl ? r : null;
}

/** box-shadow → DROP_SHADOW / INNER_SHADOW effects in CSS order (EXT-V-6). */
export function parseBoxShadow(value: string): Effect[] {
  if (!value || value === 'none') return [];
  const effects: Effect[] = [];
  for (const layer of splitTopLevel(value)) {
    const colorMatch = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+\([^)]*\))/i.exec(layer);
    const color = (colorMatch && parseCssColor(colorMatch[1]!)) ?? { r: 0, g: 0, b: 0, a: 1 };
    const rest = colorMatch ? layer.replace(colorMatch[1]!, ' ') : layer;
    const inset = /\binset\b/.test(rest);
    const lengths = rest
      .replace(/\binset\b/, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => px(t));
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    if (color.a === 0) continue;
    effects.push({
      type: inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
      color,
      offset: { x, y },
      radius: Math.max(0, blur),
      spread,
    });
  }
  return effects;
}

const BLEND: Record<string, BlendMode> = {
  multiply: 'MULTIPLY',
  screen: 'SCREEN',
  overlay: 'OVERLAY',
  darken: 'DARKEN',
  lighten: 'LIGHTEN',
  'color-dodge': 'COLOR_DODGE',
  'color-burn': 'COLOR_BURN',
  'hard-light': 'HARD_LIGHT',
  'soft-light': 'SOFT_LIGHT',
  difference: 'DIFFERENCE',
  exclusion: 'EXCLUSION',
  hue: 'HUE',
  saturation: 'SATURATION',
  color: 'COLOR',
  luminosity: 'LUMINOSITY',
};

/** mix-blend-mode → Figma blend mode. `undefined` for normal; `unsupported` for unmappable values. */
export function parseBlendMode(value: string): { blendMode?: BlendMode; unsupported?: string } {
  if (!value || value === 'normal') return {};
  const mapped = BLEND[value];
  return mapped ? { blendMode: mapped } : { unsupported: value };
}

/** True when `transform` is none or a pure translation (EXT-G-3). */
export function isTranslationOnly(transform: string): boolean {
  if (!transform || transform === 'none') return true;
  const m = /^matrix\(([^)]+)\)$/.exec(transform.trim());
  if (!m) return false;
  const [a, b, c, d] = m[1]!.split(',').map((v) => parseFloat(v));
  return a === 1 && b === 0 && c === 0 && d === 1;
}

/**
 * Mirroring part of a computed `transform` (EXT-G-3): scaleX(-1), scaleY(-1), rotate(180deg), rotateY(180deg)…
 * Returns the flipped axes when the transform has no rotation/skew (b = c = 0; any scale and translation are already
 * in the bounding box), null otherwise (none, a plain scale, or a real rotation).
 */
export function flipOf(transform: string): { h: boolean; v: boolean } | null {
  const t = (transform ?? '').trim();
  let a: number, b: number, c: number, d: number;
  const m2 = /^matrix\(([^)]+)\)$/.exec(t);
  const m3 = /^matrix3d\(([^)]+)\)$/.exec(t);
  if (m2)
    [a, b, c, d] = m2[1]!.split(',').map((v) => parseFloat(v)) as [number, number, number, number];
  else if (m3) {
    const m = m3[1]!.split(',').map((v) => parseFloat(v));
    if (m.length !== 16) return null;
    // Only flat transforms: no perspective, no z coupling (rotateY(180deg) is matrix3d(-1,0,0,0, 0,1,0,0, 0,0,-1,0, …)).
    if ([m[2], m[3], m[6], m[7], m[8], m[9], m[11]].some((v) => Math.abs(v!) > 1e-6)) return null;
    [a, b, c, d] = [m[0]!, m[1]!, m[4]!, m[5]!];
  } else return null;
  if (![a, b, c, d].every(Number.isFinite)) return null;
  if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6) return null;
  const h = a < 0;
  const v = d < 0;
  return h || v ? { h, v } : null;
}

/** One inset length: px, or % of `of` (Chrome serializes computed clip-path insets as px or %). */
function insetLength(t: string, of: number): number | null {
  const m = /^(-?[\d.]+(?:e[+-]?\d+)?)(px|%)?$/i.exec(t);
  if (!m) return null;
  const v = parseFloat(m[1]!);
  if (m[2] === '%') return (v / 100) * of;
  return m[2] === 'px' || v === 0 ? v : null;
}

/**
 * Computed `clip-path: inset(t r b l [round radius])` → the inset per side in px (negative = the clip extends past
 * the border box) and a uniform corner radius. null for any other clip-path (circle, polygon, url…), which stays
 * CLIP_MASK_UNSUPPORTED. `w`/`h`: the border box.
 */
export function parseInsetClip(
  value: string,
  w: number,
  h: number,
): { top: number; right: number; bottom: number; left: number; radius: number } | null {
  const m = /^inset\((.*)\)(?:\s+border-box)?$/i.exec((value ?? '').trim());
  if (!m) return null;
  const [box, round] = m[1]!.split(/\s+round\s+/i);
  const t = box!.trim().split(/\s+/);
  if (t.length < 1 || t.length > 4) return null;
  const [st, sr = st, sb = st, sl = sr] = t as [string, string?, string?, string?];
  const top = insetLength(st, h);
  const right = insetLength(sr!, w);
  const bottom = insetLength(sb!, h);
  const left = insetLength(sl!, w);
  if (top === null || right === null || bottom === null || left === null) return null;
  let radius = 0;
  if (round) {
    const radii = round.trim().split(/\s+/);
    const r = insetLength(radii[0]!, Math.min(w, h));
    // Only a uniform radius (one value) is kept; elliptical/per-corner radii fall back to square corners.
    if (r !== null && radii.every((x) => x === radii[0])) radius = Math.max(0, r);
  }
  return { top, right, bottom, left, radius };
}

export function solidOrNull(css: string): RGBA | null {
  const c = parseCssColor(css);
  return isTransparent(c) ? null : c;
}

/**
 * True for the generic "visually hidden" patterns (screen-reader-only text): content that takes no visible area.
 * Detected purely from computed style + geometry (SYS-5):
 *  - legacy `clip: rect(...)` collapsing to <= 1px²
 *  - `clip-path: inset(>= 50%)`
 *  - a box <= 1px × 1px that clips its overflow (the classic sr-only utility)
 */
export function isVisuallyHidden(s: RawStyle, width: number, height: number): boolean {
  const clip = (s.clip ?? 'auto').trim();
  const m = /^rect\(([^)]*)\)$/.exec(clip);
  if (m) {
    const [t, r, b, l] = m[1]!.split(/[\s,]+/).map((v) => (v === 'auto' ? null : px(v)));
    const top = t ?? 0;
    const right = r ?? width;
    const bottom = b ?? height;
    const left = l ?? 0;
    if ((right - left) * (bottom - top) <= 1) return true;
  }
  const inset = /^inset\(\s*(\d+(?:\.\d+)?)%/.exec((s['clip-path'] ?? 'none').trim());
  if (inset && parseFloat(inset[1]!) >= 50) return true;
  const clips = ['hidden', 'clip', 'auto', 'scroll'];
  if (
    width <= 1 &&
    height <= 1 &&
    (clips.includes(s['overflow-x']) || clips.includes(s['overflow-y']))
  )
    return true;
  return false;
}
