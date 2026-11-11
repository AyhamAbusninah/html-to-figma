/**
 * Asset phase of the collector (R4): after the synchronous DOM read, resolve replaced content into data the
 * engine can emit. Browser reads only; the live page is never modified (clones and detached canvases only).
 *
 * - Inline <svg> → a cloned, self-contained, sanitized SVG string (EXT-S-1..3, S-6 size cap in the engine).
 * - <img>/<canvas>/<video> → encoded PNG/JPEG pixels, in tiers:
 *   Tier 1 (EXT-I-2): draw the loaded element; else a CORS fetch (works for CDNs that allow cross-site reads).
 *   Tier 2 (EXT-I-3): the service worker fetches it (host access: install allow-list, or all sites once the user
 *   granted the optional permission).
 *   Tier 3 (EXT-I-4): crop it from screenshots of the visible tab; the page is scrolled to each image and the
 *   scroll position restored. Also used for <iframe>/<object>/<embed>. Still failing → placeholder (EXT-I-5).
 * - <img src=*.svg> → the SVG text, so logos stay editable vectors (EXT-S-5).
 * - Mirrored content (transform scaleX(-1), rotate(180deg)… on the element or an ancestor, EXT-G-3): drawn pixels
 *   and SVG markup are flipped the same way; screenshots already show it as rendered.
 * - mix-blend-mode elements (EXT-V-10): a screenshot of the element as composited on the page.
 */
import type { RawElement, RawImageAsset, RawPageSnapshot, RawText } from '@h2f/core';
import type { WorkerRequest, WorkerResponse } from '../shared/messages.ts';
import { settle } from './settle.ts';

/** Axes mirrored by CSS transforms of the element and its ancestors. */
export interface Flip {
  h: boolean;
  v: boolean;
}

export type AssetJob =
  | { kind: 'svg'; raw: RawElement; el: SVGSVGElement; flip: Flip | null }
  | { kind: 'img'; raw: RawElement; el: HTMLImageElement; flip: Flip | null }
  | { kind: 'canvas'; raw: RawElement; el: HTMLCanvasElement; flip: Flip | null }
  | { kind: 'video'; raw: RawElement; el: HTMLVideoElement; flip: Flip | null }
  /** <iframe>/<object>/<embed>: content not readable; Tier 3 screenshot only. */
  | { kind: 'frame'; raw: RawElement; el: Element }
  /** An element with mix-blend-mode: Tier 3 screenshot of its border box; sets raw.raster on success. */
  | { kind: 'raster'; raw: RawElement; el: Element }
  /** CSS background images of a (non-replaced) element: one composite per url() layer (EXT-I-8). */
  | {
      kind: 'bg';
      raw: RawElement;
      el: Element;
      layers: { url: string; layer: number }[];
      box: BgBox;
      flip: Flip | null;
    }
  /** An icon-font glyph (EXT-X-9): drawn with the page's font instead of a text layer. */
  | {
      kind: 'glyph';
      raw: RawText;
      el: Element;
      text: string;
      font: string;
      color: string;
      width: number;
      height: number;
      flip: Flip | null;
    };

/** What compositing a background needs, read during the DOM walk (the element may be gone later). */
export interface BgBox {
  width: number;
  height: number;
  border: [number, number, number, number]; // left, top, right, bottom
  padding: [number, number, number, number];
  size: string;
  position: string;
  repeat: string;
  origin: string;
}

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

const SVG_NON_PAINTED = new Set(['defs', 'style', 'title', 'desc', 'metadata']);

/** Mirrors the drawing inside its viewBox (the element was flipped by a CSS transform). */
function flipSvg(svg: Element, flip: Flip | null): void {
  if (!flip) return;
  const vb = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) return;
  const [x, y, w, h] = vb as [number, number, number, number];
  const g = svg.ownerDocument.createElementNS(SVG_NS, 'g');
  g.setAttribute(
    'transform',
    `matrix(${flip.h ? -1 : 1} 0 0 ${flip.v ? -1 : 1} ${flip.h ? 2 * x + w : 0} ${flip.v ? 2 * y + h : 0})`,
  );
  for (const n of Array.from(svg.childNodes)) {
    if (
      n.nodeType === Node.ELEMENT_NODE &&
      SVG_NON_PAINTED.has((n as Element).tagName.toLowerCase())
    )
      continue;
    g.appendChild(n);
  }
  svg.appendChild(g);
}

