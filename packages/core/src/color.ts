import type { RGBA } from '@h2f/schema';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Parses computed-style colors in `rgb()` / `rgba()` form (comma or space syntax, optional `/ alpha`, % channels)
 * into Figma-native 0–1 channels (SCH-4). Returns null for anything else.
 *
 * R0 scope: matches the behavior of the recovered 0.1.0 extension. Modern color spaces (oklch, lab, color(),
 * color-mix) are added in R2 per EXT-V-1.
 */
export function parseCssColor(input: string): RGBA | null {
  const match = /^rgba?\(\s*([^)]+)\)$/i.exec(input.trim());
  if (!match?.[1]) return null;
  const parts = match[1]
    .replace(/\s*\/\s*/, ' / ')
    .split(/[\s,]+/)
    .filter((p) => p && p !== '/');
  if (parts.length < 3 || parts.length > 4) return null;
  const [r, g, b] = parts
    .slice(0, 3)
    .map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p))) as [
    number,
    number,
    number,
  ];
  const alphaPart = parts[3];
  const a =
    alphaPart === undefined
      ? 1
      : alphaPart.endsWith('%')
        ? parseFloat(alphaPart) / 100
        : parseFloat(alphaPart);
  if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
  return {
    r: round4(clamp01(r / 255)),
    g: round4(clamp01(g / 255)),
    b: round4(clamp01(b / 255)),
    a: round4(clamp01(a)),
  };
}

/** True for unparseable colors and fully transparent ones. */
export function isTransparent(color: RGBA | null): boolean {
  return !color || color.a === 0;
}
