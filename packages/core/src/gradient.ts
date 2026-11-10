/**
 * CSS `background-image` (computed value) → background layers (EXT-V-3, R4). Pure, unit-tested.
 * Layers are returned top-first, as CSS lists them. `url()` layers are pre-composited by the collector
 * (EXT-I-8) and only referenced here by their index among the url layers.
 */
import type { Paint, RGBA } from '@h2f/schema';
import { parseCssColor } from './color.ts';
import { splitTopLevel } from './css.ts';

type Stop = { position: number; color: RGBA };
export type BgLayer =
  | { kind: 'url'; urlIndex: number }
  | { kind: 'paint'; paint: Paint }
  /** Repeating/conic/unparseable: replaced by its first color, when there is one (GRADIENT_UNSUPPORTED). */
  | { kind: 'unsupported'; fallback: RGBA | null };

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const deg = (rad: number) => (rad * 180) / Math.PI;

/** A length or percentage → fraction of `size` (px / size). null when not a length. */
function fraction(token: string, size: number): number | null {
  const m = /^(-?[\d.]+)(%|px)?$/.exec(token.trim());
  if (!m) return null;
  const v = parseFloat(m[1]!);
  if (m[2] === '%') return v / 100;
  if (m[2] === 'px' || v === 0) return size > 0 ? v / size : 0;
  return null;
}

/** Color stops with optional positions (one or two per color); hints and missing positions resolved. */
function parseStops(parts: string[], length: number): Stop[] | null {
  const raw: { color: RGBA; pos: number | null }[] = [];
  for (const part of parts) {
    // "<color> [pos [pos]]" — the color may contain spaces inside parentheses.
    const m = /^(.*?\))\s*(.*)$|^(\S+)\s*(.*)$/.exec(part.trim());
    if (!m) return null;
    const colorText = (m[1] ?? m[3])!;
    const rest = (m[2] ?? m[4] ?? '').trim();
    const color = parseCssColor(colorText);
    if (!color) {
      // A lone position is a color hint (interpolation midpoint): ignored, the stops around it stay.
      if (fraction(colorText, length) !== null && !rest) continue;
      return null;
    }
    const positions = rest ? rest.split(/\s+/).map((t) => fraction(t, length)) : [];
    if (positions.some((p) => p === null)) return null;
    if (positions.length === 0) raw.push({ color, pos: null });
    for (const p of positions) raw.push({ color, pos: p });
  }
  if (raw.length < 2) return null;
  // Missing positions: first 0, last 1, others spread evenly between known neighbours; never decreasing.
  if (raw[0]!.pos === null) raw[0]!.pos = 0;
  if (raw[raw.length - 1]!.pos === null) raw[raw.length - 1]!.pos = 1;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i]!.pos !== null) continue;
    let j = i;
    while (raw[j]!.pos === null) j++;
    const a = raw[i - 1]!.pos!;
    const b = raw[j]!.pos!;
    for (let k = i; k < j; k++) raw[k]!.pos = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  let max = 0;
  return raw.map((s) => {
    max = Math.max(max, s.pos!);
    return { position: r4(Math.min(1, Math.max(0, max))), color: s.color };
  });
}

const SIDES: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270 };

/** `to top right` etc. → CSS angle for this box (corner keywords depend on the aspect ratio). */
function directionAngle(dir: string, w: number, h: number): number | null {
  const words = dir.replace(/^to\s+/, '').split(/\s+/);
  if (words.length === 1) return SIDES[words[0]!] ?? null;
  const v = words.find((x) => x === 'top' || x === 'bottom');
  const hz = words.find((x) => x === 'left' || x === 'right');
  if (!v || !hz) return null;
  const a = deg(Math.atan2(h, w)); // angle of the gradient line from vertical for a corner
  if (v === 'top') return hz === 'right' ? a : 360 - a;
  return hz === 'right' ? 180 - a : 180 + a;
}

function angleOf(token: string): number | null {
  const m = /^(-?[\d.]+)(deg|rad|turn|grad)$/.exec(token.trim());
  if (!m) return null;
  const v = parseFloat(m[1]!);
  const unit = m[2];
  return unit === 'deg' ? v : unit === 'rad' ? deg(v) : unit === 'turn' ? v * 360 : v * 0.9;
}

function linear(args: string[], w: number, h: number): Paint | null {
  let angleDeg = 180;
  let rest = args;
  const first = args[0]!.trim();
  const a = angleOf(first);
  if (a !== null) {
    angleDeg = a;
    rest = args.slice(1);
  } else if (first.startsWith('to ')) {
    const d = directionAngle(first, w, h);
    if (d === null) return null;
    angleDeg = d;
    rest = args.slice(1);
  } else if (/^in\s/.test(first)) rest = args.slice(1); // color interpolation space: ignored
  // Gradient line length (CSS): |w·sin θ| + |h·cos θ|; px stop positions are fractions of it.
  const t = (angleDeg * Math.PI) / 180;
  const length = Math.abs(w * Math.sin(t)) + Math.abs(h * Math.cos(t));
  const stops = parseStops(rest, length);
  return stops
    ? { type: 'GRADIENT_LINEAR', angleDeg: r4(((angleDeg % 360) + 360) % 360), stops }
    : null;
}

