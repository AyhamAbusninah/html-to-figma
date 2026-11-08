/**
 * Tests the PRODUCTION ARTIFACT: release/html-to-figma-extension-<version>.zip, unzipped into a fresh directory
 * and loaded into Chromium exactly as a user would load it (unpacked). Not the dev build, not the source.
 *
 * Verification level: BROWSER INTEGRATION in Playwright's Chrome for Testing. Branded Google Chrome (137+) refuses
 * command-line extension loading, so installing into the user's own Chrome stays a manual step (INSTALL.md).
 * Run `node scripts/package-extension.mjs --build` first (part of `pnpm run verify`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { validateCapture, type CaptureDocument } from '../packages/schema/src/index.ts';
import { repo, startFixtures, type FixtureServer } from './helpers.ts';

const VERSION = JSON.parse(readFileSync(join(repo, 'packages/extension/package.json'), 'utf8'))
  .version as string;
const ZIP = join(repo, `release/html-to-figma-extension-${VERSION}.zip`);

let fixtures: FixtureServer;
let extDir: string;
let profileDir: string;
let context: BrowserContext;
let extensionId: string;

async function launch(): Promise<void> {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(sw.url()).host;
}

test.beforeAll(async () => {
  test.skip(!existsSync(ZIP), `${ZIP} missing. Run node scripts/package-extension.mjs --build`);
  extDir = mkdtempSync(join(tmpdir(), 'h2f-artifact-'));
  execFileSync('unzip', ['-q', ZIP, '-d', extDir]);
  profileDir = mkdtempSync(join(tmpdir(), 'h2f-profile-'));
  fixtures = await startFixtures();
  await launch();
});

test.afterAll(async () => {
  await context?.close();
  await fixtures?.close();
  for (const d of [extDir, profileDir]) if (d) rmSync(d, { recursive: true, force: true });
});

async function openPopupFor(target: Page): Promise<Page> {
  const popup = await context.newPage();
  const errors: string[] = [];
  popup.on('pageerror', (e) => errors.push(e.message));
  popup.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate(async (u) => {
    const self = await chrome.tabs.getCurrent();
    const [tab] = (await chrome.tabs.query({})).filter((t) => t.url === u);
    await chrome.tabs.move(tab!.id!, { windowId: self!.windowId, index: -1 });
    await chrome.tabs.update(tab!.id!, { active: true });
  }, target.url());
  await popup.reload();
  (popup as Page & { __errors?: string[] }).__errors = errors;
  return popup;
}

/**
 * Opens `url` in a new tab created by the extension itself (so the tab id is known even when Chrome hides the URL of
 * pages the extension may not access), makes it the active tab, then (re)opens the popup for it.
 */
async function openPopupForNewTab(url: string): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate(async (u) => {
    const self = await chrome.tabs.getCurrent();
    const tab = await chrome.tabs.create({ url: u, windowId: self!.windowId, active: false });
    await new Promise((r) => setTimeout(r, 500));
    await chrome.tabs.update(tab.id!, { active: true });
  }, url);
  await popup.reload();
  return popup;
}

/** Full user flow on a page: popup → Capture → Done → Download → returns the downloaded document. */
async function captureAndDownload(target: Page) {
  const popup = await openPopupFor(target);
  await expect(popup.locator('#capture')).toBeEnabled();
  await popup.locator('#capture').click();
  await popup.waitForFunction(
    () => !document.getElementById('done')!.hidden || !document.getElementById('error')!.hidden,
  );
  if (await popup.locator('#error').isVisible())
    throw new Error(`capture failed: ${await popup.locator('#errorText').textContent()}`);
  await expect(popup.locator('#doneTitle')).toHaveText(/Capture complete/);
  const [download] = await Promise.all([
    popup.waitForEvent('download'),
    popup.locator('#download').click(),
  ]);
  await expect(popup.locator('#downloadNote')).toHaveText(
    /^Saved to your Downloads folder as figma-capture_[^ ]+_\d{8}-\d{6}\.json$/,
  );
  const doc = JSON.parse(readFileSync((await download.path())!, 'utf8')) as CaptureDocument;
  const errors = (popup as Page & { __errors?: string[] }).__errors ?? [];
  return { popup, doc, errors };
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let t = setTimeout(done, 1000);
        const o = new MutationObserver(() => {
          clearTimeout(t);
          t = setTimeout(done, 1000);
        });
        o.observe(document, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        setTimeout(done, 15000);
        function done() {
          o.disconnect();
          resolve();
        }
      }),
  );
}

test('the packaged extension loads: name, version, enabled, icons, service worker', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const self = await page.evaluate(() => chrome.management.getSelf());
  expect(self).toMatchObject({
    name: 'HTML to Figma (H2F)',
    version: VERSION,
    enabled: true,
    installType: 'development',
    type: 'extension',
  });
  expect(self.permissions.sort()).toEqual([
    'activeTab',
    'clipboardWrite',
    'downloads',
    'scripting',
  ]);
  for (const size of [16, 32, 48, 128]) {
    const res = await page.request
      .get(`chrome-extension://${extensionId}/icons/icon-${size}.png`)
      .catch(() => null);
    // The request API can't fetch chrome-extension:// URLs; fall back to an <img> load in the extension page.
    const ok = res
      ? res.ok()
      : await page.evaluate(
          (s) =>
            new Promise((r) => {
              const img = new Image();
              img.onload = () => r(img.naturalWidth === s);
              img.onerror = () => r(false);
              img.src = `icons/icon-${s}.png`;
            }),
          size,
        );
    expect(ok, `icon ${size}`).toBe(true);
  }
  expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'h2f:ping' }))).toEqual({
    ok: true,
    type: 'h2f:pong',
    version: VERSION,
  });
  await page.close();
});

