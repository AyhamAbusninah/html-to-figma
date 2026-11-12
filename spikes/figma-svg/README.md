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

## Phase 1 findings: images, icons, gradients, paste size (2026-11-10, user's Ctrl+V in Figma Web)

Test board `media.html` (`media.mjs` → `out/media.json`), checked by the user against the browser preview:

| Case | SVG technique | Figma result |
|---|---|---|
| A | `<image href="data:image/jpeg;base64,…">` | ✅ image fill |
| B | one `<image>` in `<defs>` reused with `<use>` ×3 | ✅ |
| C | `<pattern>` with an image as a rounded rect's fill | ✅ |
| D | image clipped by `<clipPath><circle>` (avatar) | ✅ |
| E | nested `<svg viewBox>` icons (star, gradient logo) | ✅ editable vectors, colors changeable |
| F | `linearGradient` (3 stops, stop-opacity) | ✅ |
| G | `radialGradient` | ✅ |
| H | Arabic text over an image | ✅ (text above the image, as on the page) |
| I | `preserveAspectRatio="xMidYMid slice"` (object-fit: cover) | ✅ cropped, not stretched |
| J | transparent PNG, and `opacity="0.5"` | ✅ |
| Size | 2 MB, 8 MB, 26 MB of noise JPEGs | ✅ all pasted |

Consequence: images, inline SVG, gradients and background images can all ship through Copy to Figma; ~26 MB pastes
work, so the existing 4096 px / JPEG limits are enough.

## Phase 2 findings: paragraphs and layer names (2026-11-11)

Board `media.html?board=editing` (`editing.mjs` → `out/editing.json`). Round 1 imported with Figma's own SVG importer
(`figma.createNodeFromSvg` through the official Figma MCP), every layer read back:

| Case | SVG technique | Figma result |
|---|---|---|
| P0 | one `<tspan x y>` per line (today) | a GROUP of one-line TEXT layers (line height AUTO) |
| P1 | one tspan, lines joined with line feeds (`&#10;`) | ❌ one TEXT, line feeds became spaces: one long line |
| P2 | P1 + `style="white-space: pre; line-height"` | ❌ same as P1; line height stays AUTO |
| P3 | tspans positioned with `dy` only | ❌ a GROUP, like P0 |
| P4 | SVG 2 `inline-size` auto-wrap | ❌ ignored: one long line |
| P5 | HTML in `<foreignObject>` | ❌ dropped entirely |
| N | `<g id>`/`<text id>` with spaces, "·" and Arabic ("Card · New arrivals", "زر · أضف إلى السلة") | ✅ kept exactly as layer names |

Round 2 (user's Ctrl+V paste, read back with the Figma REST API, node 31:7778): U+2028 and U+2029 inside one tspan
are **stripped** (one 843 px line, no separator left in `characters`), and no line-height hint is read
(`style="line-height"`, a `line-height` attribute, the `font` shorthand): line height stays the font's intrinsic
value (Inter 16 → 19.36 px, Tajawal 18 → 21.6 px).

**Conclusion:** Figma's SVG import cannot create a multi-line TEXT layer. Copy to Figma keeps one TEXT per line,
grouped per paragraph (P0). A real multi-line paragraph needs the plugin route (figma.createText) or Figma's
own capture path (CB-2).

Measuring without the MCP quota: a read-only personal access token (File content: read) lets
`GET https://api.figma.com/v1/files/<key>/nodes?ids=<id>` return every pasted layer (type, characters, box,
line height); the token lives in a local file, never in the repo or the conversation.


## Letter-spacing (2026-11-11, user's Ctrl+V in Figma Web, read back in view mode)

Boards `media.html?board=spacing` and `?board=spacing2` (`spacing.mjs`). "THE NEW SEASON", Inter 32 px, 6 px
tracking: on the page it is 362 px wide, without tracking 284 px.

| Case | SVG technique | Figma result |
|---|---|---|
| S0–S8 | `letter-spacing` attribute (unitless, px, em), inline `style`, per-character `dx` | ❌ ignored: 284 px, tracking 0 |
| T1 | `textLength` + `lengthAdjust="spacing"` | ❌ ignored |
| T2 | `<style>.ls6{letter-spacing:6px}</style>` + `class` | ❌ ignored (but the paste works: a `<style>` element does not break import) |
| T3 | three U+200A hair spaces between letters | ✅ wider (~400 px; one hair space ≈ 3 px in Inter), but the text then holds invisible characters |

Round 3 (`spacing3.mjs`, one SVG per row, 2026-11-12): Figma's own export form (`style="white-space: pre"` +
`letter-spacing="…em"`), the same in px, and one `x` per letter on a tspan were all ignored; one tspan per letter
was merged into one TEXT with the word spaces lost ("THENEWSEASON"). Two hair spaces per gap matched the pink bar
within ~1 px.

Round 4 (`spacing4.mjs`, hair-space width per font, 50 px, 20 hair spaces, read from the pixels at 100 %): Figma
draws the font's own U+200A glyph, so the width varies: Inter 0.091 em, Manrope 0.062, Cormorant Garamond 0.118,
Roboto 0.103, Montserrat 0.100, Playfair Display 0.063. Google Fonts' `text=` subset measured in Chromium gives the
same values within 0.001 em, so `scripts/gen-hair-spaces.mjs` builds the table for every Google family
(`packages/figma-plugin/src/config/hair-spaces.ts`; the 1/16 em default for the rest).

**Conclusion (user's decision, 2026-11-12):** the popup's "Match letter spacing" switch, on by default, writes
letter spacing as hair spaces between characters (count per gap chosen so each letter stays within half a hair
space of Chrome's position, width from the per-font table). Off: clean text. Both name the layer
"<text> · tracking 6px". Arabic never gets spacing (EXT-RTL-5).