/** Self-contained SVG string for an inline <svg> (EXT-S-2): clone, styles, uses, size, sanitize. */
async function serializeSvg(el: SVGSVGElement, flip: Flip | null): Promise<string> {
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
  flipSvg(clone, flip);
  prefixIds(clone);
  return new XMLSerializer().serializeToString(clone);
}

/** <img src=*.svg>: fetch the text and make a standalone, sanitized SVG at the rendered size (EXT-S-5). */
async function fetchSvgImage(
  el: HTMLImageElement,
  rect: { width: number; height: number },
  flip: Flip | null,
): Promise<string | null> {
  const url = el.currentSrc || el.src;
  const blob = await withTimeout(fetchBlob(url));
  if (!blob) return null;
  const text = await blob.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width') ?? '') || el.naturalWidth || rect.width;
    const h = parseFloat(svg.getAttribute('height') ?? '') || el.naturalHeight || rect.height;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.setAttribute('width', String(Math.round(rect.width * 100) / 100));
  svg.setAttribute('height', String(Math.round(rect.height * 100) / 100));
  sanitize(svg);
  flipSvg(svg, flip);
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
  flip: Flip | null = null,
): Promise<Encoded> {
  const [w, h] = targetSize(natW, natH, renW, renH);
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext('2d')!;
  if (flip) {
    g.translate(flip.h ? w : 0, flip.v ? h : 0);
    g.scale(flip.h ? -1 : 1, flip.v ? -1 : 1);
  }
  g.drawImage(source, 0, 0, w, h);
  const alpha = hasAlpha(canvas, w, h);
  const type = !alpha && w * h > 256 * 256 ? 'image/jpeg' : 'image/png';
  const blob = await canvas.convertToBlob({ type, quality: 0.85 }); // SecurityError when tainted
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const id = `img_${Array.from(hash.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  return { id, asset: { mime: type, data: base64(bytes), width: w, height: h, ...meta } };
}

const urlCache = new Map<string, Promise<Encoded | null>>();

type Worker = typeof chrome.runtime.sendMessage;
/** chrome.runtime in the extension's content script; absent when the script runs in the page (tests). */
const runtime = (): { sendMessage: Worker } | undefined =>
  (globalThis as { chrome?: { runtime?: { id?: string; sendMessage?: Worker } } }).chrome?.runtime
    ?.id
    ? (globalThis as unknown as { chrome: { runtime: { sendMessage: Worker } } }).chrome.runtime
    : undefined;

async function ask(msg: WorkerRequest): Promise<WorkerResponse | null> {
  const rt = runtime();
  if (!rt) return null;
  try {
    return (await rt.sendMessage(msg)) as WorkerResponse;
  } catch {
    return null;
  }
}

/** Image bytes: a CORS fetch (Tier 1), else the service worker's fetch (Tier 2). */
async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'same-origin' });
    if (res.ok) return await res.blob();
  } catch {
    // CORS refused or network error: Tier 2.
  }
  const r = await ask({ type: 'h2f:fetch-asset', url });
  if (!r?.ok || r.type !== 'h2f:asset') return null;
  const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: r.mime });
}

/** CORS fetch or service-worker fetch → decode → encode. */
function encodeUrl(
  url: string,
  renW: number,
  renH: number,
  flip: Flip | null = null,
): Promise<Encoded | null> {
  const key = `${url}|${Math.round(renW)}x${Math.round(renH)}|${flip ? `${+flip.h}${+flip.v}` : ''}`;
  let p = urlCache.get(key);
  if (!p) {
    p = withTimeout(
      (async () => {
        const blob = await fetchBlob(url);
        if (!blob) return null;
        const bmp = await createImageBitmap(blob);
        try {
          return await encode(
            bmp,
            bmp.width,
            bmp.height,
            renW,
            renH,
            { source: 'fetch', originalUrl: url },
            flip,
          );
        } finally {
          bmp.close();
        }
      })(),
    );
    urlCache.set(key, p);
  }
  return p;
}

async function encodeImg(el: HTMLImageElement, flip: Flip | null): Promise<Encoded | null> {
  const url = el.currentSrc || el.src;
  const r = el.getBoundingClientRect();
  if (el.complete && el.naturalWidth > 0) {
    try {
      return await encode(
        el,
        el.naturalWidth,
        el.naturalHeight,
        r.width,
        r.height,
        { source: 'canvas', ...(url && !url.startsWith('data:') ? { originalUrl: url } : {}) },
        flip,
      );
    } catch {
      // Tainted (cross-origin without CORS): try a CORS fetch below.
    }
  }
  return url && !url.startsWith('data:') ? encodeUrl(url, r.width, r.height, flip) : null;
}

async function encodeVideo(el: HTMLVideoElement, flip: Flip | null): Promise<Encoded | null> {
  const r = el.getBoundingClientRect();
  if (el.readyState >= 2 && el.videoWidth > 0) {
    try {
      return await encode(
        el,
        el.videoWidth,
        el.videoHeight,
        r.width,
        r.height,
        { source: 'canvas' },
        flip,
      );
    } catch {
      /* tainted: fall back to the poster */
    }
  }
  return el.poster ? encodeUrl(el.poster, r.width, r.height, flip) : null;
}

async function resolveJob(job: AssetJob, assets: Record<string, RawImageAsset>): Promise<void> {
  if (job.kind === 'frame' || job.kind === 'raster') return; // Tier 3 only
  if (job.kind === 'bg') {
    job.raw.bgAssets = await compositeBackgrounds(job.box, job.layers, assets, job.flip);
    return;
  }
  if (job.kind === 'glyph') {
    const enc = await drawGlyph(job).catch(() => null);
    if (enc) {
      assets[enc.id] = enc.asset;
      job.raw.iconAssetId = enc.id;
    }
    return;
  }
  try {
    if (job.kind === 'svg') {
      job.raw.svg = await serializeSvg(job.el, job.flip);
      return;
    }
    if (job.kind === 'img' && /\.svg(\?|#|$)/i.test(job.el.currentSrc || job.el.src)) {
      // The size read during the DOM walk: the element may be gone now (materialized ::before content).
      const svg = await fetchSvgImage(job.el, job.raw.rect, job.flip);
      if (svg) {
        job.raw.svg = svg;
        return;
      }
    }
    const r = job.el.getBoundingClientRect();
    const enc =
      job.kind === 'img'
        ? await encodeImg(job.el, job.flip)
        : job.kind === 'video'
          ? await encodeVideo(job.el, job.flip)
          : await encode(
              job.el as HTMLCanvasElement,
              (job.el as HTMLCanvasElement).width,
              (job.el as HTMLCanvasElement).height,
              r.width,
              r.height,
              { source: 'canvas' },
              job.flip,
            ).catch(() => null);
    if (enc) {
      assets[enc.id] = enc.asset;
      job.raw.assetId = enc.id;
    } else job.raw.assetFailed = true;
  } catch {
    job.raw.assetFailed = true;
  }
}

/**
 * Resolves every job (bounded concurrency) and stores encoded images in `snapshot.assets`. `pinned`: the page's
 * fixed/sticky elements, hidden while Tier 3 screenshots are taken.
 */
export async function resolveAssets(
  snapshot: RawPageSnapshot,
  jobs: readonly AssetJob[],
  pinned: readonly Element[] = [],
): Promise<void> {
  urlCache.clear();
  const assets: Record<string, RawImageAsset> = {};
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await resolveJob(jobs[next++]!, assets);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  await screenshotCrops(
    jobs.filter(
      (j): j is CropJob =>
        j.kind === 'frame' ||
        j.kind === 'raster' ||
        (j.kind !== 'bg' && j.kind !== 'glyph' && Boolean(j.raw.assetFailed) && !j.raw.svg),
    ),
    assets,
    pinned,
  );
  snapshot.assets = assets;
}

// ── Tier 3: screenshot crops ────────────────────────────────────────────────────────────────────────────────

type CropJob = Extract<AssetJob, { kind: 'svg' | 'img' | 'canvas' | 'video' | 'frame' | 'raster' }>;

const MAX_SHOTS = 24;
/** Elements up to this many viewport heights tall are stitched from several screenshots. */
const MAX_STITCH = 4;
const HIDE_ATTR = 'data-h2f-hide';

/** `child` is `ancestor` or inside it, across shadow-root boundaries. */
function within(child: Node, ancestor: Element): boolean {
  for (let n: Node | null = child; n; n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null))
    if (n === ancestor) return true;
  return false;
}

/**
 * Hides elements for the screenshots (visibility only: the layout doesn't move), the same way ::before/::after are
 * hidden during the read: a data attribute + an adopted style sheet per root. The returned function undoes both.
 */
function hideForScreenshots(els: readonly Element[]): () => void {
  const sheets = new Map<Document | ShadowRoot, CSSStyleSheet[]>();
  const marked: Element[] = [];
  for (const el of els) {
    if (!el.isConnected || el.hasAttribute(HIDE_ATTR)) continue;
    const scope = el.getRootNode() as Document | ShadowRoot;
    if (!('adoptedStyleSheets' in scope)) continue;
    if (!sheets.has(scope)) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(
        `[${HIDE_ATTR}],[${HIDE_ATTR}] *{visibility:hidden!important;transition:none!important}`,
      );
      sheets.set(scope, [...scope.adoptedStyleSheets]); // a copy: the live array is replaced next
      scope.adoptedStyleSheets = [...scope.adoptedStyleSheets, sheet];
    }
    el.setAttribute(HIDE_ATTR, '');
    marked.push(el);
  }
  return () => {
    for (const el of marked) el.removeAttribute(HIDE_ATTR);
    for (const [scope, original] of sheets) scope.adoptedStyleSheets = original;
  };
}

interface CropItem {
  job: CropJob;
  /** Document top (CSS px), refreshed from the live rect at every screenshot (scrolling can move content). */
  y: number;
  w: number;
  h: number;
  /** Rows of the element (from its top, CSS px) already in its canvas (stitching). */
  filled: number;
  canvas: OffscreenCanvas | null;
}

/**
 * Crops elements out of screenshots of the visible tab (EXT-I-4):
 * 1. Elements inside fixed/sticky elements (a logo in a fixed header) are cropped from one screenshot at the
 *    current scroll position, where they are on screen.
 * 2. The fixed/sticky elements are hidden (a header or a sticky bar would cover what is under it), then the page is
 *    scrolled top to bottom; every element fully on screen is cropped, and elements taller than the window (up to
 *    MAX_STITCH windows) are stitched from consecutive screenshots.
 * After each scroll the page settles (scroll handlers, reveal animations), and each element is cropped where its
 * live rect is at that moment. Elements wider than the window stay placeholders. Scroll position and page styles
 * are restored afterwards.
 */
async function screenshotCrops(
  jobs: readonly CropJob[],
  assets: Record<string, RawImageAsset>,
  pinned: readonly Element[],
): Promise<void> {
  if (!jobs.length || !runtime()) return;
  const sx = scrollX;
  const sy = scrollY;
  const vw = document.documentElement.clientWidth;
  const vh = innerHeight;
  const maxTop = Math.max(
    0,
    (document.scrollingElement ?? document.documentElement).scrollHeight - vh,
  );
  const items: CropItem[] = [];
  const pinnedItems: CropItem[] = [];
  for (const job of jobs) {
    const r = job.el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.x < -0.5 || r.x + r.width > vw + 0.5) continue;
    const it: CropItem = { job, y: r.y + sy, w: r.width, h: r.height, filled: 0, canvas: null };
    (pinned.some((p) => within(job.el, p)) ? pinnedItems : items).push(it);
  }

  let shots = 0;
  const shoot = async (top: number | null): Promise<ImageBitmap | null> => {
    if (top !== null) scrollTo({ left: sx, top, behavior: 'instant' });
    await settle(800);
    const shot = await ask({ type: 'h2f:capture-visible' });
    shots++;
    if (!shot?.ok || shot.type !== 'h2f:screenshot') return null;
    return createImageBitmap(await (await fetch(shot.dataUrl)).blob());
  };
  const store = async (it: CropItem, canvas: OffscreenCanvas) => {
    const enc = await encode(canvas, canvas.width, canvas.height, it.w, it.h, {
      source: 'screenshot',
    });
    assets[enc.id] = enc.asset;
    it.job.raw.assetId = enc.id;
    delete it.job.raw.assetFailed;
    if (it.job.kind === 'raster') it.job.raw.raster = true;
  };

  let restoreHidden = () => {};
  try {
    // 1. Inside fixed/sticky elements: where they are now (live rects, viewport coordinates).
    if (pinnedItems.length) {
      const bmp = await shoot(null);
      if (!bmp) return;
      const scale = bmp.width / innerWidth;
      for (const it of pinnedItems) {
        const r = it.job.el.getBoundingClientRect();
        if (r.y < -0.5 || r.y + r.height > vh + 0.5 || r.x < -0.5 || r.x + r.width > vw + 0.5) {
          items.push(it); // e.g. a sticky element further down: cropped in step 2 with the others
          continue;
        }
        try {
          const c = new OffscreenCanvas(
            Math.max(1, Math.round(r.width * scale)),
            Math.max(1, Math.round(r.height * scale)),
          );
          c.getContext('2d')!.drawImage(
            bmp,
            Math.round(r.x * scale),
            Math.round(r.y * scale),
            c.width,
            c.height,
            0,
            0,
            c.width,
            c.height,
          );
          await store(it, c);
        } catch {
          /* stays a placeholder */
        }
      }
      bmp.close();
    }

    // 2. Everything else, with the fixed/sticky elements that don't contain a remaining item hidden.
    const queue = items.filter((i) => i.h <= MAX_STITCH * vh).sort((a, b) => a.y - b.y);
    if (!queue.length) return;
    restoreHidden = hideForScreenshots(
      pinned.filter((p) => !queue.some((it) => within(it.job.el, p))),
    );
    while (queue.length && shots < MAX_SHOTS) {
      const first = queue[0]!;
      const before = first.filled;
      const want =
        first.filled > 0.5
          ? first.y + first.filled // continue stitching
          : first.h <= vh
            ? first.y - (vh - first.h) / 2 // centered
            : first.y;
      const bmp = await shoot(Math.min(maxTop, Math.max(0, want)));
      if (!bmp) break;
      const scale = bmp.width / innerWidth;
      for (let k = 0; k < queue.length;) {
        const it = queue[k]!;
        const r = it.job.el.getBoundingClientRect();
        it.y = r.y + scrollY;
        // Rows of the element on screen; the next ones must start exactly where its canvas stops.
        const visTop = Math.max(0, -r.y);
        const visBottom = Math.min(r.height, vh - r.y);
        if (
          r.width < 2 ||
          r.x < -0.5 ||
          r.x + r.width > vw + 0.5 ||
          visTop > it.filled + 0.5 ||
          visBottom <= it.filled + 0.5
        ) {
          k++;
          continue;
        }
        try {
          it.canvas ??= new OffscreenCanvas(
            Math.max(1, Math.round(r.width * scale)),
            Math.max(1, Math.round(r.height * scale)),
          );
          const srcY = Math.max(0, Math.round((r.y + it.filled) * scale));
          const srcH = Math.max(1, Math.round((r.y + visBottom) * scale) - srcY);
          it.canvas
            .getContext('2d')!
            .drawImage(
              bmp,
              Math.round(r.x * scale),
              srcY,
              it.canvas.width,
              srcH,
              0,
              Math.round(it.filled * scale),
              it.canvas.width,
              srcH,
            );
          it.filled = visBottom;
        } catch {
          queue.splice(k, 1); // stays a placeholder
          continue;
        }
        if (it.filled >= r.height - 0.5) {
          queue.splice(k, 1);
          await store(it, it.canvas).catch(() => undefined);
        } else k++;
      }
      bmp.close();
      if (queue[0] === first && first.filled === before) queue.shift(); // could not be brought into view
    }
  } finally {
    restoreHidden();
    scrollTo({ left: sx, top: sy, behavior: 'instant' });
  }
}

// ── CSS backgrounds (EXT-I-8) ───────────────────────────────────────────────────────────────────────────────

/** The k-th comma-separated value of a per-layer property (values cycle when there are fewer than layers). */
function layerValue(value: string, k: number): string {
  const parts = value.split(/,(?![^(]*\))/).map((p) => p.trim());
  return parts[k % parts.length] ?? '';
}

/** Decoded image for drawing: data: directly; anything else fetched (CORS, then service worker) into a blob URL. */
async function loadImage(url: string): Promise<HTMLImageElement | null> {
  let objectUrl: string | null = null;
  try {
    let src = url;
    if (!url.startsWith('data:')) {
      const blob = await fetchBlob(url);
      if (!blob) return null;
      src = objectUrl = URL.createObjectURL(blob);
    }
    const img = new Image();
    img.src = src;
    await img.decode();
    return img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null;
  } catch {
    return null;
  } finally {
    if (objectUrl) {
      const u = objectUrl;
      setTimeout(() => URL.revokeObjectURL(u), 0);
    }
  }
}

const POS_KEYWORDS: Record<string, number> = {
  left: 0,
  top: 0,
  center: 50,
  right: 100,
  bottom: 100,
};

/** A length, percentage or `calc(P% ± Npx)` (Chrome's computed form of edge offsets) → px; % of `free`. */
function lengthOf(t: string, free: number): number {
  const calc = /^calc\((.*)\)$/.exec(t.trim());
  if (calc) {
    let sum = 0;
    const expr = calc[1]!.replace(/\s*-\s*/g, ' -').replace(/\s*\+\s*/g, ' +');
    for (const m of expr.matchAll(/([+-]?[\d.]+)(%|px)?/g))
      sum += m[2] === '%' ? (parseFloat(m[1]!) / 100) * free : parseFloat(m[1]!);
    return sum;
  }
  return t.endsWith('%') ? (parseFloat(t) / 100) * free : parseFloat(t) || 0;
}

/** Splits on whitespace outside parentheses (calc() keeps its spaces). */
function tokens(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** One axis of background-position → offset of the tile in the positioning area (px). */
function posAxis(t: string[], free: number): number {
  // [keyword], [length|%|calc], or [keyword, offset] (offset from that edge).
  if (t.length === 2 && t[0]! in POS_KEYWORDS) {
    const off = lengthOf(t[1]!, free);
    return POS_KEYWORDS[t[0]!] === 100 ? free - off : off;
  }
  const v = t[0] ?? '50%';
  return v in POS_KEYWORDS ? (POS_KEYWORDS[v]! / 100) * free : lengthOf(v, free);
}

function parsePosition(value: string, freeX: number, freeY: number): [number, number] {
  const t = tokens(value);
  if (t.length === 4) return [posAxis(t.slice(0, 2), freeX), posAxis(t.slice(2), freeY)];
  if (t.length === 3)
    return t[1]! in POS_KEYWORDS
      ? [posAxis([t[0]!], freeX), posAxis(t.slice(1), freeY)]
      : [posAxis(t.slice(0, 2), freeX), posAxis([t[2]!], freeY)];
  return [posAxis([t[0] ?? '50%'], freeX), posAxis([t[1] ?? '50%'], freeY)];
}

/** background-size → tile size (px) for an image of natural size iw×ih in a W×H positioning area. */
function tileSize(value: string, iw: number, ih: number, W: number, H: number): [number, number] {
  const v = value.trim();
  if (v === 'cover' || v === 'contain') {
    const s = v === 'cover' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
    return [iw * s, ih * s];
  }
  const [a = 'auto', b = 'auto'] = v.split(/\s+/);
  const len = (t: string, of: number) =>
    t === 'auto' ? null : t.endsWith('%') ? (parseFloat(t) / 100) * of : parseFloat(t);
  const w = len(a, W);
  const h = len(b, H);
  if (w !== null && h !== null) return [w, h];
  if (w !== null) return [w, (w * ih) / iw];
  if (h !== null) return [(h * iw) / ih, h];
  return [iw, ih];
}

/**
 * Each url() layer of the element's background drawn into a canvas the size of its border box, honoring
 * background-size, -position (padding box) and -repeat; returns the asset id per layer (null = not readable).
 */
async function compositeBackgrounds(
  box: BgBox,
  layers: { url: string; layer: number }[],
  assets: Record<string, RawImageAsset>,
  flip: Flip | null,
): Promise<(string | null)[]> {
  const r = { width: box.width, height: box.height };
  /** Positioning area per background-origin (default padding-box): [left, top, width, height] in the border box. */
  const area = (origin: string): [number, number, number, number] => {
    const [bl, bt, br, bb] = box.border;
    if (origin === 'border-box') return [0, 0, r.width, r.height];
    const [pl, pt, pr, pb] = origin === 'content-box' ? box.padding : [0, 0, 0, 0];
    return [
      bl + pl,
      bt + pt,
      Math.max(1, r.width - bl - br - pl - pr),
      Math.max(1, r.height - bt - bb - pt - pb),
    ];
  };
  const cs = {
    backgroundSize: box.size,
    backgroundPosition: box.position,
    backgroundRepeat: box.repeat,
    backgroundOrigin: box.origin,
  };
  const scale = Math.min(
    2,
    Math.max(1, globalThis.devicePixelRatio || 1),
    MAX_SIDE / r.width,
    MAX_SIDE / r.height,
  );
  const ids: (string | null)[] = [];
  // Per-layer properties are indexed by the CSS layer (gradient layers included), not by the url count.
  for (const { url, layer: k } of layers) {
    try {
      const img = await withTimeout(loadImage(new URL(url, document.baseURI).href));
      if (!img) {
        ids.push(null);
        continue;
      }
      const [ox, oy, W, H] = area(layerValue(cs.backgroundOrigin, k));
      const [tw, th] = tileSize(
        layerValue(cs.backgroundSize, k),
        img.naturalWidth,
        img.naturalHeight,
        W,
        H,
      );
      const [px, py] = parsePosition(layerValue(cs.backgroundPosition, k), W - tw, H - th);
      const rep = layerValue(cs.backgroundRepeat, k).split(/\s+/);
      const repX = /^(repeat|space|round|repeat-x)$/.test(rep[0]!) && rep[0] !== 'repeat-y';
      const repY =
        rep.length > 1
          ? /^(repeat|space|round)$/.test(rep[1]!)
          : /^(repeat|space|round|repeat-y)$/.test(rep[0]!) && rep[0] !== 'repeat-x';
      const cw = Math.max(1, Math.round(r.width * scale));
      const ch = Math.max(1, Math.round(r.height * scale));
      const canvas = new OffscreenCanvas(cw, ch);
      const g = canvas.getContext('2d')!;
      g.scale(scale, scale);
      if (tw > 0.5 && th > 0.5) {
        const x0 = ox + px;
        const y0 = oy + py;
        const xs = repX ? Math.floor(-x0 / tw) : 0;
        const ys = repY ? Math.floor(-y0 / th) : 0;
        const xe = repX ? Math.ceil((r.width - x0) / tw) : 1;
        const ye = repY ? Math.ceil((r.height - y0) / th) : 1;
        let tiles = 0;
        for (let i = xs; i < xe && tiles < 4000; i++)
          for (let j = ys; j < ye && tiles < 4000; j++, tiles++)
            g.drawImage(img, x0 + i * tw, y0 + j * th, tw, th);
      }
      const enc = await encode(
        canvas,
        cw,
        ch,
        r.width,
        r.height,
        {
          source: url.startsWith('data:') ? 'canvas' : 'fetch',
          ...(url.startsWith('data:') ? {} : { originalUrl: url }),
        },
        flip,
      );
      assets[enc.id] = enc.asset;
      ids.push(enc.id);
    } catch {
      ids.push(null);
    }
  }
  return ids;
}

// ── Icon fonts (EXT-X-9) ────────────────────────────────────────────────────────────────────────────────────

/**
 * Draws an icon glyph with the page's own font (ligatures included, e.g. Material "home") at 2× into a transparent
 * PNG the size of the text box. Fails (→ stays text) when the font isn't loaded.
 */
async function drawGlyph(job: Extract<AssetJob, { kind: 'glyph' }>): Promise<Encoded | null> {
  if (!document.fonts.check(job.font, job.text)) return null;
  const scale = Math.min(4, 2 * Math.max(1, globalThis.devicePixelRatio || 1));
  const w = Math.max(1, Math.ceil(job.width * scale));
  const h = Math.max(1, Math.ceil(job.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  g.font = job.font;
  g.fillStyle = job.color;
  g.textBaseline = 'alphabetic';
  const m = g.measureText(job.text);
  // The text box is the glyph's content area: its top is the baseline minus the font ascent.
  g.fillText(
    job.text,
    0,
    m.fontBoundingBoxAscent + (job.height - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2,
  );
  return encode(canvas, w, h, job.width, job.height, { source: 'canvas' }, job.flip);
}