const KEYWORD_POS: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };

function radial(args: string[], w: number, h: number): Paint | null {
  let shape = 'ellipse';
  let size = 'farthest-corner';
  const explicit: string[] = [];
  let cx = 0.5;
  let cy = 0.5;
  let rest = args;
  const first = args[0]!.trim();
  if (!parseCssColor(first.split(/\s+/)[0]!) && !/^rgb|^hsl|^#/.test(first)) {
    rest = args.slice(1);
    const [shapePart, atPart] = first.split(/\s+at\s+|^at\s+/);
    for (const tok of (shapePart ?? '').split(/\s+/).filter(Boolean)) {
      if (tok === 'circle' || tok === 'ellipse') shape = tok;
      else if (/^(closest|farthest)-(side|corner)$/.test(tok)) size = tok;
      else explicit.push(tok);
    }
    if (atPart) {
      const [px, py] = atPart.trim().split(/\s+/);
      cx = px! in KEYWORD_POS ? KEYWORD_POS[px!]! : (fraction(px!, w) ?? 0.5);
      cy = py === undefined ? 0.5 : py in KEYWORD_POS ? KEYWORD_POS[py]! : (fraction(py, h) ?? 0.5);
    }
  }
  const x = cx * w;
  const y = cy * h;
  const sideX = [x, w - x];
  const sideY = [y, h - y];
  let rx: number;
  let ry: number;
  if (explicit.length) {
    rx = (fraction(explicit[0]!, w) ?? 0.5) * w;
    ry = explicit[1] ? (fraction(explicit[1], h) ?? 0.5) * h : rx;
  } else {
    const fx = size.startsWith('closest') ? Math.min(...sideX) : Math.max(...sideX);
    const fy = size.startsWith('closest') ? Math.min(...sideY) : Math.max(...sideY);
    if (shape === 'circle') {
      rx = ry = size.endsWith('corner')
        ? Math.hypot(fx, fy)
        : size.startsWith('closest')
          ? Math.min(fx, fy)
          : Math.max(fx, fy);
    } else if (size.endsWith('corner')) {
      rx = fx * Math.SQRT2;
      ry = fy * Math.SQRT2;
    } else {
      rx = fx;
      ry = fy;
    }
  }
  if (!(rx > 0 && ry > 0) || !(w > 0 && h > 0)) return null;
  const stops = parseStops(rest, rx);
  return stops
    ? {
        type: 'GRADIENT_RADIAL',
        center: { x: r4(cx), y: r4(cy) },
        radius: { x: r4(rx / w), y: r4(ry / h) },
        stops,
      }
    : null;
}

/** First color found in a gradient's arguments (fallback for unsupported gradients). */
function firstColor(args: string[]): RGBA | null {
  for (const a of args) {
    const m = /^(.*?\))|^(\S+)/.exec(a.trim());
    const c = m && parseCssColor((m[1] ?? m[2])!);
    if (c) return c;
  }
  return null;
}

/** Computed `background-image` → layers (top first). `w`/`h`: the element's padding box (px). */
export function parseBackgroundLayers(value: string, w: number, h: number): BgLayer[] {
  if (!value || value === 'none') return [];
  const out: BgLayer[] = [];
  let urlIndex = 0;
  for (const layer of splitTopLevel(value)) {
    const t = layer.trim();
    if (t === 'none') continue;
    if (/^url\(/i.test(t)) {
      out.push({ kind: 'url', urlIndex: urlIndex++ });
      continue;
    }
    const m = /^([a-z-]+)\((.*)\)$/is.exec(t);
    const args = m ? splitTopLevel(m[2]!) : [];
    const paint =
      m?.[1] === 'linear-gradient' && args.length
        ? linear(args, w, h)
        : m?.[1] === 'radial-gradient' && args.length
          ? radial(args, w, h)
          : null;
    out.push(
      paint ? { kind: 'paint', paint } : { kind: 'unsupported', fallback: firstColor(args) },
    );
  }
  return out;
}

/**
 * The url() values of a computed `background-image`, in order, with their CSS layer index (per-layer properties
 * such as background-size are listed per layer, gradients included). For the collector.
 */
export function backgroundUrls(value: string): { url: string; layer: number }[] {
  if (!value || value === 'none') return [];
  return splitTopLevel(value)
    .map((l, layer) => ({ url: /^url\(\s*(['"]?)(.*?)\1\s*\)$/i.exec(l.trim())?.[2], layer }))
    .filter((u): u is { url: string; layer: number } => u.url !== undefined);
}

/** First visible color of the first gradient layer (for `background-clip: text`, approximated as a solid color). */
export function gradientTextColor(value: string, w: number, h: number): RGBA | null {
  for (const l of parseBackgroundLayers(value, w, h)) {
    if (l.kind === 'paint' && l.paint.type !== 'SOLID' && l.paint.type !== 'IMAGE')
      return l.paint.stops.find((s) => s.color.a > 0)?.color ?? null;
    if (l.kind === 'unsupported' && l.fallback) return l.fallback;
  }
  return null;
}
