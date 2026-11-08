/**
 * R2 vertical slice, end to end:
 *   real page in Chromium → extension popup capture → downloaded CaptureDocument (validated) → plugin UI import →
 *   Render → plugin main thread (dist/code.js) against the strict Figma mock → editable node tree → SVG preview.
 *
 * Verification levels: BROWSER INTEGRATION (capture + UI) and FIGMA MOCK (node creation).
 * ⚠ The last step is NOT real Figma (B-1). Previews are browser renderings of what the plugin asked Figma to create.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  validateCapture,
  type CaptureDocument,
  type CaptureNode,
} from '../packages/schema/src/index.ts';
import {
  descendants,
  MockFrame,
  MockText,
  runPluginCode,
} from '../packages/figma-plugin/test/figma-mock.ts';
import { toSvg } from '../packages/figma-plugin/test/preview.ts';
import { withDirectionMark } from '../packages/figma-plugin/src/plan/plan.ts';
import {
  launchWithExtension,
  repo,
  startFixtures,
  type ExtensionHarness,
  type FixtureServer,
} from './helpers.ts';

const OUT = join(repo, 'test-results/vertical-slice');
const EXT = join(repo, 'packages/extension/dist');
const PLUGIN_UI = join(repo, 'packages/figma-plugin/dist/ui.html');
const PLUGIN_CODE = join(repo, 'packages/figma-plugin/dist/code.js');
const PAGES = [
  'boxes.html',
  'typography.html',
  'forms.html',
  'rtl-arabic.html',
  'dashboard.html',
  'landing-page.html',
  'shadow-dom.html',
];

let fixtures: FixtureServer;
let h: ExtensionHarness;
test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  fixtures = await startFixtures();
  h = await launchWithExtension(EXT);
});
test.afterAll(async () => {
  await h?.close();
  await fixtures?.close();
});

async function captureViaPopup(target: Page): Promise<CaptureDocument> {
  const popup = await h.context.newPage();
  await popup.goto(`chrome-extension://${h.extensionId}/popup.html`);
  const url = target.url();
  await popup.evaluate(async (u) => {
    const self = await chrome.tabs.getCurrent();
    const [tab] = (await chrome.tabs.query({})).filter((t) => t.url === u);
    await chrome.tabs.move(tab!.id!, { windowId: self!.windowId, index: -1 });
    await chrome.tabs.update(tab!.id!, { active: true });
  }, url);
  await popup.reload();
  await popup.locator('#capture').click();
  await popup.waitForFunction(
    () => !document.getElementById('done')!.hidden || !document.getElementById('error')!.hidden,
    null,
    { timeout: 30_000 },
  );
  if (await popup.locator('#error').isVisible())
    throw new Error(`capture failed: ${await popup.locator('#errorText').textContent()}`);
  const [download] = await Promise.all([
    popup.waitForEvent('download'),
    popup.locator('#download').click(),
  ]);
  const doc = JSON.parse(readFileSync((await download.path())!, 'utf8')) as CaptureDocument;
  await popup.close();
  return doc;
}

/** Independent measurement in the page: visible text nodes (outside SVG/pre/form controls), doc coordinates. */
function domTextSamples(page: Page) {
  return page.evaluate(() => {
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
    const se = document.scrollingElement!;
    const ox = scrollX + (rtl ? Math.max(0, se.scrollWidth - se.clientWidth) : 0);
    const out: { text: string; rect: { x: number; y: number; width: number; height: number } }[] =
      [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const n = tw.currentNode as Text;
      const p = n.parentElement;
      if (!p || p.closest('svg, textarea, select, option, script, style, noscript')) continue;
      const cs = getComputedStyle(p);
      if (
        cs.visibility !== 'visible' ||
        cs.whiteSpace.startsWith('pre') ||
        cs.whiteSpace === 'break-spaces'
      )
        continue;
      if (!p.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      // Exclude screen-reader-only content (clip rect / clip-path inset / 1px clipping box) on any ancestor.
      let srOnly = false;
      for (let a: Element | null = p; a && !srOnly; a = a.parentElement) {
        const acs = getComputedStyle(a);
        const ar = a.getBoundingClientRect();
        const clipRect = /^rect\(([^)]*)\)$/.exec(acs.clip);
        if (clipRect) {
          const v = clipRect[1]!.split(/[\s,]+/).map((x) => (x === 'auto' ? null : parseFloat(x)));
          const w = (v[1] ?? ar.width) - (v[3] ?? 0);
          const hh = (v[2] ?? ar.height) - (v[0] ?? 0);
          if (w * hh <= 1) srOnly = true;
        }
        if (/^inset\(\s*(5\d|[6-9]\d|100)/.test(acs.clipPath)) srOnly = true;
        if (
          ar.width <= 1 &&
          ar.height <= 1 &&
          /hidden|clip|auto|scroll/.test(acs.overflowX + acs.overflowY)
        )
          srOnly = true;
      }
      if (srOnly) continue;
      const raw = n.nodeValue ?? '';
      const text = raw.replace(/[ \t\n\r\f]+/g, ' ').trim();
      if (!text) continue;
      let s = 0;
      let e = raw.length;
      while (s < e && /\s/.test(raw[s]!)) s++;
      while (e > s && /\s/.test(raw[e - 1]!)) e--;
      const r = document.createRange();
      r.setStart(n, s);
      r.setEnd(n, e);
      const rects = [...r.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
      if (!rects.length) continue;
      const x1 = Math.min(...rects.map((x) => x.left)),
        y1 = Math.min(...rects.map((x) => x.top));
      const x2 = Math.max(...rects.map((x) => x.right)),
        y2 = Math.max(...rects.map((x) => x.bottom));
      out.push({ text, rect: { x: x1 + ox, y: y1 + scrollY, width: x2 - x1, height: y2 - y1 } });
    }
    return out;
  });
}

function textNodes(doc: CaptureDocument) {
  const out: Extract<CaptureNode, { type: 'TEXT' }>[] = [];
  const visit = (n: CaptureNode) => {
    if (n.type === 'TEXT') out.push(n);
    if (n.type === 'FRAME') n.children.forEach(visit);
  };
  visit(doc.root);
  return out;
}

async function renderInPluginUi(page: Page, doc: CaptureDocument): Promise<CaptureDocument> {
  await page.setContent(
    '<!doctype html><iframe id="ui" style="width:420px;height:560px"></iframe>',
  );
  await page.evaluate(
    (html) => {
      (window as unknown as { __fromUi: unknown[] }).__fromUi = [];
      window.addEventListener('message', (e) =>
        (window as unknown as { __fromUi: unknown[] }).__fromUi.push(e.data),
      );
      (document.getElementById('ui') as HTMLIFrameElement).srcdoc = html;
    },
    readFileSync(PLUGIN_UI, 'utf8'),
  );
  const ui = page.frameLocator('#ui');
  await ui.locator('#file').setInputFiles({
    name: 'capture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await expect(ui.locator('#preview')).toBeVisible();
  await ui.locator('#render').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __fromUi: unknown[] }).__fromUi.length))
    .toBe(1);
  const [msg] = (await page.evaluate(
    () => (window as unknown as { __fromUi: unknown[] }).__fromUi,
  )) as {
    pluginMessage: { type: string; document: CaptureDocument };
  }[];
  expect(msg!.pluginMessage.type).toBe('render');
  return msg!.pluginMessage.document;
}

