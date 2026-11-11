/**
 * Extension skeleton in real Chromium, for BOTH the rebuilt build and the recovered reference build.
 * Verification level: BROWSER INTEGRATION.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  validateCapture,
  type CaptureDocument,
  type CaptureNode,
} from '../packages/schema/src/index.ts';
import {
  launchWithExtension,
  repo,
  startFixtures,
  VARIANTS,
  type ExtensionHarness,
  type FixtureServer,
  type Variant,
} from './helpers.ts';

/** The reference build is the R0-recovered 0.1.0; the rebuilt extension is 0.4.0 (R2 capture, OQ-11 line split, Copy to Figma, images & icons). */
const VERSION: Record<Variant, string> = { rebuilt: '0.4.0', reference: '0.1.0' };

let fixtures: FixtureServer;
test.beforeAll(async () => {
  fixtures = await startFixtures();
});
test.afterAll(async () => {
  await fixtures?.close();
});

/** Opens the popup as a tab and makes `target` the active tab of the popup's window, as if the user clicked the icon there. */
async function openPopupFor(h: ExtensionHarness, target: Page): Promise<Page> {
  const popup = await h.context.newPage();
  await popup.goto(`chrome-extension://${h.extensionId}/popup.html`);
  const targetUrl = target.url();
  await popup.evaluate(async (url) => {
    const self = await chrome.tabs.getCurrent();
    const [tab] = (await chrome.tabs.query({})).filter((t) => t.url === url);
    if (!tab?.id || !self) throw new Error(`tab not found: ${url}`);
    await chrome.tabs.move(tab.id, { windowId: self.windowId, index: -1 });
    await chrome.tabs.update(tab.id, { active: true });
  }, targetUrl);
  await popup.reload(); // popup init runs on load and reads the (now) active tab
  return popup;
}

