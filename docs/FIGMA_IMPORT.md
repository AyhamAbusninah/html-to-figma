# From capture JSON to a visible design

Two ways to turn a downloaded `figma-capture_*.json` into something you can see:

| | Local preview (Fedora) | Figma plugin (real Figma) |
|---|---|---|
| Runs on | Any OS with Chrome; opens from disk | **Figma desktop app on macOS/Windows** (development plugin) |
| Result | Browser drawing of the plugin's render plan | Native, editable Figma layers |
| Status | ✅ Working, tested | ⚠ Implemented, **never run in real Figma** (B-1) |

## 1. Local preview on Fedora (no Figma)

```bash
cd ~/Desktop/arkan-tech/tools-for-arkan/html-to-figma
pnpm install --frozen-lockfile        # once
pnpm preview:open                     # builds packages/preview/dist/index.html and opens it in your browser
```

Then click **Open capture JSON…** (or drag the file onto the page) and pick `~/Downloads/figma-capture_….json`.

- **What you see:** the same validation (`validateCapture`) and the same render plan (`buildPlan`) the Figma plugin
  uses, drawn with HTML/CSS at the capture's coordinates (RTL text keeps `dir="rtl"`). Images and SVG are dashed
  placeholders labelled with the reason.
- **Panels:** document info (URL, direction, size, schema), contents (node counts by type), fonts the plugin would
  use and substitutions, every capture warning and anything the plugin can't render yet. Hover a layer to see its
  name, rect, text, and font.
- **Controls:** zoom − / + / Fit / 100% (keys `-` `+` `F` `0`, or Ctrl+wheel); drag to pan; toggle placeholder
  labels and frame outlines.
- **Read-only:** the file is only read. Nothing is uploaded and no server is involved (the page itself fetches the
  web fonts from Google Fonts when online).
- **Not Figma:** text layout, bidi, font rendering, blur, and strokes are the browser's. The font list is an assumed
  subset of Figma's, so substitutions shown can be more pessimistic than in Figma, which offers all Google Fonts.

## 2. Figma plugin: what exists (audit, 2026-11-08)

| Step | Implemented in | Verified at |
|---|---|---|
| Plugin UI accepts a local `.json`: file picker, drag-and-drop, paste (≤ 5 MB) | `packages/figma-plugin/src/ui/` | BROWSER INTEGRATION (`e2e/plugin-ui.spec.ts`) |
| Validates against CaptureDocument v1 (`validateCapture`: schema + version gate + ids + asset refs), shows errors or a preview | `ui.ts` → `@h2f/schema` | UNIT + BROWSER |
| **Render** posts `{ type: 'render', document }` to the main thread | `ui.ts` | BROWSER |
| Main thread: `listAvailableFontsAsync` → `buildPlan` (pure) → `executePlan` → select + zoom → report back | `src/main/code.ts`, `src/plan/`, `src/adapter/` | **FIGMA MOCK only** (`main.mock.test.ts`, vertical slice) |
| Creates frames, rectangles, editable text (fonts loaded first), dashed placeholders; per-node failure isolation | `src/adapter/render.ts` | **FIGMA MOCK only** |
| Runs inside real Figma and produces the expected editable nodes | — | ❌ **Not verified** (no macOS/Windows, B-1) |

**Mock-only means:** the calls match the documented Plugin API (`@figma/plugin-typings` 1.142.0: shapes, enums,
font-loading order) and produce the intended node tree in a strict mock. Unverified in real Figma: actual
rendering, text metrics and auto-resize, effects stacking order, per-side strokes with radii, performance on
large documents (e.g. 746 nodes), Arabic shaping/bidi (S4), and the provisional RLM/LRM marks.

No new import mechanism is needed. The plugin already has one; what's missing is a place to run it.

## 3. Exact steps for a real Figma import (macOS or Windows)

Prerequisites: Figma **desktop app** logged in, Node ≥ 22.18 and pnpm (or a prebuilt `packages/figma-plugin/` with
`dist/`).

1. Build the plugin: `pnpm install --frozen-lockfile && pnpm --filter @h2f/figma-plugin build`
   (creates `packages/figma-plugin/dist/code.js` and `dist/ui.html`).
2. In the Figma desktop app, open or create a **draft** design file.
3. Menu → **Plugins → Development → Import plugin from manifest…** → select
   `packages/figma-plugin/manifest.json`. One-time per machine.
4. **Plugins → Development → HTML to Figma (H2F)**.
5. In the plugin window: drop the `figma-capture_….json` (or click to browse). Check the preview (source, size,
   direction, counts) → **Render**.
6. Expected: a new top-level frame "‹title› — ‹host› — ‹date›" right of existing content, selected and zoomed to, and a
   report listing layers created/failed, font substitutions, and placeholders.

**What to record on the first real run** (turns mock-only into REAL FIGMA evidence): Figma version and OS, layers
created/failed from the report, screenshot of the frame next to the page, any console errors (Plugins →
Development → Show/Hide console), and render time. A small fixture capture (`dashboard`, `rtl-arabic`) plus one real
page is enough.

## 4. Remaining requirements before real Figma import is "done"

| ID | Requirement | Status |
|---|---|---|
| B-1 | Access to the Figma desktop app on macOS/Windows (borrowed machine, VM, or rented cloud desktop) | 🔴 open |
| R5 | First real run + results recorded (steps above); fix any API differences found | blocked by B-1 |
| B-2 | Figma plan / private org plugin, so Fedora employees can run it in browser Figma | 🔴 open (publishing also needs B-1) |
| R-5 | Arabic/RTL in Figma (S4-B with `spikes/s4-rtl/`) | deferred |
| Fidelity | Multi-line inline text (paragraphs with links) overlaps, because each DOM text node becomes one box. The preview shows this; Figma would get the same plan | open, see `docs/verification/PREVIEW.md` §4 |
