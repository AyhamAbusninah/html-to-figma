/** Pure helpers for the root frame (PLG-R-1). No `figma.*` access, so unit-testable in Node. */
import type { Meta, RGBA } from '@h2f/schema';

/** Hostname without relying on the URL global (absent in Figma's plugin sandbox). */
export function hostnameOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(url.trim());
  return m?.[1] ? m[1].toLowerCase() : '';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `<title> — <hostname> — <YYYY-MM-DD HH:mm>` (local time). */
export function rootFrameName(meta: Pick<Meta, 'sourceUrl' | 'capturedAt' | 'title'>): string {
  const host = hostnameOf(meta.sourceUrl);
  const d = new Date(meta.capturedAt);
  const when = Number.isNaN(d.getTime())
    ? meta.capturedAt
    : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return [meta.title.trim() || 'Untitled page', host, when].filter(Boolean).join(' — ');
}

/** x for a new top-level frame: `gap` px right of the right-most existing node, or 0 on an empty page. */
export function placementX(existing: readonly { x: number; width: number }[], gap = 100): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing.map((n) => n.x + n.width)) + gap;
}

/** Capture RGBA (0–1, alpha in color) → Figma SolidPaint (alpha as paint opacity). */
export function solidPaint(color: RGBA): {
  type: 'SOLID';
  color: { r: number; g: number; b: number };
  opacity: number;
} {
  return { type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a };
}
