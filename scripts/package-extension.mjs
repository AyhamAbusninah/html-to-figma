#!/usr/bin/env node
/**
 * Packages the built Chrome extension (packages/extension/dist) for manual installation:
 *   release/html-to-figma-extension-<version>/        unpacked directory ("Load unpacked")
 *   release/html-to-figma-extension-<version>.zip     the same files only, reproducible
 *   release/html-to-figma-extension-<version>.sha256  checksum of the zip
 *   release/BUILD-INFO.json                           version, source commit, file hashes
 *   release/README-INSTALL.md                         installation guide
 * Validates the build first and fails on any problem. Usage: node scripts/package-extension.mjs [--build]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(root, 'packages/extension');
const dist = join(extDir, 'dist');
const releaseDir = join(root, 'release');

/** Files the extension code itself injects/loads by name (not referenced from the manifest). */
const CODE_REFERENCED = ['content.js'];
/** Approved permissions (REQUIREMENTS EXT-P-3/4). Changing these is a reviewed decision, not a build detail. */
const ALLOWED_PERMISSIONS = ['activeTab', 'scripting', 'downloads', 'clipboardWrite'];
const ALLOWED_HOSTS = [
  '*://*.arkantechjo.com/*',
  '*://localhost/*',
  '*://127.0.0.1/*',
  '*://*.localhost/*',
];
const ALLOWED_EXTENSIONS = /\.(js|css|html|json|png)$/;
const FORBIDDEN_IN_CODE = [
  /localhost/,
  /127\.0\.0\.1/,
  /@vite\/client/,
  /import\.meta\.hot/,
  /sourceMappingURL/,
  /ws:\/\//,
];

const errors = [];
const fail = (msg) => errors.push(msg);

if (process.argv.includes('--build')) {
  execFileSync('pnpm', ['--filter', '@h2f/extension', 'build'], { cwd: root, stdio: 'inherit' });
}
if (!existsSync(join(dist, 'manifest.json'))) {
  console.error(
    '[package] packages/extension/dist/manifest.json missing. Run `pnpm build` (or pass --build).',
  );
  process.exit(1);
}

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [relative(dist, p)];
  });
const files = walk(dist).sort();
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(extDir, 'package.json'), 'utf8'));

// ── Manifest checks ───────────────────────────────────────────────────────────────────────────────────────────
if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (manifest.version !== pkg.version)
  fail(`manifest version ${manifest.version} ≠ package.json ${pkg.version}`);
if (manifest.background?.type !== 'module') fail('background must be a module service worker');
const extra = (manifest.permissions ?? []).filter((p) => !ALLOWED_PERMISSIONS.includes(p));
if (extra.length) fail(`unapproved permissions: ${extra.join(', ')}`);
if (JSON.stringify(manifest.host_permissions ?? []) !== JSON.stringify(ALLOWED_HOSTS))
  fail(`host_permissions differ from the approved list`);
if (manifest.optional_host_permissions)
  fail('optional_host_permissions not approved for this release (Tier-2 fetch is R4)');
if (manifest.content_scripts)
  fail('content_scripts must not be declared (inject on demand only, EXT-P-5)');

// ── Every referenced file exists ──────────────────────────────────────────────────────────────────────────────
const referenced = new Set([
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...CODE_REFERENCED,
]);
const popupHtml = readFileSync(join(dist, manifest.action.default_popup), 'utf8');
for (const m of popupHtml.matchAll(/(?:src|href)="\.?\/?([^"]+)"/g)) referenced.add(m[1]);
for (const ref of referenced)
  if (!ref || !existsSync(join(dist, ref))) fail(`referenced file missing: ${ref}`);

// ── Contents hygiene ──────────────────────────────────────────────────────────────────────────────────────────
for (const f of files) {
  if (!ALLOWED_EXTENSIONS.test(f)) fail(`unexpected file type in package: ${f}`);
  if (f.endsWith('.js')) {
    const code = readFileSync(join(dist, f), 'utf8');
    for (const re of FORBIDDEN_IN_CODE) if (re.test(code)) fail(`${f} contains ${re}`);
  }
}
const unreferenced = files.filter((f) => !referenced.has(f) && f !== 'manifest.json');
if (unreferenced.length)
  fail(`files not referenced by manifest/popup/code: ${unreferenced.join(', ')}`);

if (errors.length) {
  for (const e of errors) console.error(`[package] ✗ ${e}`);
  process.exit(1);
}

// ── Write the release ─────────────────────────────────────────────────────────────────────────────────────────
const name = `html-to-figma-extension-${manifest.version}`;
const unpacked = join(releaseDir, name);
const zipPath = join(releaseDir, `${name}.zip`);
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(unpacked, { recursive: true });
cpSync(dist, unpacked, { recursive: true });

// Reproducible zip: fixed timestamps, sorted entries, no extra attributes.
const epoch = new Date('2026-01-01T00:00:00Z');
for (const f of files) utimesSync(join(unpacked, f), epoch, epoch);
execFileSync('zip', ['-q', '-X', '-D', zipPath, ...files], {
  cwd: unpacked,
  env: { ...process.env, TZ: 'UTC' },
});

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const zipSha = sha(zipPath);
writeFileSync(`${zipPath.slice(0, -4)}.sha256`, `${zipSha}  ${name}.zip\n`);
let commit = 'unknown';
let dirty = true;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  dirty =
    execFileSync('git', ['status', '--porcelain', '--', 'packages', 'scripts'], { cwd: root })
      .toString()
      .trim() !== '';
} catch {
  /* not a git checkout */
}
writeFileSync(
  join(releaseDir, 'BUILD-INFO.json'),
  `${JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      sourceCommit: commit,
      sourceDirty: dirty,
      zip: `${name}.zip`,
      zipSha256: zipSha,
      permissions: manifest.permissions,
      hostPermissions: manifest.host_permissions,
      files: Object.fromEntries(files.map((f) => [f, sha(join(unpacked, f))])),
    },
    null,
    2,
  )}\n`,
);
cpSync(join(extDir, 'INSTALL.md'), join(releaseDir, 'README-INSTALL.md'));

console.log(
  `[package] ✓ ${files.length} files validated (manifest, references, permissions, no maps/dev code)`,
);
console.log(`[package] unpacked: ${unpacked}`);
console.log(`[package] zip:      ${zipPath}`);
console.log(`[package] sha256:   ${zipSha}`);
