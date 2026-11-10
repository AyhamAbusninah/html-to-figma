# Spike Route C: paste an SVG into Figma Web (ISOLATED)

Question: can the extension alone put a page on the clipboard so that **Ctrl+V in Figma Web** gives native,
editable layers, using only Figma's documented SVG import (no plugin, no desktop app, no Figma code, no
reverse-engineered format)? Context and the other routes: `docs/spikes/FIGMA_CLIPBOARD.md`.

- **Isolated:** not in the pnpm workspace, CI, lint or any package. Imports the plugin planner read-only.
- **No second layout engine:** `svg.mjs` serializes the unchanged `buildPlan` output. The only measurements are
  what SVG needs and the plan lacks: font ascent/descent for the baseline, and line breaks of multi-line text
  (the browser lays the text out at the captured width; `measure.mjs`).
- **Arabic/RTL:** text-anchor is written in physical terms (see the findings below); `direction` and
  right-to-left marks are kept as options for comparison.

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

## Findings in real Figma (2026-11-10, file agTC4SsB2ElXf8e4oAPudc)

Measured with the user's Ctrl+V pastes (round 1) and with Figma's own SVG importer through the official Figma MCP
(`figma.createNodeFromSvg`, rounds 1–2), reading every text layer back and comparing with the render plan.

| What Figma's SVG import does | Consequence for the serializer |
|---|---|
| Each `<svg>` becomes a FRAME; `<g>` → GROUP named after `id`; rect/path → VECTOR; `clip-path` → a mask group; a `<text>` with several `<tspan>` lines → a GROUP of single-line TEXT layers; a `<text>` without `id` is named after its characters | Round 2 nested everything under a root wrapper group and a mask, so a click selected the whole page (user report: items could not be removed). Now flat: background + sections directly in the frame, clipping only where content really overflows, no empty backgrounds, text named by content, paragraph groups named by their first line |
| `direction="rtl"` is ignored; `text-anchor` is physical (start = left edge at x, end = right edge at x) | Right-aligned Arabic lines ran off to the right in round 1. Fixed: physical anchors (`rtl: 'physical'`, default) |
| Arabic shaping and bidi order are done by Figma's text engine (punctuation and mixed Latin land correctly) | No marks or direction attributes needed |
| A text box's top is placed at `y − font-size`, regardless of the font's real ascent (Tajawal, Cairo, Noto Sans Arabic, Inter at 12/16/24 px: all exact) | `y = line top + font-size` (`target: 'figma'`, default) → every box top equals the captured top |
| `font-weight` and CSS weights map only to Regular/Bold; a PostScript-style family name selects the exact style (`Cairo-SemiBold`, `Inter-SemiBold`, `Tajawal-Medium`, `Cairo-Black`) | `font-family="<PostScript name>, <family>"` |

Result after the fixes (Arabic fixture page, top 1100 px): every text edge within 0.5 px of the plan horizontally,
every box top exact, correct fonts and weights, correct Arabic. Evidence: `docs/spikes/figma-svg/`.
Still open: whether a real Ctrl+V paste behaves exactly like `createNodeFromSvg` after the fixes; justified text;
the engine gaps (images, background images).
