/**
 * Figma plugin UI (dist/ui.html) in real Chromium, embedded in an iframe whose parent plays Figma's main thread.
 * Runs for BOTH the rebuilt and the recovered reference build.
 * Verification level: BROWSER INTEGRATION of the UI only. Figma's own iframe host and the main thread are NOT
 * exercised here (main thread: Figma-mock tier; real Figma: R5).
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { kitchenSink } from '../packages/schema/test/samples.ts';
import { VARIANTS, type Variant } from './helpers.ts';

async function mountUi(page: Page, uiPath: string) {
  await page.setContent(
    '<!doctype html><html><body><iframe id="ui" style="width:420px;height:560px"></iframe></body></html>',
  );
  await page.evaluate(
    (html) => {
      (window as unknown as { __fromUi: unknown[] }).__fromUi = [];
      window.addEventListener('message', (e) =>
        (window as unknown as { __fromUi: unknown[] }).__fromUi.push(e.data),
      );
      (document.getElementById('ui') as HTMLIFrameElement).srcdoc = html;
    },
    readFileSync(uiPath, 'utf8'),
  );
  const ui = page.frameLocator('#ui');
  await expect(ui.locator('#drop')).toBeVisible();
  return ui;
}

const fromUi = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fromUi: unknown[] }).__fromUi);
const toUi = (page: Page, msg: unknown) =>
  page.evaluate(
    (m) =>
      (document.getElementById('ui') as HTMLIFrameElement).contentWindow!.postMessage(
        { pluginMessage: m },
        '*',
      ),
    msg,
  );

for (const variant of Object.keys(VARIANTS) as Variant[]) {
  test.describe(`plugin UI [${variant}]`, () => {
    test('file import → preview → Render posts the document to main → report shown', async ({
      page,
    }) => {
      const ui = await mountUi(page, VARIANTS[variant].pluginUi);
      const doc = kitchenSink();
      await ui.locator('#file').setInputFiles({
        name: 'capture.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(doc)),
      });
      await expect(ui.locator('#preview')).toBeVisible();
      await expect(ui.locator('#pvTitle')).toHaveText('Boxes');
      const stats = await ui.locator('#pvStats').innerText();
      expect(stats).toContain('1280 × 2000');
      expect(stats).toContain('RTL · ar');
      expect(stats).toContain('6 · 1 · 1');
      expect(stats).toContain('1.0.0');

      await ui.locator('#render').click();
      await expect(ui.locator('#status')).toHaveText('Rendering…');
      await expect
        .poll(() => fromUi(page))
        .toEqual([{ pluginMessage: { type: 'render', document: doc } }]);

      await toUi(page, {
        type: 'rendered',
        report: { rootName: 'Root', layersCreated: 1, layersFailed: [], durationMs: 5 },
      });
      await expect(ui.locator('#status')).toHaveText('Created "Root": 1 layer(s), 0 failed, 5 ms.');
    });

    test('paste path: invalid JSON, unsupported major version, then a valid document', async ({
      page,
    }) => {
      const ui = await mountUi(page, VARIANTS[variant].pluginUi);
      await ui.locator('summary').click();

      await ui.locator('#paste').fill('{"schemaVersion": "1.0');
      await ui.locator('#parsePaste').click();
      await expect(ui.locator('#errors')).toContainText('File is not valid JSON');

      await ui.locator('#paste').fill(JSON.stringify({ ...kitchenSink(), schemaVersion: '2.0.0' }));
      await ui.locator('#parsePaste').click();
      await expect(ui.locator('#errors')).toContainText('This version supports v1.x');
      await expect(ui.locator('#status')).toHaveText('Pasted JSON is not a valid capture.');

      const broken = kitchenSink();
      broken.assets.images = {};
      await ui.locator('#paste').fill(JSON.stringify(broken));
      await ui.locator('#parsePaste').click();
      await expect(ui.locator('#errors')).toContainText('asset "a1" is not in assets.images');

      await ui.locator('#paste').fill(JSON.stringify(kitchenSink()));
      await ui.locator('#parsePaste').click();
      await expect(ui.locator('#preview')).toBeVisible();
      await expect(ui.locator('#errors')).toBeHidden();

      await ui.locator('#reset').click();
      await expect(ui.locator('#load')).toBeVisible();
      expect(await fromUi(page)).toEqual([]); // nothing is sent to main without Render
    });

    test('main-thread error message is displayed', async ({ page }) => {
      const ui = await mountUi(page, VARIANTS[variant].pluginUi);
      await toUi(page, { type: 'error', message: 'boom' });
      await expect(ui.locator('#errors')).toHaveText(/boom\s+at \//);
    });
  });
}
