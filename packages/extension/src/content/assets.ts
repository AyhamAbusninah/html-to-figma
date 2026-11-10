/**
 * Asset phase of the collector (R4): after the synchronous DOM read, resolve replaced content into data the
 * engine can emit. Browser reads only; the live page is never modified (clones and detached canvases only).
 *
 * - Inline <svg> → a cloned, self-contained, sanitized SVG string (EXT-S-1..3, S-6 size cap in the engine).
 * - <img>/<canvas>/<video> → encoded PNG/JPEG pixels (EXT-I-2 Tier 1: draw the loaded element; otherwise a CORS
 *   fetch, which works for public CDNs that send Access-Control-Allow-Origin). Tier 2 (privileged fetch, needs a
 *   host permission) and Tier 3 (screenshot crop) are not implemented yet: failures stay placeholders with
 *   IMAGE_FETCH_FAILED (EXT-I-5).
 * - <img src=*.svg> → the SVG text, so logos stay editable vectors (EXT-S-5).
 */
import type { RawElement, RawImageAsset, RawPageSnapshot } from '@h2f/core';

export type AssetJob =
  | { kind: 'svg'; raw: RawElement; el: SVGSVGElement }
  | { kind: 'img'; raw: RawElement; el: HTMLImageElement }
  | { kind: 'canvas'; raw: RawElement; el: HTMLCanvasElement }
  | { kind: 'video'; raw: RawElement; el: HTMLVideoElement };

const MAX_SIDE = 4096; // Figma's image limit (EXT-I-7)
const CONCURRENCY = 6;
const TIMEOUT_MS = 8000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// ── SVG ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Presentation properties inlined from computed style (EXT-S-2b); computed values are resolved (no currentColor). */
const SVG_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'visibility',
] as const;
const PAINTED = new Set([
  'svg',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'g',
  'use',
]);

let svgCounter = 0;

function hrefOf(el: Element): string | null {
  return el.getAttribute('href') ?? el.getAttributeNS(XLINK_NS, 'href');
}

/** Inline computed presentation styles from `src` onto its structural twin `dst` (both subtrees walked together). */
function inlineStyles(src: Element, dst: Element): void {
  const tag = src.tagName.toLowerCase();
  if (PAINTED.has(tag)) {
    const cs = getComputedStyle(src);
    for (const p of SVG_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && v !== 'normal' && !(p === 'visibility' && v === 'visible')) dst.setAttribute(p, v);
    }
  }
  // currentColor inside a <use>d symbol resolves to the <use>'s color (the sprite itself is usually hidden).
  if (tag === 'use') dst.setAttribute('data-h2f-color', getComputedStyle(src).color);
  if (tag === 'stop') {
    const cs = getComputedStyle(src);
    dst.setAttribute('stop-color', cs.getPropertyValue('stop-color'));
    dst.setAttribute('stop-opacity', cs.getPropertyValue('stop-opacity'));
  }
  const a = src.children;
  const b = dst.children;
  for (let i = 0; i < a.length && i < b.length; i++) inlineStyles(a[i]!, b[i]!);
}

/** Replace each <use> in the clone with a copy of what it references (EXT-S-2a), colors resolved from the <use>. */
function inlineUses(clone: Element, liveRoot: Element): void {
  const doc = liveRoot.ownerDocument;
  const root = liveRoot.getRootNode() as Document | ShadowRoot;
  const uses = Array.from(clone.querySelectorAll('use'));
  for (const use of uses) {
    const ref = hrefOf(use);
    const target = ref?.startsWith('#')
      ? (root.getElementById?.(ref.slice(1)) ?? doc.getElementById(ref.slice(1)))
      : null;
    if (!target) {
      use.remove();
      continue;
    }
    const color = use.getAttribute('data-h2f-color');
    const isSymbol = target.tagName.toLowerCase() === 'symbol';
    const wrap = doc.createElementNS(SVG_NS, isSymbol ? 'svg' : 'g');
    for (const attr of ['x', 'y', 'width', 'height']) {
      const v = use.getAttribute(attr);
      if (v && isSymbol) wrap.setAttribute(attr, v);
    }
    if (isSymbol) {
      const vb = target.getAttribute('viewBox');
      if (vb) wrap.setAttribute('viewBox', vb);
    } else {
      const x = Number(use.getAttribute('x') ?? 0);
      const y = Number(use.getAttribute('y') ?? 0);
      if (x || y) wrap.setAttribute('transform', `translate(${x} ${y})`);
    }
    // Inherited from the <use> (computed), then the symbol's own presentation attributes, which are more specific.
    for (const p of SVG_PROPS) {
      const v = target.getAttribute(p) ?? use.getAttribute(p);
      if (v) wrap.setAttribute(p, v);
    }
    const body = isSymbol ? Array.from(target.childNodes) : [target];
    for (const n of body) wrap.appendChild(n.cloneNode(true));
    if (color) {
      for (const e of [wrap, ...Array.from(wrap.querySelectorAll('*'))])
        for (const attr of ['fill', 'stroke', 'stop-color'])
          if (e.getAttribute(attr)?.toLowerCase() === 'currentcolor') e.setAttribute(attr, color);
    }
    use.replaceWith(wrap);
  }
}