for (const name of [
  'boxes.html',
  'forms.html',
  'rtl-arabic.html',
  'dashboard.html',
  'landing-page.html',
]) {
  test(`capture → download → valid JSON, page unchanged: ${name}`, async () => {
    const target = await context.newPage();
    await target.goto(`${fixtures.origins.main}/pages/${name}`, { waitUntil: 'networkidle' });
    await settle(target);
    const before = await target.evaluate(() => document.documentElement.outerHTML);
    const { popup, doc, errors } = await captureAndDownload(target);
    expect(
      await target.evaluate(() => document.documentElement.outerHTML),
      'page DOM changed',
    ).toBe(before);
    const v = validateCapture(doc);
    expect(v.ok, JSON.stringify(!v.ok && v.errors)).toBe(true);
    expect(doc.meta.extractorVersion).toBe(VERSION);
    expect(doc.meta.stats.nodeCount).toBeGreaterThan(20);
    expect(JSON.stringify(doc)).not.toContain('secret-password-123');
    if (doc.meta.warnings.length) await expect(popup.locator('#notCaptured')).toBeVisible();
    expect(errors, 'popup console errors').toEqual([]);
    await popup.close();
    await target.close();
  });
}

test('password values are masked in the downloaded file (forms.html)', async () => {
  const target = await context.newPage();
  await target.goto(`${fixtures.origins.main}/pages/forms.html`, { waitUntil: 'networkidle' });
  const length = await target.evaluate(
    () => (document.querySelector('input[type=password]') as HTMLInputElement).value.length,
  );
  const { popup, doc } = await captureAndDownload(target);
  const json = JSON.stringify(doc);
  expect(json).not.toContain('secret-password-123');
  expect(json).toContain('•'.repeat(length));
  await popup.close();
  await target.close();
});

for (const [label, url] of [
  ['chrome://version', 'chrome://version'],
  ['local file without file access', pathToFileURL(join(repo, 'fixtures/pages/boxes.html')).href],
]) {
  test(`restricted page (${label}): capture disabled with an explanation`, async () => {
    const popup = await openPopupForNewTab(url);
    await expect(popup.locator('#capture')).toBeDisabled();
    await expect(popup.locator('#restricted')).toBeVisible();
    // Chrome hides these URLs from the extension, so the message covers both cases (incl. file access).
    await expect(popup.locator('#restricted')).toContainText("can't be captured");
    await expect(popup.locator('#restricted')).toContainText('Allow access to file URLs');
    await popup.close();
  });
}

test('Frappe/ERPNext pages (local bench only): capture → valid JSON', async () => {
  const base = process.env.H2F_FRAPPE_URL ?? 'http://127.0.0.1:8085';
  const up = await fetch(`${base}/api/method/ping`).then(
    (r) => r.ok,
    () => false,
  );
  test.skip(!up, `Frappe bench not reachable at ${base}`);
  for (const [user, pwd] of [
    ['bench-en@example.com', 'H2f-bench-EN-2026'],
    ['bench-ar@example.com', 'H2f-bench-AR-2026'],
  ] as const) {
    await context.clearCookies();
    expect(
      (await context.request.post(`${base}/api/method/login`, { data: { usr: user, pwd } })).ok(),
    ).toBe(true);
    for (const path of ['/app/accounting', '/app/sales-invoice']) {
      const target = await context.newPage();
      await target.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      await settle(target);
      const before = await target.evaluate(() => document.documentElement.outerHTML);
      const { popup, doc } = await captureAndDownload(target);
      expect(
        await target.evaluate(() => document.documentElement.outerHTML),
        `${user} ${path}: DOM changed`,
      ).toBe(before);
      expect(validateCapture(doc).ok, `${user} ${path}`).toBe(true);
      expect(doc.meta.direction).toBe(user.startsWith('bench-ar') ? 'rtl' : 'ltr');
      expect(doc.meta.stats.textCount).toBeGreaterThan(30);
      await popup.close();
      await target.close();
    }
  }
});

test('still works after Chrome restarts (same profile)', async () => {
  await context.close();
  await launch(); // same profile directory, same unpacked extension folder
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  expect(
    await page.evaluate(() => chrome.management.getSelf().then((s) => [s.enabled, s.version])),
  ).toEqual([true, VERSION]);
  await page.close();
  const target = await context.newPage();
  await target.goto(`${fixtures.origins.main}/pages/typography.html`, { waitUntil: 'networkidle' });
  const { popup, doc } = await captureAndDownload(target);
  expect(validateCapture(doc).ok).toBe(true);
  await popup.close();
  await target.close();
});