for (const variant of Object.keys(VARIANTS) as Variant[]) {
  test.describe(`extension skeleton [${variant}]`, () => {
    let h: ExtensionHarness;
    test.beforeAll(async () => {
      h = await launchWithExtension(VARIANTS[variant].extension);
    });
    test.afterAll(async () => {
      await h?.close();
    });

    test('service worker answers ping; Tier-2 fetch reads allow-listed cross-origin images (EXT-I-3)', async () => {
      const page = await h.context.newPage();
      await page.goto(`chrome-extension://${h.extensionId}/popup.html`);
      const allowListed = `${fixtures.origins.second}/assets/img/photo-160x100.png`; // no CORS headers
      const [pong, fetched, bad] = await page.evaluate(
        async (url) => [
          await chrome.runtime.sendMessage({ type: 'h2f:ping' }),
          await chrome.runtime.sendMessage({ type: 'h2f:fetch-asset', url }),
          await chrome.runtime.sendMessage({ type: 'h2f:fetch-asset', url: 'javascript:alert(1)' }),
        ],
        allowListed,
      );
      expect(pong).toEqual({ ok: true, type: 'h2f:pong', version: VERSION[variant] });
      if (variant === 'reference') {
        expect(fetched).toEqual({
          ok: false,
          error: 'Tier-2 asset fetch is not implemented yet (P4)',
        });
      } else {
        expect(fetched).toMatchObject({ ok: true, type: 'h2f:asset', mime: 'image/png' });
        expect((fetched as { data: string }).data.startsWith('iVBORw0KGgo')).toBe(true); // PNG signature
        expect(bad).toEqual({ ok: false, error: 'only http(s) URLs' });
      }
      await page.close();
    });

    test('cross-origin images: Tier 2 fetch for allow-listed hosts, Tier 3 crops, page and scroll untouched (EXT-I-3/4)', async () => {
      test.skip(variant === 'reference', 'assets arrive in 0.4.0');
      const target = await h.context.newPage();
      await target.setViewportSize({ width: 1280, height: 800 });
      await target.goto(`${fixtures.origins.main}/pages/images-cross-origin.html`, {
        waitUntil: 'networkidle',
      });
      const domBefore = await target.evaluate(() => document.documentElement.outerHTML);
      const scrollBefore = await target.evaluate(() => [scrollX, scrollY]);
      const popup = await openPopupFor(h, target);
      await popup.locator('#capture').click();
      await expect(popup.locator('#done')).toBeVisible({ timeout: 60_000 });
      // Read the capture through Copy JSON with the clipboard stubbed.
      await popup.evaluate(() => {
        const w = window as unknown as { __copied: string[] };
        w.__copied = [];
        navigator.clipboard.writeText = async (t: string) => void w.__copied.push(t);
      });
      await popup.locator('#copy').click();
      await expect
        .poll(() =>
          popup.evaluate(() => (window as unknown as { __copied: string[] }).__copied.length),
        )
        .toBe(1);
      const doc = JSON.parse(
        await popup.evaluate(() => (window as unknown as { __copied: string[] }).__copied[0]!),
      ) as CaptureDocument;
      expect(validateCapture(doc).ok).toBe(true);
      const sources = Object.values(doc.assets.images).map((a) => a.source);
      const flat: CaptureNode[] = [];
      const walk = (n: CaptureNode) => {
        flat.push(n);
        if (n.type === 'FRAME') n.children.forEach(walk);
      };
      walk(doc.root);
      // 127.0.0.1 (second origin) is on the install allow-list: the service worker fetches it without CORS
      // (two <img> of the same file → one asset), and the cross-origin <img src=logo.svg> becomes vectors.
      expect(sources).toContain('fetch');
      const fetched = flat.filter(
        (n) => n.type === 'IMAGE' && n.assetId && doc.assets.images[n.assetId]!.source === 'fetch',
      );
      expect(fetched.length).toBeGreaterThanOrEqual(2);
      expect(flat.some((n) => n.type === 'SVG')).toBe(true);
      expect(
        Object.values(doc.assets.images).some((a) =>
          a.originalUrl?.startsWith(fixtures.origins.second),
        ),
      ).toBe(true);
      // Tier 3 needs activeTab (granted by a real toolbar click) or the all-sites permission; the popup opened as a
      // tab in this test has neither, so whatever is left stays a placeholder and the popup offers the permission.
      await expect(popup.locator('#imagesNote')).toBeVisible();
      expect(
        await target.evaluate(() => document.documentElement.outerHTML),
        'page DOM changed',
      ).toBe(domBefore);
      expect(await target.evaluate(() => [scrollX, scrollY])).toEqual(scrollBefore);
      await popup.close();
      await target.close();
    });

    test('popup on a restricted page disables capture (EXT-P-6, E-1)', async () => {
      const page = await h.context.newPage();
      await page.goto(`chrome-extension://${h.extensionId}/popup.html`); // active tab = the popup itself
      await expect(page.locator('#capture')).toBeDisabled();
      await expect(page.locator('#restricted')).toBeVisible();
      await page.close();
    });

    for (const fixture of ['boxes.html', 'rtl-arabic.html']) {
      test(`popup capture → stats → download → valid CaptureDocument: ${fixture}`, async () => {
        const target = await h.context.newPage();
        await target.goto(`${fixtures.origins.main}/pages/${fixture}`, {
          waitUntil: 'networkidle',
        });
        const domBefore = await target.evaluate(() => document.documentElement.outerHTML);
        const expected = await target.evaluate(() => ({
          title: document.title,
          lang: document.documentElement.lang,
          dir: getComputedStyle(document.documentElement).direction,
          width: Math.max(document.scrollingElement!.scrollWidth, innerWidth),
          height: Math.max(document.scrollingElement!.scrollHeight, innerHeight),
        }));

        const popup = await openPopupFor(h, target);
        await expect(popup.locator('#page')).toHaveText(expected.title);
        await expect(popup.locator('#capture')).toBeEnabled();
        await popup.locator('#capture').click();
        await expect(popup.locator('#done')).toBeVisible();

        const stats = Object.fromEntries(
          await popup
            .locator('#stats dt')
            .evaluateAll((dts) =>
              dts.map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]),
            ),
        );
        expect(stats.Document).toBe(`${expected.width} × ${expected.height}`);
        expect(stats.Direction).toBe(
          `${expected.dir.toUpperCase()}${expected.lang ? ` · ${expected.lang}` : ''}`,
        );
        if (variant === 'reference') {
          expect(stats.Nodes).toBe('1'); // R0 skeleton: root frame only
          expect(stats.Warnings).toBe('0');
        } else {
          expect(Number(stats.Nodes)).toBeGreaterThan(50); // R2: full tree
        }
        await expect(popup.locator('#copy')).toBeEnabled();

        if (variant === 'rebuilt') {
          // Copy to Figma (EXT-O-7): the clipboard gets one SVG that Figma Web imports on Ctrl+V. The clipboard
          // API is stubbed to read back exactly what the popup wrote; the paste itself is verified in real
          // Figma Web (docs/spikes/FIGMA_CLIPBOARD.md §4b), which CI can't run.
          await popup.evaluate(() => {
            const w = window as unknown as { __copied: string[] };
            w.__copied = [];
            navigator.clipboard.writeText = async (t: string) => void w.__copied.push(t);
          });
          await popup.locator('#copyFigma').click();
          await expect(popup.locator('#figmaNote')).toContainText('In Figma: click the canvas');
          const svg = await popup.evaluate(() => {
            const copied = (window as unknown as { __copied: string[] }).__copied;
            const xml = new DOMParser().parseFromString(copied[0] ?? '', 'image/svg+xml');
            // The writer's own text layers (text inside captured SVG graphics keeps the page's markup).
            const texts = [...xml.querySelectorAll('text')].filter(
              (t) => t.closest('svg') === xml.documentElement,
            );
            const width = (s: string) => Number(xml.documentElement.getAttribute(s));
            return {
              copies: copied.length,
              wellFormed:
                !xml.querySelector('parsererror') && xml.documentElement.tagName === 'svg',
              width: width('width'),
              height: width('height'),
              first: [...xml.documentElement.children]
                .find((c) => c.tagName !== 'defs')
                ?.getAttribute('id'),
              texts: texts.length,
              arabicRight: texts.filter(
                (t) => /[؀-ۿ]/.test(t.textContent ?? '') && t.getAttribute('text-anchor') === 'end',
              ).length,
              direction: texts.filter((t) => t.hasAttribute('direction')).length,
              psFonts: texts.every((t) =>
                /^[^,\s]+-[^,\s]+, /.test(t.getAttribute('font-family') ?? ''),
              ),
            };
          });
          expect(svg).toMatchObject({
            copies: 1,
            wellFormed: true,
            width: expected.width,
            height: expected.height,
            first: 'Background',
            direction: 0,
            psFonts: true,
          });
          expect(svg.texts).toBeGreaterThan(5);
          if (fixture === 'rtl-arabic.html') expect(svg.arabicRight).toBeGreaterThan(20);

          // Styles board (Phase 2): a second, separate SVG with named color swatches and text-style samples.
          await popup.locator('#copyStyles').click();
          await expect(popup.locator('#figmaNote')).toContainText('Copied the styles board');
          const board = await popup.evaluate(() => {
            const copied = (window as unknown as { __copied: string[] }).__copied;
            const xml = new DOMParser().parseFromString(copied[1] ?? '', 'image/svg+xml');
            const ids = [...xml.querySelectorAll('[id]')].map((e) => e.getAttribute('id') ?? '');
            return {
              copies: copied.length,
              wellFormed: !xml.querySelector('parsererror'),
              colors: ids.filter((i) => i.startsWith('Color · #')).length,
              textStyles: ids.filter((i) => i.startsWith('Text style · ')).length,
            };
          });
          expect(board).toMatchObject({ copies: 2, wellFormed: true });
          expect(board.colors).toBeGreaterThan(2);
          expect(board.textStyles).toBeGreaterThan(1);
        }

        // Download through chrome.downloads. Playwright's download interception (acceptDownloads) ignores the
        // `filename` option (it names the file after the blob URL), so we assert the options our popup passes to
        // chrome.downloads.download (what our code controls) and read the content from Playwright's copy.
        await popup.evaluate(() => {
          const calls: unknown[] = [];
          (window as unknown as { __downloadCalls: unknown[] }).__downloadCalls = calls;
          const original = chrome.downloads.download.bind(chrome.downloads);
          chrome.downloads.download = ((options: chrome.downloads.DownloadOptions) => {
            calls.push({
              filename: options.filename,
              saveAs: options.saveAs,
              isBlob: options.url.startsWith('blob:'),
            });
            return original(options);
          }) as typeof chrome.downloads.download;
        });
        const [download] = await Promise.all([
          popup.waitForEvent('download'),
          popup.locator('#download').click(),
        ]);
        const calls = await popup.evaluate(
          () => (window as unknown as { __downloadCalls: unknown[] }).__downloadCalls,
        );
        expect(calls).toEqual([
          {
            filename: expect.stringMatching(/^figma-capture_localhost_\d{8}-\d{6}\.json$/),
            saveAs: false,
            isBlob: true,
          },
        ]);
        const state = await popup.evaluate(async () => {
          for (let i = 0; i < 100; i++) {
            const [d] = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 });
            if (d?.state === 'complete' || d?.state === 'interrupted') return d.state;
            await new Promise((r) => setTimeout(r, 100));
          }
          return 'timeout';
        });
        expect(state).toBe('complete');
        const saved = JSON.parse(readFileSync((await download.path())!, 'utf8')) as CaptureDocument;
        const result = validateCapture(saved);
        expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true);
        expect(saved.meta).toMatchObject({
          title: expected.title,
          lang: expected.lang,
          direction: expected.dir === 'rtl' ? 'rtl' : 'ltr',
          document: { width: expected.width, height: expected.height },
          extractorVersion: VERSION[variant],
          captureMode: 'page',
        });
        expect(saved.meta.stats.bytes).toBeGreaterThan(0);
        expect(saved.root).toMatchObject({
          type: 'FRAME',
          rect: { width: expected.width, height: expected.height },
        });
        if (variant === 'reference') expect(saved.root.children).toEqual([]);
        else {
          expect(saved.root.children.length).toBeGreaterThan(0);
          expect(stats.Nodes).toBe(String(saved.meta.stats.nodeCount));
          expect(stats.Warnings).toBe(String(saved.meta.warnings.length));
        }

        // Capture must not modify the page (AC-EXT-8).
        expect(await target.evaluate(() => document.documentElement.outerHTML)).toBe(domBefore);
        await popup.close();
        await target.close();
      });
    }
  });
}

