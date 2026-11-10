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
  const icons = nodes.filter((n) => n.type === 'IMAGE' && n.name.startsWith('icon ·'));
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
