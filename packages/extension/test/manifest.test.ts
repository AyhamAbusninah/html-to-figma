/** Manifest and version consistency (EXT-P-1..5, OQ-2). Verification level: UNIT (Node, static files). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTENSION_VERSION } from '../src/config/version.ts';

const pkgDir = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(pkgDir, 'public/manifest.json'), 'utf8')) as Record<
  string,
  unknown
>;
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { version: string };

describe('manifest.json', () => {
  it('is MV3 with a module service worker and a popup', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({ service_worker: 'service-worker.js', type: 'module' });
    expect(manifest.action).toMatchObject({ default_popup: 'popup.html' });
    expect(manifest.minimum_chrome_version).toBe('120');
  });

  it('requests exactly the permissions in EXT-P-3, with no always-on content scripts (EXT-P-5)', () => {
    expect(manifest.permissions).toEqual([
      'activeTab',
      'scripting',
      'downloads',
      'clipboardWrite',
      'storage',
    ]);
    expect(manifest).not.toHaveProperty('content_scripts');
  });

  it('host access: fixed allow-list + optional runtime grant (OQ-2, R-1)', () => {
    expect(manifest.host_permissions).toEqual([
      '*://*.arkantechjo.com/*',
      '*://localhost/*',
      '*://127.0.0.1/*',
      '*://*.localhost/*',
    ]);
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
  });

  it('version is consistent across manifest, package.json and code', () => {
    expect(manifest.version).toBe(EXTENSION_VERSION);
    expect(pkg.version).toBe(EXTENSION_VERSION);
  });
});
