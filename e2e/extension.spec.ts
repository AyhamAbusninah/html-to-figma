/**
 * Extension skeleton in real Chromium, for BOTH the rebuilt build and the recovered reference build.
 * Verification level: BROWSER INTEGRATION.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { validateCapture, type CaptureDocument } from '../packages/schema/src/index.ts';
import {
  launchWithExtension,
  repo,
  startFixtures,
  VARIANTS,
  type ExtensionHarness,
  type FixtureServer,
  type Variant,
} from './helpers.ts';

/** The reference build is the R0-recovered 0.1.0; the rebuilt extension is 0.3.0 (R2 capture, OQ-11 line split, Copy to Figma). */
const VERSION: Record<Variant, string> = { rebuilt: '0.3.0', reference: '0.1.0' };

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

    test('service worker answers ping and reports Tier-2 fetch as not implemented', async () => {
      const page = await h.context.newPage();
      await page.goto(`chrome-extension://${h.extensionId}/popup.html`);
      const [pong, fetchAsset] = await page.evaluate(async () => [
        await chrome.runtime.sendMessage({ type: 'h2f:ping' }),
        await chrome.runtime.sendMessage({ type: 'h2f:fetch-asset', url: 'https://x/y.png' }),
      ]);
      expect(pong).toEqual({ ok: true, type: 'h2f:pong', version: VERSION[variant] });
      expect(fetchAsset).toEqual({
        ok: false,
        error: 'Tier-2 asset fetch is not implemented yet (P4)',
      });
      await page.close();
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
            const texts = [...xml.querySelectorAll('text')];
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
