# HTML-to-Figma (H2F)

Internal Arkan Tech tool. A Chrome extension captures any web page (public or behind company login) into a
versioned **CaptureDocument** JSON file, and a Figma plugin rebuilds it as native, editable layers.

Product docs: [PRD](PRD.md) · [User flows](USER_FLOWS.md) · [Requirements](REQUIREMENTS.md) ·
[Decisions & open questions](OPEN_QUESTIONS.md) · Phase reports: [`docs/verification/`](docs/verification/)

## Architecture

```
Chrome extension                                       Figma plugin
  collector (DOM reads) → @h2f/core (pure engine) ──CaptureDocument v1 (.json)──▶ UI (import/validate) → main (render)
```

| Package | Role |
|---|---|
| `packages/schema` | The only cross-component contract: TypeBox source → `capture.schema.json`, CSP-safe standalone validators, types. Frozen baselines in `contract/`. |
| `packages/core` | Conversion engine: pure functions, `RawPageSnapshot → CaptureDocument`, no DOM lib. |
| `packages/extension` | Chrome MV3 extension: popup, on-demand content script (collector), service worker. |
| `packages/figma-plugin` | Figma plugin: UI iframe (import, validate, preview) and main thread (render). |
| `packages/preview` | Local CaptureDocument preview for Fedora: the plugin's render plan drawn with HTML/CSS. |
| `fixtures/` | Generic test pages (3-origin server) and the Frappe/ERPNext v15 stress-test bench. |
| `spikes/s4-rtl/` | Spike S4: Arabic/RTL text via the Plugin API. |
| `recovery/2026-11-08/` | Pre-loss build outputs, kept as behavioral references (see `docs/verification/R0.md`). |

## Status (2026-11-10)

**Copy to Figma (extension 0.3.0):** capture a page, click **Copy to Figma**, press Ctrl+V in Figma Web: editable
layers (text, shapes, Arabic/RTL) without the plugin or the desktop app, verified in real Figma Web
([`docs/spikes/FIGMA_CLIPBOARD.md`](docs/spikes/FIGMA_CLIPBOARD.md) §4b). Boxes arrive as shapes in groups (no
auto layout); images and CSS backgrounds are still placeholders.

Architecture map for humans and agents: [`docs/architecture/MAP.html`](docs/architecture/MAP.html) ·
[`ai_architecture_map.yaml`](docs/architecture/ai_architecture_map.yaml) · workflow: [`docs/AI_WORKFLOW.md`](docs/AI_WORKFLOW.md).

Earlier status (2026-11-08):

**MVP vertical slice working (R2):** real page → extension capture → CaptureDocument → plugin import → editable
node tree, verified in Chromium and against a strict Figma API mock on 7 generic pages and 4 Frappe/ERPNext pages
(EN + AR). **Not yet run in real Figma** (no macOS/Windows, OPEN_QUESTIONS B-1). Images/SVG are explicit placeholders
for now. Full supported/unsupported list: [`docs/verification/R2.md`](docs/verification/R2.md).

## See a capture on Fedora (no Figma)

`pnpm preview:open` builds and opens a local preview. Load a downloaded `figma-capture_*.json` to see what the plugin
would create (same validation and render plan, drawn by the browser; not a Figma rendering). Real Figma import steps
and status: [`docs/FIGMA_IMPORT.md`](docs/FIGMA_IMPORT.md).

## Install the extension (Fedora / Chrome)

`node scripts/package-extension.mjs --build` produces `release/html-to-figma-extension-<version>/` (Load unpacked) and a
reproducible ZIP. CI uploads the same ZIP as the **html-to-figma-extension** artifact. Step-by-step guide:
[`packages/extension/INSTALL.md`](packages/extension/INSTALL.md). Release report: [`docs/verification/EXT-0.2.0.md`](docs/verification/EXT-0.2.0.md).

## Commands

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium           # once: browser for integration tests
node fixtures/scripts/fetch-assets.mjs           # once: fixture fonts/icons (not committed)

pnpm run verify    # everything CI runs: schema check, universality guard, typecheck, lint, format, build, tests
pnpm build         # → packages/extension/dist, packages/figma-plugin/dist
pnpm test          # unit + Figma-mock tests (Vitest); run `pnpm build` first
pnpm test:e2e      # browser integration tests (Playwright + real Chromium)
pnpm schema:generate   # after editing packages/schema/src/schema.ts
```

- **Extension:** `chrome://extensions` → Developer mode → *Load unpacked* → `packages/extension/dist`.
- **Plugin:** Figma **desktop app (macOS/Windows only)** → Plugins → Development → *Import plugin from manifest* →
  `packages/figma-plugin/manifest.json`. There's no Linux desktop app, so it can't be run on Fedora (see OPEN_QUESTIONS B-1).

## Verification levels (REQUIREMENTS TST-7)

| Level | Where | Proves |
|---|---|---|
| UNIT | Node / Vitest | pure logic |
| BROWSER INTEGRATION | real Chromium / Playwright | extension and plugin UI behavior in a browser |
| FIGMA MOCK | Node vm + strict API mock | correct Plugin-API usage, **not** rendering |
| REAL FIGMA | Figma desktop (macOS/Windows) or browser Figma with a privately published build | actual rendering |

No Figma feature counts as validated until it passes at REAL FIGMA level.
