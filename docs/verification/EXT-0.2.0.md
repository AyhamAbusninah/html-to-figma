# Extension 0.2.0: installable package report

| | |
|---|---|
| Date | 2026-11-08 |
| Scope | Make the existing extension installable and testable on Fedora Chrome. **No new capture features**, no R4, no schema change, no backend. |
| Package | `release/html-to-figma-extension-0.2.0/` (unpacked) and `release/html-to-figma-extension-0.2.0.zip` (+ `.sha256`, `BUILD-INFO.json`, `README-INSTALL.md`). Also uploaded by CI as artifact **html-to-figma-extension**. |
| Build | `pnpm install --frozen-lockfile && node scripts/package-extension.mjs --build`. Reproducible: two clean builds gave a byte-identical ZIP. |

## 1. Audit findings and changes

| Item | Finding | Action |
|---|---|---|
| Manifest V3 | Valid: module service worker, popup action, `minimum_chrome_version` 120, no `content_scripts` | Kept |
| `storage` permission | **Unused** (no `chrome.storage` calls) | **Removed** |
| `optional_host_permissions: <all_urls>` | **Unused** (only the Tier-2 image fetch would need it, which is R4) | **Removed until R4** (REQUIREMENTS EXT-P-3a) |
| `clipboardWrite` | Used by Copy. Experiment without it was **inconclusive**: headless Chromium never resolves the clipboard write without a browser-level grant, even WITH the permission | **Kept** (approved). Copy now times out with a clear message instead of hanging |
| Host permissions | Approved allow-list (`*.arkantechjo.com`, localhost dev hosts, R-1). Real websites work through `activeTab` (granted when the user clicks the icon) | Kept, justified in INSTALL.md |
| Content script | Injected on demand via `chrome.scripting` only; `content.js` exists in the package | Kept |
| Service worker | Message router only; no network | Kept |
| Icons | **Missing** (Chrome showed a generic tile) | Added 16/32/48/128 px icons (`packages/extension/scripts/make-icons.sh`) |
| Dev-server / localhost / secrets | None in built JS: no source maps, no Vite client, no hardcoded URLs, no tokens | Enforced by the package validator |
| Popup errors | Raw Chrome errors (e.g. local files) shown verbatim | Actionable messages + "Technical details" (`friendlyError`) |
| Download | No confirmation | "Saved to your Downloads folder as …" once Chrome reports completion; failure explained |
| Unsupported content | Only a warning count | "Not captured yet" summary (e.g. "6 × SVG icons/graphics (placeholders)") |
| Restricted pages | Chrome hides the URL of tabs the extension may not read, so local files looked like chrome:// pages | Message covers both cases, including how to allow file access |

Package validator (`scripts/package-extension.mjs`) fails the build on: wrong manifest version, version mismatch, unapproved permissions or host permissions, `content_scripts`, any missing referenced file (manifest, popup HTML, `content.js`), unreferenced or unexpected files, source maps, or dev-server/localhost strings in JS. Negative checks verified (stray `.map`, extra `tabs` permission, optional host permission → all rejected).

Package contents (10 files): `manifest.json`, `popup.html`, `assets/popup-*.js`, `assets/popup-*.css`, `service-worker.js`, `content.js`, `icons/icon-{16,32,48,128}.png`.

## 2. Production-artifact tests (`e2e/production-artifact.spec.ts`)

The **ZIP** is unzipped into a fresh folder and loaded as an unpacked extension in Playwright's Chrome for Testing 156. Level: **BROWSER INTEGRATION**.

| Test | Result |
|---|---|
| Extension loads: name, version 0.2.0, enabled, development install, exactly the 4 permissions, all icons, service worker answers | ✅ |
| Capture → Done → Download → valid CaptureDocument, page DOM unchanged, no popup console errors: boxes, forms, rtl-arabic, dashboard, landing-page | ✅ 5/5 |
| Password value masked in the downloaded file (`•` × length, raw value absent) | ✅ |
| Restricted pages (chrome://version, local file without file access): capture disabled with explanation | ✅ 2/2 |
| Frappe/ERPNext (local bench): Workspace + Sales Invoice list as EN and AR user → valid JSON, correct direction, DOM unchanged | ✅ (local only, skipped in CI) |
| **Chrome restart** with the same profile and unpacked folder: still enabled and capturing | ✅ |

Full pipeline `pnpm run verify` (clean state): 152/152 unit + 37/37 browser tests, exit 0.

**Not automatable here:** branded Google Chrome 157 (installed on this machine) refuses command-line extension loading, even with `--disable-features=DisableLoadExtensionCommandLineSwitch` (verified). Installing into the real Chrome via *Load unpacked*, and the real toolbar-icon click (`activeTab`), are covered by the manual procedure below. The tests open the popup as a tab and rely on the localhost host permission instead of `activeTab`.

Popup screenshots (release build): `ext-0.2.0/popup-1-ready.png`, `popup-2-done.png`, `popup-3-restricted.png`.

## 3. Manual test procedure (Fedora, Google Chrome)

1. Install: see `release/README-INSTALL.md` (chrome://extensions → Developer mode → Load unpacked → select the folder).
2. Check the card: "HTML to Figma (H2F) 0.2.0", no "Errors" button. Pin the icon.
3. **Public site:** open e.g. `https://en.wikipedia.org/wiki/Figma_(software)`, click the icon → **Capture page** →
   expect "Capture complete", stats, and "Not captured yet" (images/SVG). **Download JSON** → expect "Saved to your
   Downloads folder as figma-capture_en.wikipedia.org_….json".
4. **Company site / Frappe:** open an internal page you're logged into and repeat. The file must open in a text
   editor and start with `{"schemaVersion":"1.0.0"`.
5. **Password masking:** on any login form, type a password (don't submit), capture, and search the downloaded file for
   the password. It must not be there; you'll see `•••`.
6. **Page untouched:** after capturing, the page must look and behave exactly as before.
7. **Restricted:** open `chrome://settings` and click the icon. The capture button is disabled with an explanation.
8. **Restart:** quit Chrome completely, start it again, and repeat step 3.
9. **Validate a file (optional):** the Figma plugin UI validates on import. On Fedora you can check validity with
   `node -e "import('./packages/schema/src/index.ts').then(m=>console.log(m.validateCapture(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))).ok))" ~/Downloads/figma-capture_*.json`
   (from the repo, Node ≥ 22.18).
10. **Figma:** importing requires the Figma desktop app on macOS/Windows (B-1). Not possible on Fedora.

## 4. Known limitations

- Images, SVG, canvas, video, and iframes are placeholders. Gradients, background images, pseudo-elements, and "…" truncation aren't captured (all listed per capture).
- "Warnings" in the stats counts warning *entries*, while "Not captured yet" counts *occurrences*. This is a minor wording nit.
- Real-site capture via the toolbar click (`activeTab`) is verified only manually. Automated tests use the host allow-list.
- The plugin has never run in real Figma (B-1). The distribution channel is unresolved (B-2). Arabic/RTL in Figma is unverified (S4 deferred).
- Developer-mode extensions show Chrome's "Disable developer mode extensions" reminder on some setups. That's expected for unpacked internal tools.