const summary: Record<string, unknown>[] = [];
test.afterAll(() => writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2)));

/**
 * Waits until the page stops mutating itself (e.g. charts animating after load), so "DOM unchanged by capture"
 * compares a settled page. Pages that never settle fail the test instead of passing silently.
 */
async function waitForDomQuiet(page: Page, quietMs = 1000, timeoutMs = 15_000) {
  const settled = await page.evaluate(
    ({ quietMs, timeoutMs }) =>
      new Promise<boolean>((resolve) => {
        let timer = setTimeout(done, quietMs);
        const obs = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(done, quietMs);
        });
        obs.observe(document, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        const deadline = setTimeout(() => {
          obs.disconnect();
          resolve(false);
        }, timeoutMs);
        function done() {
          obs.disconnect();
          clearTimeout(deadline);
          resolve(true);
        }
      }),
    { quietMs, timeoutMs },
  );
  expect(settled, 'page kept mutating itself; DOM-unchanged check would be meaningless').toBe(true);
}

/** The full slice for one page. `name` labels the evidence files. */
async function runSlice(browser: Browser, name: string, url: string) {
  {
    // 1–2. Real page + extension capture via the popup, downloaded as JSON.
    const target = await h.context.newPage();
    await target.setViewportSize({ width: 1280, height: 800 });
    await target.goto(url, { waitUntil: 'networkidle' });
    await target.evaluate(() => document.fonts.ready);
    await waitForDomQuiet(target);
    const domBefore = await target.evaluate(() => document.documentElement.outerHTML);
    const samples = await domTextSamples(target);
    const doc = await captureViaPopup(target);
    // Compare BEFORE taking the screenshot: Playwright's full-page screenshot is test tooling, not the product.
    expect(
      await target.evaluate(() => document.documentElement.outerHTML),
      'page DOM changed by capture',
    ).toBe(domBefore);
    await target.screenshot({ path: join(OUT, `${name}.page.png`), fullPage: true });
    await target.close();

    // 3. Valid CaptureDocument v1.
    const v = validateCapture(doc);
    expect(v.ok, JSON.stringify(!v.ok && v.errors)).toBe(true);
    writeFileSync(join(OUT, `${name}.capture.json`), JSON.stringify(doc, null, 1));

    // 4. Every visible DOM text node is a TEXT node with the same characters and rect (±0.5 px).
    const texts = textNodes(doc);
    const missing = samples.filter(
      (s) =>
        !texts.some(
          (t) =>
            t.characters === s.text &&
            Math.abs(t.rect.x - s.rect.x) <= 0.5 &&
            Math.abs(t.rect.y - s.rect.y) <= 0.5 &&
            Math.abs(t.rect.width - s.rect.width) <= 0.5 &&
            Math.abs(t.rect.height - s.rect.height) <= 0.5,
        ),
    );
    expect(samples.length).toBeGreaterThan(5);
    expect(
      missing.slice(0, 5),
      `${missing.length}/${samples.length} DOM text nodes not matched`,
    ).toEqual([]);
    expect(JSON.stringify(doc)).not.toContain('secret-password-123');

    // 5. Plugin UI: import the file, Render → document posted to the main thread unchanged.
    const uiPage = await browser.newPage();
    const posted = await renderInPluginUi(uiPage, doc);
    expect(posted).toEqual(doc);
    await uiPage.close();

    // 6. Plugin main thread (built bundle) against the strict Figma mock: every node created, none failed.
    const run = runPluginCode(PLUGIN_CODE);
    await run.send({ type: 'render', document: posted });
    const report = (
      run.posted.find((m) => (m as { type: string }).type === 'rendered') as
        { report: Record<string, unknown> } | undefined
    )?.report;
    const error = run.posted.find((m) => (m as { type: string }).type === 'error');
    expect(error, JSON.stringify(error)).toBeUndefined();
    expect(report?.layersFailed).toEqual([]);
    expect(report?.layersCreated).toBe(doc.meta.stats.nodeCount);
    const root = run.page.children.at(-1) as MockFrame;
    const created = descendants(root);
    const createdTexts = created.filter((n) => n instanceof MockText) as MockText[];
    expect(createdTexts.length).toBe(doc.meta.stats.textCount);
    // Exact characters, including the provisional PLG-RTL-2 direction marks the planner adds (unverified in Figma).
    expect(new Set(createdTexts.map((t) => t.characters))).toEqual(
      new Set(texts.map((t) => withDirectionMark(t.characters, t.style.direction))),
    );

    // 7. Preview of the created node tree (browser drawing of the mock tree, NOT a Figma rendering).
    const svg = toSvg(root);
    writeFileSync(join(OUT, `${name}.preview.svg`), svg);
    const pv = await browser.newPage({ viewport: { width: Math.ceil(root.width), height: 800 } });
    await pv.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
    await pv.screenshot({ path: join(OUT, `${name}.preview.png`), fullPage: true });
    await pv.close();

    summary.push({
      page: name,
      bytes: doc.meta.stats.bytes,
      nodes: doc.meta.stats.nodeCount,
      texts: doc.meta.stats.textCount,
      images: doc.meta.stats.imageCount,
      svgs: doc.meta.stats.svgCount,
      domTextNodesMatched: `${samples.length - missing.length}/${samples.length}`,
      warnings: doc.meta.warnings.map((w) => w.code),
      figmaMock: {
        layersCreated: report?.layersCreated,
        layersFailed: (report?.layersFailed as unknown[]).length,
        placeholders: report?.placeholders,
        fontSubstitutions: (report?.fontSubstitutions as unknown[])?.length ?? 0,
      },
    });
  }
}

