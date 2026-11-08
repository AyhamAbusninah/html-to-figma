import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
// @ts-expect-error: plain ESM module without type declarations
import { start } from '../fixtures/serve.mjs';

export const repo = join(import.meta.dirname, '..');

/** The rebuilt artifacts and the recovered pre-loss bundles. Both must behave identically. */
export const VARIANTS = {
  rebuilt: {
    extension: join(repo, 'packages/extension/dist'),
    pluginUi: join(repo, 'packages/figma-plugin/dist/ui.html'),
  },
  reference: {
    extension: join(repo, 'recovery/2026-11-08/extension-dist'),
    pluginUi: join(repo, 'recovery/2026-11-08/figma-plugin-dist/ui.html'),
  },
} as const;
export type Variant = keyof typeof VARIANTS;

export interface FixtureServer {
  origins: { main: string; second: string; third: string | null };
  close(): Promise<void>;
}

export async function startFixtures(): Promise<FixtureServer> {
  return (await start({ quiet: true, ports: { main: 0, second: 0, third: 0 } })) as FixtureServer;
}

export interface ExtensionHarness {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  close(): Promise<void>;
}

/** Launches Chromium with the unpacked extension loaded (persistent profile in a temp dir). */
export async function launchWithExtension(extensionDir: string): Promise<ExtensionHarness> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'h2f-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(serviceWorker.url()).host;
  return {
    context,
    serviceWorker,
    extensionId,
    async close() {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}
