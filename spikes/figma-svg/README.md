# Spike Route C: paste an SVG into Figma Web (ISOLATED)

Question: can the extension alone put a page on the clipboard so that **Ctrl+V in Figma Web** gives native,
editable layers, using only Figma's documented SVG import (no plugin, no desktop app, no Figma code, no
reverse-engineered format)? Context and the other routes: `docs/spikes/FIGMA_CLIPBOARD.md`.

- **Isolated:** not in the pnpm workspace, CI, lint or any package. Imports the plugin planner read-only.
- **No second layout engine:** `svg.mjs` serializes the unchanged `buildPlan` output. The only measurements are
  what SVG needs and the plan lacks: font ascent/descent for the baseline, and line breaks of multi-line text
  (the browser lays the text out at the captured width; `measure.mjs`).
- **Arabic/RTL:** two encodings, because which one Figma honors is part of the question:
  A `direction="rtl"` (standard SVG; matches the page in Chromium), B right-to-left marks around LTR text.

| File | Purpose |
|---|---|
| `build.ts` | Plans for the test doc V1–V3 and two real fixture captures (`rtl-arabic`, `landing-page`) → `out/` |
| `svg.mjs` | RenderPlan → SVG (frames as groups, boxes, borders, radii, shadows, clipping, text, placeholders) |
| `measure.mjs` | Browser measurement (TextMetrics, line breaks) |
| `copy.html` | Copy buttons: SVG as text/plain, as text/html, as `image/svg+xml`, or download `.svg` |
| `svg.test.mjs` | `node --test spikes/figma-svg/svg.test.mjs` |

## Run

```bash
pnpm build && node spikes/figma-svg/build.ts
cd spikes/figma-svg && python3 -m http.server 4319 --bind 127.0.0.1
# open http://127.0.0.1:4319/copy.html in Chrome, Copy, then Esc + Ctrl+V on a Figma Web canvas
```

Known limits before any Figma test: CSS background images are not captured by the engine (white text on a missing
hero image disappears), per-side borders become filled bars, inner shadows / shadow spread / justify / title case
are not expressible, and SVG text never wraps (lines are fixed when copied).
