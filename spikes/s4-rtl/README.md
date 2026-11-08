# Spike S4 — Arabic / RTL text via the Figma Plugin API

Resolves **OPEN_QUESTIONS R-5**: does text created by a plugin get correct Arabic **letter joining (shaping)**,
correct **bidi ordering** for mixed Arabic/Latin/digits, and which **base direction** does Figma pick? It also
checks whether prefixing an invisible **RLM (U+200F)** fixes paragraphs that start with a Latin word (PLG-RTL-2).

Standalone, no build: `manifest.json`, `code.js` (main thread), `ui.html` (UI iframe).

## Requirements

- **Figma desktop app (macOS or Windows).** Development plugins can't be imported in the browser version.
  There's no official Linux desktop app.
- Internet access. The plugin UI loads Tajawal, Cairo, and Noto Sans Arabic from Google Fonts to render the
  Chromium reference images. Figma itself provides the same families.
- Edit access to any Figma design file (use a scratch/draft file).

## Run it

1. Open the Figma desktop app and create or open a **draft design file**.
2. Menu **Plugins → Development → Import plugin from manifest…** and select
   `spikes/s4-rtl/manifest.json` from this repo.
3. Run it: **Plugins → Development → H2F Spike S4 — RTL/Arabic**.
4. Wait 10–60 s. The plugin window shows progress, then a summary table. A frame named
   `H2F Spike S4 — RTL/Arabic (<timestamp>)` is added to the current page.
5. Click **Copy report** (or click into the JSON box, Ctrl/Cmd+A, copy) and paste the JSON back.
6. Optional but useful: screenshot the generated frame, especially the *Visual-only cases* section at the bottom.

## What it tests

| Part | How | Automatic? |
|---|---|---|
| Font availability | Lists every style Figma has for Tajawal, Cairo, Noto Sans Arabic, Inter (exact style names feed PLG-F-2) | ✅ |
| Shaping | Width of joined text vs. the same letters forced apart with ZWNJ (`ببببب`, `لا`, `سلام`). Joined forms must be clearly narrower. | ✅ |
| Bidi + base direction | 10 strings × 3 fonts × {as-is, RLM-prefixed}, giving 60 fixed-width right-aligned text nodes exported as PNG. Each is compared against three Chromium references: **RTL** (correct), **LTR_BASE** (bidi applied, wrong base direction) and **NO_BIDI** (no reordering). | ✅ |
| Direction API probe | Looks for any direction-related property on `TextNode` | ✅ |
| Multi-line wrap, letter-spacing, Bold | Rendered in the frame for visual inspection | 👁 visual |

The comparison uses smoothed horizontal ink profiles with a right-anchored scale/shift search, so normal font-metric
differences between Figma's text engine and Chromium don't affect the result.

## Reading the verdict (`verdict.r5Outcome`)

| Outcome | Meaning | Next step |
|---|---|---|
| `A_RLM_WORKAROUND` | Shaping and bidi correct. Base direction follows the first strong character, and RLM fixes it. *(expected)* | Implement PLG-RTL-2 as written |
| `B_NO_WORKAROUND_NEEDED` | Shaping and bidi correct, and Figma picks RTL base direction by itself | Drop PLG-RTL-2 |
| `C_ESCALATE` | Shaping or bidi broken | Decision needed (R-5 options a/b/c) |
| `INCONCLUSIVE` | Mixed signals | Inspect the comparison frame visually |

## Dev-only verification (no Figma needed)

- `node spikes/s4-rtl/dev/mock-figma-run.mjs` runs `code.js` against a strict mock of the Plugin API
  (catches API misuse such as setting characters before the font is loaded).
- `dev/harness.html?scenario=A|B|C&sizeDelta=1.4&offset=6` plays Figma's main thread for `ui.html` with
  exports of known ground truth. Serve `spikes/s4-rtl/` over HTTP (e.g. `python3 -m http.server`) and open it.
  Verified 2026-11-08: correct outcome and 0 misclassifications for all three scenarios with up to 5% glyph-width
  difference and a 6 px offset.

Store the pasted result as `results/s4-<date>.json`.
