# S4-A: Arabic / RTL text in Figma Web (Fedora proxy)

> **Status: deferred / not executed** (scheduling decision 2026-11-08). No results exist yet. Run it later with the steps below.

Stage A of Spike S4 (OPEN_QUESTIONS R-5). It runs the **original S4 matrix** against Figma's text engine using
**Figma Web on Fedora**, with no development plugin (those need the macOS/Windows desktop app).

> **Scope.** S4-A tests text created in the **Figma editor UI**. It does **not** validate text created through the
> **Plugin API**, which is what the renderer will do. That is S4-B (`../code.js`, unchanged, on macOS/Windows).

## What is reused unchanged

| Piece | Source |
|---|---|
| Test matrix: 10 bidi cases × 3 fonts × {as-is, RLM}, 3 shaping cases × 3 fonts, visual cases V1–V3, sizes | read at runtime from `../code.js` (`matrix.mjs`) |
| Reference rendering, profiles, similarity, classification, verdict | the functions **in** `../ui.html`, loaded in Chromium and called directly (`pipeline.mjs`) |
| Decision rules (A / B / C outcomes) | `../ui.html` `verdict()` and OPEN_QUESTIONS R-5 |

## Disclosed adaptations (vs S4-B)

1. **Creation path:** editor UI instead of Plugin API. This is the defining limitation.
2. **Export:** one PNG per frame at 2x (rows sliced at 48 px × 2) instead of `exportAsync` per node.
3. **Input adapter:** composite over white, ink = 255 − luminance, because the classifier reads ink from alpha.
4. **Shaping metric:** ink-extent width per row instead of `TextNode.width`. Thresholds unchanged (S1 < 0.85, S3 < 0.92).
5. **Order safety:** each row is also matched against all 10 cases. A row that looks like a different case is flagged
   and excluded from the verdict, never re-interpreted.

## Files

| File | Purpose |
|---|---|
| `kit.html` | Operator kit: settings, procedure, and every string with a **Copy** button (invisible RLM/ZWNJ included). Regenerate with `node make-kit.mjs`. |
| `classify.mjs` | CLI: classifies a Figma export zip or folder, writes the evidence folder |
| `pipeline.mjs` | Analysis pipeline (uses `../ui.html`) |
| `selftest.mjs` | Synthetic ground-truth test of the pipeline (scenarios A/B/C, opaque/transparent, zip, row swap, bad geometry) |
| `matrix.mjs` | Reads the matrix from `../code.js` |

## Run

1. Open `kit.html` in your browser and build the 12 frames in a Figma Web **draft** file, following the kit
   (about 25–35 min). Note your browser and version.
2. Export all 12 frames as **PNG 2x** (one zip).
3. `node spikes/s4-rtl/s4a/classify.mjs ~/Downloads/<export>.zip --browser "<browser version>" --operator "<name>"`
4. Evidence lands in `spikes/s4-rtl/results/s4a-<date>/`:
   - `exports/`: original PNGs (+ the zip)
   - `sheets/`: contact sheets per frame (Figma row next to the correct RTL, LTR_BASE, and NO_BIDI references)
   - `sheets/*-visual.chromium-reference.png`: Chromium rendering of V1–V3, for side-by-side inspection
   - `report.json`, `report.md`: every row's class, scores and confidence; shaping ratios; verdict; input sha256

Self-test (no Figma needed): `node spikes/s4-rtl/s4a/selftest.mjs`. Verified 2026-11-08: all 5 cases pass.