/** Remove scripts, foreignObject, event handlers and javascript: links (EXT-S-3, SEC-5). */
function sanitize(root: Element): void {
  for (const bad of Array.from(root.querySelectorAll('script, foreignObject'))) bad.remove();
  for (const e of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of Array.from(e.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) e.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/i.test(attr.value))
        e.removeAttribute(attr.name);
    }
  }
}

/** Prefix ids so several pasted SVGs never collide (gradients, clip paths), and rewrite their references. */
function prefixIds(root: Element): void {
  const prefix = `h2f${++svgCounter}_`;
  const ids = new Set<string>();
  for (const e of Array.from(root.querySelectorAll('[id]'))) {
    ids.add(e.id);
    e.id = prefix + e.id;
  }
  if (!ids.size) return;
  for (const e of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of Array.from(e.attributes)) {
      let v = attr.value.replace(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g, (m, id: string) =>
        ids.has(id) ? `url(#${prefix}${id})` : m,
      );
      if (
        (attr.name === 'href' || attr.name === 'xlink:href') &&
        v.startsWith('#') &&
        ids.has(v.slice(1))
      )
        v = `#${prefix}${v.slice(1)}`;
      if (v !== attr.value) e.setAttributeNS(attr.namespaceURI, attr.name, v);
    }
  }
}

