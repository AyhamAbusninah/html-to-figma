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
 */
import type { RawElement, RawImageAsset, RawPageSnapshot } from '@h2f/core';
import type { WorkerRequest, WorkerResponse } from '../shared/messages.ts';

export type AssetJob =
  | { kind: 'svg'; raw: RawElement; el: SVGSVGElement }
  | { kind: 'img'; raw: RawElement; el: HTMLImageElement }
  | { kind: 'canvas'; raw: RawElement; el: HTMLCanvasElement }
  | { kind: 'video'; raw: RawElement; el: HTMLVideoElement }
  /** <iframe>/<object>/<embed>: content not readable; Tier 3 screenshot only. */
  | { kind: 'frame'; raw: RawElement; el: HTMLElement }
  /** CSS background images of a (non-replaced) element: one composite per url() layer (EXT-I-8). */
  | { kind: 'bg'; raw: RawElement; el: Element; layers: { url: string; layer: number }[] };

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
  const blob = await withTimeout(fetchBlob(url));
  if (!blob) return null;
  const text = await blob.text();
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
function encodeUrl(url: string, renW: number, renH: number): Promise<Encoded | null> {
  const key = `${url}|${Math.round(renW)}x${Math.round(renH)}`;
  let p = urlCache.get(key);
  if (!p) {
    p = withTimeout(
      (async () => {
        const blob = await fetchBlob(url);
        if (!blob) return null;
        const bmp = await createImageBitmap(blob);
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
  if (job.kind === 'frame') return; // Tier 3 only
  if (job.kind === 'bg') {
    job.raw.bgAssets = await compositeBackgrounds(job.el, job.layers, assets);
    return;
  }
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
          : await encode(
              job.el as HTMLCanvasElement,
              (job.el as HTMLCanvasElement).width,
              (job.el as HTMLCanvasElement).height,
              r.width,
              r.height,
              {
                source: 'canvas',
              },
            ).catch(() => null);
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
  await screenshotCrops(
    jobs.filter((j) => j.kind === 'frame' || (j.kind !== 'bg' && j.raw.assetFailed && !j.raw.svg)),
    assets,
  );
  snapshot.assets = assets;
}

// ── Tier 3: screenshot crops ────────────────────────────────────────────────────────────────────────────────

const MAX_SHOTS = 24;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Crops each remaining element out of screenshots of the visible tab (EXT-I-4). Elements are visited top to bottom;
 * each screenshot is centered on the next element and every element fully inside it is cropped. Elements taller
 * or wider than the viewport stay placeholders. The scroll position is restored afterwards.
 */
async function screenshotCrops(
  jobs: readonly AssetJob[],
  assets: Record<string, RawImageAsset>,
): Promise<void> {
  if (!jobs.length || !runtime()) return;
  const sx = scrollX;
  const sy = scrollY;
  const vw = document.documentElement.clientWidth;
  const items = jobs
    .map((job) => {
      const r = job.el.getBoundingClientRect();
      return { job, x: r.x + sx, y: r.y + sy, w: r.width, h: r.height };
    })
    .filter(
      (i) =>
        i.w >= 2 && i.h >= 2 && i.h <= innerHeight && i.x - sx >= 0 && i.x - sx + i.w <= vw + 0.5,
    )
    .sort((a, b) => a.y - b.y);
  const maxTop = Math.max(
    0,
    (document.scrollingElement ?? document.documentElement).scrollHeight - innerHeight,
  );
  let shots = 0;
  try {
    while (items.length && shots < MAX_SHOTS) {
      const first = items[0]!;
      const top = Math.min(maxTop, Math.max(0, first.y - (innerHeight - first.h) / 2));
      scrollTo({ left: sx, top, behavior: 'instant' });
      await nextFrame();
      await nextFrame();
      await sleep(100);
      const shot = await ask({ type: 'h2f:capture-visible' });
      shots++;
      if (!shot?.ok || shot.type !== 'h2f:screenshot') break;
      const bmp = await createImageBitmap(await (await fetch(shot.dataUrl)).blob());
      const scale = bmp.width / innerWidth;
      const nowTop = scrollY;
      for (let k = 0; k < items.length;) {
        const it = items[k]!;
        const vy = it.y - nowTop;
        if (vy < -0.5 || vy + it.h > innerHeight + 0.5) {
          k++;
          continue;
        }
        items.splice(k, 1);
        try {
          const crop = await createImageBitmap(
            bmp,
            Math.round((it.x - sx) * scale),
            Math.round(vy * scale),
            Math.max(1, Math.round(it.w * scale)),
            Math.max(1, Math.round(it.h * scale)),
          );
          const enc = await encode(crop, crop.width, crop.height, it.w, it.h, {
            source: 'screenshot',
          });
          crop.close();
          assets[enc.id] = enc.asset;
          it.job.raw.assetId = enc.id;
          delete it.job.raw.assetFailed;
        } catch {
          /* stays a placeholder */
        }
      }
      bmp.close();
      if (items[0] === first) items.shift(); // could not be brought fully into view
    }
  } finally {
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
  el: Element,
  layers: { url: string; layer: number }[],
  assets: Record<string, RawImageAsset>,
): Promise<(string | null)[]> {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const n = (v: string) => parseFloat(v) || 0;
  /** Positioning area per background-origin (default padding-box): [left, top, width, height] in the border box. */
  const area = (origin: string): [number, number, number, number] => {
    const [bl, bt, br, bb] = [
      cs.borderLeftWidth,
      cs.borderTopWidth,
      cs.borderRightWidth,
      cs.borderBottomWidth,
    ].map(n) as [number, number, number, number];
    if (origin === 'border-box') return [0, 0, r.width, r.height];
    const [pl, pt, pr, pb] =
      origin === 'content-box'
        ? ([cs.paddingLeft, cs.paddingTop, cs.paddingRight, cs.paddingBottom].map(n) as [
            number,
            number,
            number,
            number,
          ])
        : [0, 0, 0, 0];
    return [
      bl + pl,
      bt + pt,
      Math.max(1, r.width - bl - br - pl - pr),
      Math.max(1, r.height - bt - bb - pt - pb),
    ];
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
      const enc = await encode(canvas, cw, ch, r.width, r.height, {
        source: url.startsWith('data:') ? 'canvas' : 'fetch',
        ...(url.startsWith('data:') ? {} : { originalUrl: url }),
      });
      assets[enc.id] = enc.asset;
      ids.push(enc.id);
    } catch {
      ids.push(null);
    }
  }
  return ids;
}
