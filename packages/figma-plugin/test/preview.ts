/**
 * Renders a Figma-mock node tree to SVG for visual inspection (dev/test tool).
 * ⚠ Shows what the plugin *asked* Figma to create, drawn by a browser. It is NOT a Figma rendering: text uses the
 * browser's fonts (Inter etc. are not loaded here, so text may look serif), the mock's crude text widths affect
 * anchoring, and rounded corners with per-side strokes are simplified.
 */
import { MockFrame, MockNode, MockRect, MockText } from './figma-mock.ts';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function paintAttr(fills: unknown[]): string {
  const p = fills[0] as
    { color?: { r: number; g: number; b: number }; opacity?: number } | undefined;
  if (!p?.color) return 'fill="none"';
  const c = p.color;
  return `fill="rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})" fill-opacity="${p.opacity ?? 1}"`;
}

function rgb(c: { r: number; g: number; b: number }) {
  return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
}

/** Per-side INSIDE strokes, drawn as individual lines (matches strokeTopWeight/… semantics). */
function strokeSvg(box: MockFrame | MockRect): string {
  const s = box.strokes[0] as { color: { r: number; g: number; b: number } } | undefined;
  if (!s) return '';
  const { top, right, bottom, left } = box.strokeWeights;
  const dash = box.dashPattern.length ? ` stroke-dasharray="${box.dashPattern.join(' ')}"` : '';
  const c = rgb(s.color);
  const w = box.width;
  const h = box.height;
  const line = (x1: number, y1: number, x2: number, y2: number, sw: number) =>
    sw > 0
      ? `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${sw}"${dash}/>`
      : '';
  return (
    line(0, top / 2, w, top / 2, top) +
    line(w - right / 2, 0, w - right / 2, h, right) +
    line(0, h - bottom / 2, w, h - bottom / 2, bottom) +
    line(left / 2, 0, left / 2, h, left)
  );
}

let clipId = 0;

function nodeSvg(n: MockNode, atOrigin = false): string {
  const pos = atOrigin ? '' : ` transform="translate(${n.x},${n.y})"`;
  const op = n.opacity < 1 ? ` opacity="${n.opacity}"` : '';
  if (n instanceof MockText) {
    const fill = paintAttr(n.fills);
    const anchor =
      n.textAlignHorizontal === 'RIGHT'
        ? 'end'
        : n.textAlignHorizontal === 'CENTER'
          ? 'middle'
          : 'start';
    const tx = anchor === 'end' ? n.width : anchor === 'middle' ? n.width / 2 : 0;
    const lh = n.lineHeightPx;
    const lines = n.characters.split('\n');
    const weight = /bold|black|heavy/i.test(n.fontName.style)
      ? 700
      : /medium|semi/i.test(n.fontName.style)
        ? 600
        : 400;
    const tspans = lines
      .map((l, i) => `<tspan x="${tx}" y="${lh * i + lh * 0.75}">${esc(l)}</tspan>`)
      .join('');
    return `<g transform="translate(${n.x},${n.y})"${op}><text font-family="${esc(n.fontName.family)}" font-size="${n.fontSize}" font-weight="${weight}" text-anchor="${anchor}" ${fill}>${tspans}</text></g>`;
  }
  if (n instanceof MockFrame || n instanceof MockRect) {
    const r = n.radii.tl || n.radii.tr || n.radii.br || n.radii.bl;
    const rect = `<rect width="${n.width}" height="${n.height}" rx="${r}" ${paintAttr(n.fills)}/>${strokeSvg(n)}`;
    if (n instanceof MockRect) return `<g transform="translate(${n.x},${n.y})"${op}>${rect}</g>`;
    let clip = '';
    let open = '<g>';
    if (n.clipsContent) {
      const id = `c${clipId++}`;
      clip = `<clipPath id="${id}"><rect width="${n.width}" height="${n.height}" rx="${r}"/></clipPath>`;
      open = `<g clip-path="url(#${id})">`;
    }
    return `<g${pos}${op}>${clip}${rect}${open}${n.children.map((c) => nodeSvg(c)).join('')}</g></g>`;
  }
  return '';
}

export function toSvg(root: MockFrame): string {
  clipId = 0;
  const inner = nodeSvg(root, true);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${root.width}" height="${root.height}" viewBox="0 0 ${root.width} ${root.height}">${inner}</svg>`;
}