test('R0 invariants preserved: rebuilt metadata and root frame match the reference on every fixture page', async ({
  browser,
}) => {
  // R2 intentionally adds child nodes, stats and warnings. Everything the R0 skeleton produced must be unchanged.
  const pages = readFileSync(join(repo, 'fixtures/pages/index.html'), 'utf8').match(
    /href="([a-z0-9-]+\.html)"/g,
  )!;
  const names = [...new Set(pages.map((m) => m.slice(6, -1)))];
  expect(names.length).toBeGreaterThanOrEqual(20);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const summary: Record<string, unknown>[] = [];
  const invariant = (r: { ok: boolean; document?: CaptureDocument }) => {
    const { root, meta } = structuredClone(r.document!);
    const { capturedAt: _c, stats: _s, warnings: _w, extractorVersion: _v, ...m } = meta;
    const { children: _k, ...rootProps } = root;
    return { ok: r.ok, meta: m, root: rootProps };
  };
  for (const name of names) {
    await page.goto(`${fixtures.origins.main}/pages/${name}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const run = async (file: string) => {
      await page.addScriptTag({ path: file });
      return page.evaluate(() =>
        (globalThis as unknown as { __h2fCapture: () => Promise<never> }).__h2fCapture(),
      );
    };
    const reference = await run(join(VARIANTS.reference.extension, 'content.js'));
    const rebuilt = await run(join(VARIANTS.rebuilt.extension, 'content.js'));
    expect(invariant(rebuilt), name).toEqual(invariant(reference));
    const d = (rebuilt as { document: CaptureDocument }).document;
    expect(validateCapture(d).ok, name).toBe(true);
    summary.push({
      page: name,
      nodes: d.meta.stats.nodeCount,
      texts: d.meta.stats.textCount,
      warnings: d.meta.warnings.length,
      bytes: d.meta.stats.bytes,
    });
  }
  mkdirSync(join(repo, 'test-results'), { recursive: true });
  writeFileSync(
    join(repo, 'test-results/r2-fixture-captures.json'),
    JSON.stringify(summary, null, 2),
  );
  await page.close();
});

test.describe('Tier 3 screenshot crops (test build with all-sites access granted at install)', () => {
  let h: ExtensionHarness;
  let dir: string;
  test.beforeAll(async () => {
    // Same bundle; only the manifest differs: <all_urls> granted at install, which (like the activeTab grant of
    // a real toolbar click) lets the service worker call captureVisibleTab.
    dir = join(repo, 'test-results/ext-all-sites');
    rmSync(dir, { recursive: true, force: true });
    cpSync(VARIANTS.rebuilt.extension, dir, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.host_permissions = ['<all_urls>'];
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    h = await launchWithExtension(dir);
  });
  test.afterAll(async () => {
    await h?.close();
  });

  test('tainted canvas is cropped from a screenshot; other-site images are fetched; scroll restored', async () => {
    const target = await h.context.newPage();
    await target.setViewportSize({ width: 1280, height: 800 });
    await target.goto(`${fixtures.origins.main}/pages/images-cross-origin.html`, {
      waitUntil: 'networkidle',
    });
    await target.evaluate(() => scrollTo(0, 40));
    const domBefore = await target.evaluate(() => document.documentElement.outerHTML);
    const popup = await openPopupFor(h, target);
    await popup.locator('#capture').click();
    await expect(popup.locator('#done')).toBeVisible({ timeout: 60_000 });
    await popup.evaluate(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      navigator.clipboard.writeText = async (t: string) => void w.__copied.push(t);
    });
    await popup.locator('#copy').click();
    await expect
      .poll(() =>
        popup.evaluate(() => (window as unknown as { __copied: string[] }).__copied.length),
      )
      .toBe(1);
    const doc = JSON.parse(
      await popup.evaluate(() => (window as unknown as { __copied: string[] }).__copied[0]!),
    ) as CaptureDocument;
    expect(validateCapture(doc).ok).toBe(true);
    const flat: CaptureNode[] = [];
    const walk = (n: CaptureNode) => {
      flat.push(n);
      if (n.type === 'FRAME') n.children.forEach(walk);
    };
    walk(doc.root);
    const source = (name: RegExp) => {
      const n = flat.find((x) => x.type === 'IMAGE' && name.test(x.domPath ?? x.name)) as
        { assetId: string | null } | undefined;
      return n?.assetId ? doc.assets.images[n.assetId]!.source : null;
    };
    expect(source(/canvas#tainted/)).toBe('screenshot');
    const crop = flat.find((x) => x.type === 'IMAGE' && /canvas#tainted/.test(x.domPath ?? '')) as {
      assetId: string;
    };
    writeFileSync(
      join(repo, 'test-results/tier3-tainted-canvas.png'),
      Buffer.from(doc.assets.images[crop.assetId]!.data, 'base64'),
    );
    const sources = Object.values(doc.assets.images).map((a) => a.source);
    expect(sources.filter((s) => s === 'fetch').length).toBeGreaterThanOrEqual(1);
    await expect(popup.locator('#imagesNote')).toBeHidden(); // all-sites access already granted
    expect(await target.evaluate(() => document.documentElement.outerHTML)).toBe(domBefore);
    expect(await target.evaluate(() => [scrollX, scrollY])).toEqual([0, 40]);
    // Evidence for review (Playwright scrolls the element into view, so after the scroll check).
    await target
      .locator('#tainted')
      .screenshot({ path: join(repo, 'test-results/tier3-tainted-canvas.page.png') });
    await popup.close();
    await target.close();
  });

  test('mid-scroll capture: tall canvas stitched under the hidden fixed header, blended block as a picture, page untouched (EXT-T-9, AC-EXT-7, EXT-I-4, EXT-V-10)', async () => {
    const target = await h.context.newPage();
    await target.setViewportSize({ width: 1280, height: 800 });
    await target.goto(`${fixtures.origins.main}/pages/page-effects.html`, {
      waitUntil: 'networkidle',
    });
    await target.waitForFunction(
      () => (document.getElementById('tall') as HTMLCanvasElement).dataset.tainted,
    );
    await target.evaluate(() => scrollTo(0, 1500));
    await target.waitForFunction(() => document.body.classList.contains('scrolled'));
    const domBefore = await target.evaluate(() => document.documentElement.outerHTML);
    const popup = await openPopupFor(h, target);
    await popup.locator('#capture').click();
    await expect(popup.locator('#done')).toBeVisible({ timeout: 90_000 });
    await popup.evaluate(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      navigator.clipboard.writeText = async (t: string) => void w.__copied.push(t);
    });
    await popup.locator('#copy').click();
    await expect
      .poll(() =>
        popup.evaluate(() => (window as unknown as { __copied: string[] }).__copied.length),
      )
      .toBe(1);
    const doc = JSON.parse(
      await popup.evaluate(() => (window as unknown as { __copied: string[] }).__copied[0]!),
    ) as CaptureDocument;
    expect(validateCapture(doc).ok).toBe(true);
    const flat: CaptureNode[] = [];
    const walk = (n: CaptureNode) => {
      flat.push(n);
      if (n.type === 'FRAME') n.children.forEach(walk);
    };
    walk(doc.root);
    const image = (re: RegExp) => {
      const n = flat.find(
        (x) => x.type === 'IMAGE' && (re.test(x.name) || re.test(x.domPath ?? '')),
      ) as { assetId: string | null; rect: { width: number; height: number } } | undefined;
      return n?.assetId ? { node: n, asset: doc.assets.images[n.assetId]! } : null;
    };
    /** RGB at fractional positions of an encoded asset, read in the browser. */
    const pixels = (a: { mime: string; data: string }, points: [number, number][]) =>
      target.evaluate(
        async ([src, pts]) => {
          const i = new Image();
          i.src = src;
          await i.decode();
          const c = new OffscreenCanvas(i.width, i.height);
          const g = c.getContext('2d')!;
          g.drawImage(i, 0, 0);
          return pts.map(([fx, fy]) =>
            Array.from(
              g.getImageData(Math.floor(fx * (i.width - 1)), Math.floor(fy * (i.height - 1)), 1, 1)
                .data,
            ).slice(0, 3),
          );
        },
        [`data:${a.mime};base64,${a.data}`, points] as const,
      );
    const near = (rgb: number[], want: number[]) =>
      rgb.every((v, k) => Math.abs(v - want[k]!) <= 24);

    // Header at the top of the capture although the user had scrolled to 1500.
    expect(flat.find((n) => /header#top-header/.test(n.domPath ?? ''))!.rect.y).toBe(0);

    // 1200 px canvas (taller than the 800 px window): stitched from two screenshots, nothing covering it.
    const tall = image(/canvas#tall/);
    expect(tall?.asset.source).toBe('screenshot');
    const ratio = tall!.asset.height / tall!.asset.width;
    expect(ratio).toBeGreaterThan(1.95);
    expect(ratio).toBeLessThan(2.05);
    const [top, upper, lower, bottom] = await pixels(tall!.asset, [
      [0.5, 0.01], // where the fixed header and the scroll bar would have been
      [0.5, 0.45],
      [0.5, 0.55],
      [0.5, 0.99],
    ]);
    for (const p of [top!, upper!]) expect(near(p, [0, 200, 0]), `green, got ${p}`).toBe(true);
    for (const p of [lower!, bottom!]) expect(near(p, [0, 0, 220]), `blue, got ${p}`).toBe(true);
    writeFileSync(
      join(repo, 'test-results/tier3-stitched-canvas.png'),
      Buffer.from(tall!.asset.data, 'base64'),
    );

    // mix-blend-mode block: one picture of what the page shows (white box, brown letters).
    const blended = image(/· blended$/);
    expect(blended?.asset.source).toBe('screenshot');
    const [bg] = await pixels(blended!.asset, [[0.97, 0.5]]);
    expect(near(bg!, [255, 255, 255]), `white, got ${bg}`).toBe(true);
    expect(doc.meta.warnings.map((w) => w.code)).toContain('BLEND_MODE_RASTERIZED');

    // Page untouched: scroll position, DOM (once the page's own scroll listener ran) and style sheets.
    expect(await target.evaluate(() => [scrollX, scrollY])).toEqual([0, 1500]);
    await target.waitForFunction(() => document.body.classList.contains('scrolled'));
    expect(await target.evaluate(() => document.documentElement.outerHTML)).toBe(domBefore);
    expect(await target.evaluate(() => document.adoptedStyleSheets.length)).toBe(0);
    await popup.close();
    await target.close();
  });
});