/** Self-contained SVG string for an inline <svg> (EXT-S-2): clone, styles, uses, size, sanitize. */
async function serializeSvg(el: SVGSVGElement): Promise<string> {
  const clone = el.cloneNode(true) as SVGSVGElement;
  inlineStyles(el, clone);
  inlineUses(clone, el);
  for (const e of Array.from(clone.querySelectorAll('[data-h2f-color]')))
    e.removeAttribute('data-h2f-color');
  const rect = el.getBoundingClientRect();
  if (!clone.getAttribute('viewBox')) {
    // Synthesize from the authored size (user units), else from the rendered size (EXT-S-2d).
    const w = parseFloat(el.getAttribute('width') ?? '') || rect.width;
    const h = parseFloat(el.getAttribute('height') ?? '') || rect.height;
    clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  clone.setAttribute('width', String(Math.round(rect.width * 100) / 100));
  clone.setAttribute('height', String(Math.round(rect.height * 100) / 100));
  for (const attr of ['x', 'y', 'style', 'class']) clone.removeAttribute(attr);
  clone.setAttribute('xmlns', SVG_NS);
  sanitize(clone);
  // <image href> inside the SVG → data: URI through the image pipeline (EXT-S-2e); dropped when unreadable.
  for (const img of Array.from(clone.querySelectorAll('image'))) {
    const href = hrefOf(img);
    if (!href || href.startsWith('data:')) continue;
    const enc = await encodeUrl(new URL(href, el.ownerDocument.baseURI).href, 0, 0);
    if (enc) {
      img.removeAttributeNS(XLINK_NS, 'href');
      img.setAttribute('href', `data:${enc.asset.mime};base64,${enc.asset.data}`);
    } else img.remove();
  }
  prefixIds(clone);
  return new XMLSerializer().serializeToString(clone);
}

/** <img src=*.svg>: fetch the text and make a standalone, sanitized SVG at the rendered size (EXT-S-5). */
async function fetchSvgImage(el: HTMLImageElement): Promise<string | null> {
  const url = el.currentSrc || el.src;
  const res = await withTimeout(fetch(url, { mode: 'cors', credentials: 'same-origin' }));
  if (!res?.ok) return null;
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
  const rect = el.getBoundingClientRect();
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width') ?? '') || el.naturalWidth || rect.width;
    const h = parseFloat(svg.getAttribute('height') ?? '') || el.naturalHeight || rect.height;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.setAttribute('width', String(Math.round(rect.width * 100) / 100));
  svg.setAttribute('height', String(Math.round(rect.height * 100) / 100));
  sanitize(svg);
  prefixIds(svg);
  return new XMLSerializer().serializeToString(svg);
}

// ── Pixels ──────────────────────────────────────────────────────────────────────────────────────────────────

interface Encoded {
  id: string;
  asset: RawImageAsset;
}

async function withTimeout<T>(p: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Output size: ≤ natural size, ≤ 2 × rendered × DPR, ≤ 4096 px (EXT-I-7). Rendered 0 = unknown (use natural). */
function targetSize(natW: number, natH: number, renW: number, renH: number): [number, number] {
  const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
  let scale = 1;
  if (renW > 0 && renH > 0)
    scale = Math.min(1, Math.max((2 * renW * dpr) / natW, (2 * renH * dpr) / natH));
  scale = Math.min(scale, MAX_SIDE / natW, MAX_SIDE / natH);
  return [Math.max(1, Math.round(natW * scale)), Math.max(1, Math.round(natH * scale))];
}

/** True when a small copy of the image has any non-opaque pixel. */
function hasAlpha(source: CanvasImageSource, w: number, h: number): boolean {
  const c = new OffscreenCanvas(Math.min(64, w), Math.min(64, h));
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(source, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]! < 255) return true;
  return false;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Draw → PNG (alpha) or JPEG 0.85 (opaque and larger than 256²) (EXT-I-6) → content-hash id (EXT-I-9). Throws on a tainted canvas. */
async function encode(
  source: CanvasImageSource,
  natW: number,
  natH: number,
  renW: number,
  renH: number,
  meta: Pick<RawImageAsset, 'source' | 'originalUrl'>,
): Promise<Encoded> {
  const [w, h] = targetSize(natW, natH, renW, renH);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d')!.drawImage(source, 0, 0, w, h);
  const alpha = hasAlpha(canvas, w, h);
  const type = !alpha && w * h > 256 * 256 ? 'image/jpeg' : 'image/png';
  const blob = await canvas.convertToBlob({ type, quality: 0.85 }); // SecurityError when tainted
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const id = `img_${Array.from(hash.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  return { id, asset: { mime: type, data: base64(bytes), width: w, height: h, ...meta } };
}

const urlCache = new Map<string, Promise<Encoded | null>>();

/** CORS fetch → decode → encode. Works for same-origin and CORS-enabled hosts without any extra permission. */
function encodeUrl(url: string, renW: number, renH: number): Promise<Encoded | null> {
  const key = `${url}|${Math.round(renW)}x${Math.round(renH)}`;
  let p = urlCache.get(key);
  if (!p) {
    p = withTimeout(
      (async () => {
        const res = await fetch(url, { mode: 'cors', credentials: 'same-origin' });
        if (!res.ok) return null;
        const bmp = await createImageBitmap(await res.blob());
        try {
          return await encode(bmp, bmp.width, bmp.height, renW, renH, {
            source: 'fetch',
            originalUrl: url,
          });
        } finally {
          bmp.close();
        }
      })(),
    );
    urlCache.set(key, p);
  }
  return p;
}

async function encodeImg(el: HTMLImageElement): Promise<Encoded | null> {
  const url = el.currentSrc || el.src;
  const r = el.getBoundingClientRect();
  if (el.complete && el.naturalWidth > 0) {
    try {
      return await encode(el, el.naturalWidth, el.naturalHeight, r.width, r.height, {
        source: 'canvas',
        ...(url && !url.startsWith('data:') ? { originalUrl: url } : {}),
      });
    } catch {
      // Tainted (cross-origin without CORS): try a CORS fetch below.
    }
  }
  return url && !url.startsWith('data:') ? encodeUrl(url, r.width, r.height) : null;
}

async function encodeVideo(el: HTMLVideoElement): Promise<Encoded | null> {
  const r = el.getBoundingClientRect();
  if (el.readyState >= 2 && el.videoWidth > 0) {
    try {
      return await encode(el, el.videoWidth, el.videoHeight, r.width, r.height, {
        source: 'canvas',
      });
    } catch {
      /* tainted: fall back to the poster */
    }
  }
  return el.poster ? encodeUrl(el.poster, r.width, r.height) : null;
}

async function resolveJob(job: AssetJob, assets: Record<string, RawImageAsset>): Promise<void> {
  try {
    if (job.kind === 'svg') {
      job.raw.svg = await serializeSvg(job.el);
      return;
    }
    if (job.kind === 'img' && /\.svg(\?|#|$)/i.test(job.el.currentSrc || job.el.src)) {
      const svg = await fetchSvgImage(job.el);
      if (svg) {
        job.raw.svg = svg;
        return;
      }
    }
    const r = job.el.getBoundingClientRect();
    const enc =
      job.kind === 'img'
        ? await encodeImg(job.el)
        : job.kind === 'video'
          ? await encodeVideo(job.el)
          : await encode(job.el, job.el.width, job.el.height, r.width, r.height, {
              source: 'canvas',
            }).catch(() => null);
    if (enc) {
      assets[enc.id] = enc.asset;
      job.raw.assetId = enc.id;
    } else job.raw.assetFailed = true;
  } catch {
    job.raw.assetFailed = true;
  }
}

/** Resolves every job (bounded concurrency) and stores encoded images in `snapshot.assets`. */
export async function resolveAssets(
  snapshot: RawPageSnapshot,
  jobs: readonly AssetJob[],
): Promise<void> {
  urlCache.clear();
  const assets: Record<string, RawImageAsset> = {};
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await resolveJob(jobs[next++]!, assets);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  snapshot.assets = assets;
}
