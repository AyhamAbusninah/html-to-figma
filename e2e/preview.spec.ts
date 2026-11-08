/**
 * Local CaptureDocument preview (packages/preview/dist/index.html, opened from file:// like a user would).
 * Captures are produced from fixture pages with the extension's content script, then loaded into the preview.
 * Verification level: BROWSER INTEGRATION of the preview. It is NOT evidence about Figma rendering.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { CaptureDocument, CaptureNode } from '../packages/schema/src/index.ts';
import { repo, startFixtures, type FixtureServer } from './helpers.ts';

const PREVIEW = pathToFileURL(join(repo, 'packages/preview/dist/index.html')).href;
const CONTENT = join(repo, 'packages/extension/dist/content.js');
let fixtures: FixtureServer;
let dir: string;
const files: Record<string, string> = {};

test.beforeAll(async ({ browser }) => {
  fixtures = await startFixtures();
  dir = mkdtempSync(join(tmpdir(), 'h2f-preview-'));
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  for (const name of ['rtl-arabic.html', 'dashboard.html', 'forms.html']) {
    await page.goto(`${fixtures.origins.main}/pages/${name}`, { waitUntil: 'networkidle' });
    await page.addScriptTag({ path: CONTENT });
    const r = (await page.evaluate(() =>
      (globalThis as unknown as { __h2fCapture: () => Promise<unknown> }).__h2fCapture(),
    )) as { document: CaptureDocument };
    files[name] = join(dir, `${name}.capture.json`);
    writeFileSync(files[name], JSON.stringify(r.document));
  }
  await page.close();
});
test.afterAll(async () => {
  await fixtures?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function open(page: Page, file: string) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(PREVIEW);
  await page.locator('#file').setInputFiles(file);
  await expect(page.locator('#viewport')).toBeVisible();
}

const flatten = (n: CaptureNode): CaptureNode[] => [
  n,
  ...(n.type === 'FRAME' ? n.children.flatMap(flatten) : []),
];

for (const name of ['rtl-arabic.html', 'dashboard.html', 'forms.html']) {
  test(`renders every layer at its capture coordinates: ${name}`, async ({ page }) => {
    const doc = JSON.parse(readFileSync(files[name]!, 'utf8')) as CaptureDocument;
    await open(page, files[name]!);
    await page.locator('#zoom100').click();
    const nodes = flatten(doc.root);
    const counts = await page.evaluate(() => ({
      layers: document.querySelectorAll('#stage .n').length,
      texts: document.querySelectorAll('#stage .n.text').length,
      rtl: document.querySelectorAll('#stage .n.text[dir=rtl]').length,
      ph: document.querySelectorAll('#stage .n.ph').length,
    }));
    expect(counts.layers).toBe(nodes.length);
    expect(counts.texts).toBe(doc.meta.stats.textCount);
    expect(counts.rtl).toBe(
      nodes.filter((n) => n.type === 'TEXT' && n.style.direction === 'rtl').length,
    );
    expect(counts.ph).toBe(doc.meta.stats.imageCount + doc.meta.stats.svgCount);

    // Geometry: every element's box (relative to the root, unscaled) equals the capture rect (±0.5 px).
    const boxes = await page.evaluate(() => {
      const root = document.querySelector('#stage .root')!.getBoundingClientRect();
      const z = (window as unknown as { __h2fPreview: { zoom: number } }).__h2fPreview.zoom;
      return [...document.querySelectorAll<HTMLElement>('#stage .n')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.dataset.id!,
          x: (r.left - root.left) / z,
          y: (r.top - root.top) / z,
          w: r.width / z,
          h: el.classList.contains('text') ? null : r.height / z,
        };
      });
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const off = boxes.filter((b) => {
      const n = byId.get(b.id)!;
      return (
        Math.abs(b.x - n.rect.x) > 0.5 ||
        Math.abs(b.y - n.rect.y) > 0.5 ||
        Math.abs(b.w - n.rect.width) > 0.5 ||
        (b.h !== null && Math.abs(b.h - n.rect.height) > 0.5)
      );
    });
    expect(off.slice(0, 5), `${off.length}/${boxes.length} layers off their capture rect`).toEqual(
      [],
    );

    // Panels: document info, stats, every warning code listed.
    await expect(page.locator('#docList')).toContainText(
      `${doc.meta.document.width} × ${doc.meta.document.height}`,
    );
    await expect(page.locator('#docList')).toContainText(doc.meta.direction.toUpperCase());
    await expect(page.locator('#statsList')).toContainText(String(doc.meta.stats.nodeCount));
    for (const w of doc.meta.warnings)
      await expect(page.locator('#warnList')).toContainText(w.code);
    await expect(page.locator('.disclaimer')).toContainText('not');
  });
}

test('zoom, fit and pan', async ({ page }) => {
  await open(page, files['dashboard.html']!);
  await page.locator('#zoom100').click();
  await expect(page.locator('#zoomLabel')).toHaveText('100%');
  await page.locator('#zoomIn').click();
  await expect(page.locator('#zoomLabel')).toHaveText('125%');
  expect(await page.locator('#stage').evaluate((s) => s.style.transform)).toBe('scale(1.25)');
  await page.locator('#zoomOut').click();
  await page.locator('#zoomOut').click();
  await expect(page.locator('#zoomLabel')).toHaveText('80%');
  await page.locator('#zoomIn').click();
  // Pan by dragging.
  const before = await page.locator('#canvas').evaluate((c) => [c.scrollLeft, c.scrollTop]);
  const box = (await page.locator('#canvas').boundingBox())!;
  await page.mouse.move(box.x + 400, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 250, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator('#canvas').evaluate((c) => [c.scrollLeft, c.scrollTop]);
  expect(after[1]).toBeGreaterThan(before[1]!);
  // Fit: whole width visible, back to the top-left.
  await page.locator('#zoomFit').click();
  const fit = await page.evaluate(() => {
    const c = document.getElementById('canvas')!;
    return { scroll: [c.scrollLeft, c.scrollTop], fits: c.scrollWidth <= c.clientWidth + 1 };
  });
  expect(fit).toEqual({ scroll: [0, 0], fits: true });
});

test('the loaded file is never modified', async ({ page }) => {
  const f = files['forms.html']!;
  const hash = () => createHash('sha256').update(readFileSync(f)).digest('hex');
  const before = hash();
  await open(page, f);
  await page.locator('#zoomIn').click();
  expect(hash()).toBe(before);
});

test('invalid input: not JSON, unsupported major version (same validation as the plugin)', async ({
  page,
}) => {
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{"schemaVersion": "1.0');
  await page.goto(PREVIEW);
  await page.locator('#file').setInputFiles(bad);
  await expect(page.locator('#errors')).toContainText('File is not valid JSON');
  const v2 = join(dir, 'v2.json');
  writeFileSync(
    v2,
    JSON.stringify({
      ...JSON.parse(readFileSync(files['forms.html']!, 'utf8')),
      schemaVersion: '2.0.0',
    }),
  );
  await page.locator('#file').setInputFiles(v2);
  await expect(page.locator('#errors')).toContainText('This version supports v1.x');
  await expect(page.locator('#viewport')).toBeHidden();
});
