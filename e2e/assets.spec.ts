/**
 * R4 assets: inline SVG and image pixels in real Chromium (content script injected like the popup does).
 * Verification level: BROWSER INTEGRATION. The Figma side of these techniques was verified by real pastes
 * (spikes/figma-svg/README.md, Phase 1 findings).
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  validateCapture,
  type CaptureDocument,
  type CaptureNode,
  type FrameNode,
} from '../packages/schema/src/index.ts';
import { figmaSvg } from '../packages/extension/src/shared/figma-copy.ts';
import { repo, startFixtures, type FixtureServer } from './helpers.ts';

let fixtures: FixtureServer;
test.beforeAll(async () => {
  fixtures = await startFixtures();
});
test.afterAll(async () => {
  await fixtures?.close();
});

/** The page DOM without the injected capture script (Playwright inlines it). */
const dom = (page: Page) =>
  page.evaluate(() => {
    const c = document.documentElement.cloneNode(true) as HTMLElement;
    c.querySelectorAll('script').forEach((s) => {
      if ((s.textContent ?? '').includes('__h2fCapture')) s.remove();
    });
    return c.outerHTML;
  });

async function capture(page: Page, name: string) {
  await page.goto(`${fixtures.origins.main}/pages/${name}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const before = await dom(page);
  await page.addScriptTag({ path: join(repo, 'packages/extension/dist/content.js') });
  const r = (await page.evaluate(() =>
    (globalThis as unknown as { __h2fCapture: () => Promise<unknown> }).__h2fCapture(),
  )) as { ok: boolean; document: CaptureDocument; textLines: Record<string, string[]> };
  expect(r.ok).toBe(true);
  expect(await dom(page), 'capture must not modify the page').toBe(before);
  expect(
    await page.evaluate(() => document.adoptedStyleSheets.length),
    'style sheets restored',
  ).toBe(0);
  expect(validateCapture(r.document).ok).toBe(true);
  const nodes: CaptureNode[] = [];
  const walk = (n: CaptureNode) => {
    nodes.push(n);
    if (n.type === 'FRAME') n.children.forEach(walk);
  };
  walk(r.document.root);
  return { ...r, nodes };
}

test('inline SVG: one sanitized, self-contained SvgNode per <svg> (EXT-S-1..3, S-5)', async ({
  page,
}) => {
  const { nodes, document, textLines } = await capture(page, 'svg-icons.html');
  const svgs = nodes.filter((n) => n.type === 'SVG');
  expect(svgs.length).toBeGreaterThanOrEqual(18);
  for (const n of svgs) {
    expect(n.svg).toMatch(/^<svg\b[^>]*viewBox="/);
    expect(n.svg).not.toMatch(/currentColor|<use\b|<script|onclick|onload|alert\(|foreignObject/i);
    expect(n.svg).not.toMatch(/<image[^>]*href="(?!data:)/);
  }
  // Copy to Figma nests every SVG as editable vectors.
  expect(figmaSvg(document, textLines).stats.svgs).toBe(svgs.length);
});

test('same-origin, data:, blob:, canvas and video images become encoded assets, deduped (EXT-I-2/6/7/9)', async ({
  page,
}) => {
  const { nodes, document, textLines } = await capture(page, 'images-same-origin.html');
  const images = nodes.filter((n) => n.type === 'IMAGE');
  const withPixels = images.filter((n) => n.assetId);
  expect(withPixels.length).toBeGreaterThanOrEqual(20);
  const assets = Object.values(document.assets.images);
  expect(assets.length).toBeLessThan(withPixels.length); // identical images stored once
  for (const a of assets) {
    expect(['image/png', 'image/jpeg']).toContain(a.mime);
    expect(Math.max(a.width, a.height)).toBeLessThanOrEqual(4096);
  }
  const out = figmaSvg(document, textLines);
  expect(out.stats.images).toBe(withPixels.length);
  expect(out.svg).toContain('href="data:image/');
});

test('cross-origin images without CORS stay placeholders with IMAGE_FETCH_FAILED (Tier 2/3 pending)', async ({
  page,
}) => {
  const { nodes, document } = await capture(page, 'images-cross-origin.html');
  const images = nodes.filter((n) => n.type === 'IMAGE');
  expect(images.length).toBeGreaterThan(0);
  expect(images.every((n) => n.assetId === null)).toBe(true);
  expect(document.meta.warnings.map((w) => w.code)).toContain('IMAGE_FETCH_FAILED');
});

test('CSS backgrounds: url() layers composited to image fills, gradients as gradient fills (EXT-I-8, EXT-V-3)', async ({
  page,
}) => {
  const { nodes, document, textLines } = await capture(page, 'backgrounds.html');
  const frames = nodes.filter((n) => n.type === 'FRAME');
  const fills = frames.flatMap((f) => f.fills);
  expect(fills.filter((p) => p.type === 'IMAGE').length).toBeGreaterThanOrEqual(15);
  expect(fills.some((p) => p.type === 'GRADIENT_LINEAR')).toBe(true);
  expect(fills.some((p) => p.type === 'GRADIENT_RADIAL')).toBe(true);
  // background-clip: text → the transparent text gets the gradient's first color, no background fill.
  const clip = nodes.find((n) => n.type === 'TEXT' && n.characters === 'Clip text');
  expect(clip && clip.type === 'TEXT' && clip.style.color.a).toBe(1);
  const out = figmaSvg(document, textLines);
  expect(out.svg).toMatch(/<linearGradient id="grad\d+" gradientUnits="userSpaceOnUse"/);
  expect(out.stats.images).toBeGreaterThanOrEqual(15);
});

test('hero background: color, photo and gradient overlay stack in CSS order (landing page)', async ({
  page,
}) => {
  const { nodes } = await capture(page, 'landing-page.html');
  const hero = nodes.find(
    (n) =>
      n.type === 'FRAME' &&
      n.fills.some((p) => p.type === 'IMAGE') &&
      n.fills.some((p) => p.type === 'GRADIENT_LINEAR'),
  );
  expect(hero, 'hero frame with image + gradient fills').toBeTruthy();
  const types = hero!.type === 'FRAME' ? hero!.fills.map((p) => p.type) : [];
  expect(types.indexOf('IMAGE')).toBeLessThan(types.indexOf('GRADIENT_LINEAR')); // overlay above the photo
});

test('::before/::after materialized for the read (counters, attr, quotes, url, dots), page restored (EXT-T-11)', async ({
  page,
}) => {
  const { nodes } = await capture(page, 'pseudo-elements.html');
  const texts = nodes
    .filter((n) => n.type === 'TEXT')
    .map((n) => (n.type === 'TEXT' ? n.characters : ''));
  for (const t of ['1', '2', '3', 'kg', 'pcs', '“', '”', '★', '→']) expect(texts).toContain(t);
  expect(texts.some((t) => /counter\(\w|attr\(\w/.test(t))).toBe(false); // unresolved values
  const dots = nodes.filter(
    (n) =>
      n.type === 'FRAME' &&
      n.name === '::before' &&
      Math.round(n.rect.width) === 8 &&
      Math.round(n.rect.height) === 8,
  );
  expect(dots.length).toBe(4); // status pills
  expect(
    nodes.some(
      (n) => n.type === 'FRAME' && n.name === '::before' && Math.round(n.rect.width) === 48,
    ),
  ).toBe(true);
  // content: url(icon-star.svg) → the image at its natural size (24×24): vectors (SVG) or pixels.
  const urlStar = nodes.find(
    (n) =>
      ((n.type === 'IMAGE' && n.assetId !== null) || n.type === 'SVG') &&
      Math.round(n.rect.width) === 24 &&
      Math.round(n.rect.height) === 24,
  );
  expect(urlStar?.rect).toMatchObject({ width: 24, height: 24 });
});

test('icon fonts: Font Awesome, Material ligatures and PUA glyphs become images; labels stay text (EXT-X-9)', async ({
  page,
}) => {
  const { nodes, document } = await capture(page, 'icon-fonts.html');
  const icons = nodes.filter((n) => n.type === 'IMAGE' && n.name.startsWith('Icon'));
  expect(icons.length).toBeGreaterThanOrEqual(15);
  for (const n of icons)
    expect(n.type === 'IMAGE' && n.assetId && document.assets.images[n.assetId]!.mime).toBe(
      'image/png',
    );
  const texts = nodes
    .filter((n) => n.type === 'TEXT')
    .map((n) => (n.type === 'TEXT' ? n.characters : ''));
  expect(texts.some((t) => /[\uE000-\uF8FF]/.test(t))).toBe(false); // no icon codepoints left as text
  for (const label of ['Saved', 'Settings', 'Delete']) expect(texts).toContain(label);
});

test('captured as scrolled to the top: fixed header at y = 0, mirrored pixels and icons, inset clip, capitalized text (EXT-T-9, AC-EXT-7, EXT-G-3, EXT-V-10)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${fixtures.origins.main}/pages/page-effects.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => (document.getElementById('tall') as HTMLCanvasElement).dataset.tainted,
  );
  await page.evaluate(() => scrollTo(0, 1500));
  await page.waitForFunction(() => document.body.classList.contains('scrolled'));
  const before = await dom(page);
  await page.addScriptTag({ path: join(repo, 'packages/extension/dist/content.js') });
  const r = (await page.evaluate(() =>
    (globalThis as unknown as { __h2fCapture: () => Promise<unknown> }).__h2fCapture(),
  )) as { ok: boolean; document: CaptureDocument; textLines: Record<string, string[]> };
  expect(r.ok).toBe(true);
  expect(validateCapture(r.document).ok).toBe(true);
  // The user's scroll position and the page are back as they were (the scroll listener re-adds its class).
  expect(await page.evaluate(() => scrollY)).toBe(1500);
  await page.waitForFunction(() => document.body.classList.contains('scrolled'));
  expect(await dom(page), 'capture must not modify the page').toBe(before);
  expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBe(0);

  const nodes: CaptureNode[] = [];
  const walk = (n: CaptureNode) => {
    nodes.push(n);
    if (n.type === 'FRAME') n.children.forEach(walk);
  };
  walk(r.document.root);
  // CSS-style names live in domPath (layer names are readable names, core/naming.ts).
  const byName = (re: RegExp) => nodes.find((n) => re.test(n.domPath ?? n.name));

  // 1. Fixed header where it is at the top of the page; the scroll-only bar is off screen (as at the top).
  expect(byName(/header#top-header/)!.rect.y).toBe(0);
  const bar = byName(/div#scroll-bar/)!;
  expect(bar.rect.y + bar.rect.height).toBeLessThanOrEqual(64); // behind the header, not in the content

  // 3a. Mirrored image: the encoded pixels are flipped (left blue, right red, as on screen).
  const img = byName(/img#flip-img/) as { assetId: string };
  const a = r.document.assets.images[img.assetId]!;
  const [left, right] = await page.evaluate(async (src) => {
    const i = new Image();
    i.src = src;
    await i.decode();
    const c = new OffscreenCanvas(i.width, i.height);
    const g = c.getContext('2d')!;
    g.drawImage(i, 0, 0);
    const at = (x: number) => Array.from(g.getImageData(x, i.height >> 1, 1, 1).data);
    return [at(2), at(i.width - 3)];
  }, `data:${a.mime};base64,${a.data}`);
  expect(left!.slice(0, 3)).toEqual([0, 0, 255]);
  expect(right!.slice(0, 3)).toEqual([255, 0, 0]);
  // 3b. Mirrored inline icon: content wrapped in a mirroring group inside its viewBox.
  expect((byName(/svg#flip-icon/) as { svg: string }).svg).toContain(
    '<g transform="matrix(-1 0 0 1 24 0)">',
  );
  // 3c. clip-path: inset(-9999px -9999px 0): a clipping frame ending at the section's bottom edge.
  const clip = byName(/^section#clip-section::clip$/) as FrameNode;
  const section = byName(/^section#clip-section$/)!;
  const clipImg = byName(/img#clip-img/)!;
  expect(clip.clipsContent).toBe(true);
  expect(clip.rect.y).toBe(clipImg.rect.y); // nothing cut at the top
  expect(clip.rect.y + clip.rect.height).toBe(section.rect.y + section.rect.height);
  expect(clipImg.rect.y + clipImg.rect.height).toBeGreaterThan(clip.rect.y + clip.rect.height);

  // A canvas that reads back blank (WebGL; same symptom as a GPU-decoded video frame) is not kept as an empty image:
  // without the extension's screenshot tier it stays a marked placeholder.
  const gl = byName(/canvas#gl/) as { assetId: string | null; name: string };
  expect(gl.assetId).toBeNull();
  expect(gl.name).toMatch(/^⚠/);

  // 4. Copy to Figma writes capitalized text as shown.
  const { svg } = figmaSvg(r.document, r.textLines);
  expect(svg).toContain('A Selection Of Designer Pieces');
  expect(svg).toMatch(/>Bags</);
});
