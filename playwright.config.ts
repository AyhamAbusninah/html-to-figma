/**
 * Browser integration tests (plan §6, tier T2/T4). Real Chromium (Playwright's bundled Chrome for Testing, which,
 * unlike branded Chrome, still honors --load-extension). Runs on Fedora and on Linux CI runners.
 * Verification level: BROWSER INTEGRATION. No Figma involved.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: { headless: true, viewport: { width: 1280, height: 800 } },
});
