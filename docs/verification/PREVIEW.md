# Local CaptureDocument Preview: report

| | |
|---|---|
| Date | 2026-11-08 |
| Scope | Usability gap: a valid capture JSON can't be seen on Fedora. Audit the plugin import flow, build a local preview, document real-Figma steps. No capture changes, no schema change, extension 0.2.0 untouched. |
| Result | ✅ Preview working and tested. Plugin import flow confirmed implemented (FIGMA MOCK level only). |

## 1. Design: no second engine

```
figma-capture.json ─▶ validateCapture (@h2f/schema, same as plugin UI)
                   ─▶ buildPlan (@h2f/figma-plugin/plan, same pure planner the plugin executes)
                   ─▶ render.ts: RenderPlan → absolutely positioned HTML/CSS   ← only new rendering code
```

Small supporting refactors (no behavior change for the plugin):
- `src/config/known-figma-fonts.ts`: the assumed Figma font list, shared by the mock and the preview.
- `PlanText.direction`: lets the preview set `dir`; the adapter ignores it.
- `build/vite-inline-html.ts`: the single-file HTML inliner, shared. The plugin `ui.html` stays byte-identical
  (verified).

## 2. Tests

| Suite | Level | Result |
|---|---|---|
| `packages/preview/test/render.test.ts`: layers = plan, parent-relative coords, fills/strokes/radii/shadows/blur/opacity/blend, RTL text, escaping, font URLs | UNIT | 7/7 |
| `e2e/preview.spec.ts` on the **built** `dist/index.html` via `file://`, captures from fixtures: **every layer at its capture rect ±0.5 px** (rtl-arabic 157, dashboard 329, forms 74 layers), counts, RTL count, warnings listed, zoom/fit/pan, file unchanged (sha256), invalid JSON / v2 rejected | BROWSER | 6/6 |

Defects found by these tests (fixed): (1) CSS borders shifted children by the border width (CSS positions absolute
children inside the padding box; Figma doesn't), so strokes are now a non-layout overlay. (2) "Fit" kept the old
scroll position, so it now returns to the top-left.

## 3. Evidence with real captures

| File | Nodes / text / images | Preview | File unchanged |
|---|---|---|---|
| Arabic Wikipedia main page (captured with the 0.2.0 content script, 1920 wide; the user's own file wasn't on disk) | 690 / 543 / 68, RTL, 1920 × 3992 | 689 layers, 543 RTL text, 68 placeholders | ✅ |
| User's `figma-capture_www.furatfoodjo.com_…json` | 139 / 62 / 16 img + 14 svg | 138 layers, 30 placeholders | ✅ |
| User's `figma-capture_os.arkantechjo.com_…json` (internal) | 415 / 125 / 2 img + 78 svg | 414 layers, 80 placeholders | ✅ |

Screenshots of these stay **local only** (third-party and internal content) in the session scratchpad. Committed
evidence from our own fixtures: `docs/verification/preview/{rtl-arabic,dashboard}.{page,preview}.png`.

## 4. Main finding: paragraphs with inline elements overlap

On text-heavy pages (Wikipedia), lines of the same paragraph overlap. **Cause (conversion, not preview):** each DOM
text node becomes one TEXT layer whose rect is the bounding box of all its line fragments (OQ-11 option A). A text
node that starts mid-line (after a link or badge) and wraps gets a box spanning the full width. Drawn as one block,
it starts at the box edge and lands on its neighbors. The preview draws the plugin's own plan, so **real Figma would
show the same overlap.**

Proposed fix (engine/collector, needs approval, not done here): for multi-line text nodes, emit one TEXT layer per
line fragment (the collector already has the per-line client rects; it would also need each line's character
range), or implement OQ-11 option B (merge an inline formatting context into one TEXT layer with styled ranges). Per-line
fragments are simpler and positionally exact; option B is better for editing.

## 5. Limitations

- Not a Figma rendering (see the banner in the preview). Fonts: an assumed subset of Figma's list, so substitutions can
  differ from real Figma, which uses the real list.
- Gradients, images, and SVG aren't in the plan yet (placeholders or omitted, as in the plugin).
- Web fonts load from Google Fonts. Offline, the browser falls back to local fonts (layout may shift).