for (const name of PAGES) {
  test(`vertical slice: ${name}`, async ({ browser }) => {
    await runSlice(browser, name, `${fixtures.origins.main}/pages/${name}`);
  });
}

/**
 * Real-world stress test: Frappe/ERPNext v15 benchmark (fixtures/frappe-bench). Local only: skipped when the bench
 * isn't running (it is not part of CI). Benchmark data lives in fixtures/ (SYS-7). Nothing here is engine logic.
 */
test.describe('vertical slice: Frappe benchmark (local only)', () => {
  const BASE = process.env.H2F_FRAPPE_URL ?? 'http://127.0.0.1:8085';
  const USERS = {
    en: ['bench-en@example.com', 'H2f-bench-EN-2026'],
    ar: ['bench-ar@example.com', 'H2f-bench-AR-2026'],
  } as const;
  const VIEWS = [
    ['workspace', '/app/accounting'],
    ['list', '/app/sales-invoice'],
  ] as const;
  for (const lang of ['en', 'ar'] as const) {
    for (const [view, path] of VIEWS) {
      test(`frappe ${lang} ${view}`, async ({ browser }) => {
        const up = await fetch(`${BASE}/api/method/ping`).then(
          (r) => r.ok,
          () => false,
        );
        test.skip(!up, `Frappe bench not reachable at ${BASE}`);
        await h.context.clearCookies();
        const login = await h.context.request.post(`${BASE}/api/method/login`, {
          data: { usr: USERS[lang][0], pwd: USERS[lang][1] },
        });
        expect(login.ok()).toBe(true);
        await runSlice(browser, `frappe-${lang}-${view}`, `${BASE}${path}`);
      });
    }
  }
});
