# Spike: Direct Figma import without our plugin (clipboard / official routes)

| | |
|---|---|
| Date | 2026-11-09 |
| Question | Can a capture reach **Figma Web** as native, editable layers without our development plugin, ideally by "Copy to Figma" → Ctrl+V? |
| Environment | Fedora 44, Chrome (user's own) and Playwright Chrome; **real Figma Web** document `agTC4SsB2ElXf8e4oAPudc` ("H2F spike — Route B"); Figma account on the **Starter** plan with a **View** seat |
| Test input | One CaptureDocument (`spikes/figma-official/testdoc.ts`): frame 400×300, rectangle 120×80 at (20,20) #3366FF r=8, one text at (20,140) 24/32 px. Variants: **V1** Latin/Inter, **V2** Arabic/Noto Sans Arabic RTL, **V3** mixed bidi "Arkan تقنية 2026" RTL. Each run goes through `validateCapture` → `buildPlan` (unchanged plugin planner). |
| Verification level | **REAL FIGMA WEB.** Every result below was read back from the Figma document with the official MCP `use_figma` tool (read-only Plugin API), with screenshots and the user's canvas observations. |
| Scope kept | No changes to CaptureDocument, schema, extension, plugin or packaged artifacts. Spikes live under `spikes/`, outside the pnpm workspace and CI. Nothing is wired into the extension. |

## 1. Answer in one table

| | **Goal A: Figma compatibility** (can our RenderPlan become native editable layers via Figma's official tools?) | **Goal B: product integration** (can *our extension* offer Copy → Ctrl+V in Figma Web without Claude Code, MCP or a manual workflow?) |
|---|---|---|
| Route B: official Figma MCP / Figma capture script | ✅ **Proven** for frame, box, editable text, Arabic and mixed bidi (§3). | ❌ **Not achieved.** It works only through Figma's own capture script and, for file mode, an MCP client. See §5 for what Goal B would need. |
| Route A: our own encoder for Figma's internal clipboard format | ⚠ Partial: frames and real Rectangle layers are exact, but **text is not rendered until the user clicks it**, and Arabic only lays out correctly in Figma's server render (§4). | ❌ **Not viable.** It would need our own copy of Figma's text layout engine (glyph shaping, including Arabic), relies on an undocumented format, and carries a ToS risk. |

**Recommendation: investigate another route for Goal B; stop Route A.** Details in §7.

## 2. What is documented vs. not

| Mechanism | Status | Evidence |
|---|---|---|
| Plugin API (our current plugin) | Documented, supported | Figma developer docs |
| Remote Figma MCP: `generate_figma_design`, `use_figma`, `whoami`, `create_new_file` | Documented, supported (developers.figma.com, "Code to canvas") | Used in this spike |
| MCP `html_to_figma` (HTML → layers) | Documented by Figma, but **not exposed** to this account and client (absent from the tool list on Starter/View with Claude Code) | Tool list after authentication |
| `capture.js` clipboard mode (`#figmacapture` without `figmaendpoint`) | **Undocumented as a standalone API.** Figma's help center says captures can go "to your clipboard"; the URL switch was found in Figma's own published script. | Tested and worked (§3) |
| `h2d` clipboard payload (`<span data-h2d>` + figmeta `dataType:"h2d"`) written by `capture.js` | **Undocumented, internal** | Observed envelope only; the contents were not decoded |
| Figma's native clipboard payload (`fig-kiwi` in `<span data-buffer>`, figmeta `dataType:"scene"`) | **Undocumented / reverse-engineered.** Figma ToS §2.2(i) restricts discovering the "underlying structure" of the Services. | Route A (§4) |
| html.to.design "Copy to Figma" | Documented product behavior: conversion **on html.to.design's servers**, sign-in required, each copy counts as a paid import | html.to.design docs. No code was used. |
| SVG paste, REST API | Not viable: SVG text often becomes outlines, and REST can't create nodes | Desk research |

## 3. Route B: official Figma MCP (run first)

### Availability measured on this account (not assumed)

- **Remote MCP** (`https://mcp.figma.com/mcp`) connected from Fedora: `claude mcp add --transport http …`, then OAuth via `/mcp`. Authentication succeeded.
- **`whoami`:** plan "starter", seat **View**, `code_layers_enabled: true`.
- **Rate limits** (Figma docs): Starter/View seats get **20 read calls per month**. `generate_figma_design`, `create_new_file` and `whoami` are exempt. This spike used 8 `use_figma` read calls, and whether those count toward the limit isn't documented.
- **Tools exposed:**
  - present: `generate_figma_design`, `use_figma`, `get_metadata`, `get_screenshot`, `create_new_file`, `upload_assets`, …
  - absent: `html_to_figma`.
- **`generate_figma_design` in this version** requires an **existing `fileKey`**; there is no clipboard parameter. The clipboard path lives in the capture script (see B2).
- **A View seat was enough:** `create_new_file` created a draft and `generate_figma_design` wrote into it.

### B1: capture into a file (`generate_figma_design`)

1. `spikes/figma-official/make-html.ts` renders each variant as `buildPlan` → `renderPlanHtml` (the preview renderer, unchanged), plus Figma's `capture.js` tag.
2. The pages are served on localhost.
3. Each is opened with its single-use capture ID (`#figmacapture=<id>&figmaendpoint=…&figmaselector=.root`).
4. The capture is **uploaded to mcp.figma.com** and appears in the file.

### B2: clipboard mode, Ctrl+V in Figma Web

- Opening the same page with `#figmacapture&figmaselector=.root&figmadelay=1500` (no endpoint, **no capture ID, no MCP call**) makes `capture.js` write one `text/html` item, about 3.8 KB for this page, marked `h2d`.
- During capture there were **no network requests to Figma** apart from loading `capture.js` itself. The conversion happens in the Figma editor on paste.
- The user pasted all three variants into Figma Web with Ctrl+V.

### Results (geometry comparison: `spikes/figma-official/compare.ts` → `figma-clipboard/compare.json`)

| Route | Variant | Box (x/y/w/h ±0.5, fill ±1/255, radius) | Box layer type | Text top + aligned edge ±0.5 | Text font | Text editable / visible |
|---|---|---|---|---|---|---|
| B-file | V1 / V2 / V3 | PASS / PASS / PASS | Frame | PASS / PASS / PASS | Inter / Noto Sans Arabic / Noto Sans Arabic ✅ | ✅ |
| B-clipboard | V1 / V2 / V3 | PASS / PASS / PASS | Frame | PASS / PASS / PASS | ✅ (see the font race below) | ✅ (user-verified edit + undo) |

Arabic and mixed bidi: in Figma's render, V2 is joined and right-aligned, and V3 keeps the browser's visual order "2026 تقنية Arkan" with the plan's RLM preserved (U+200F). Screenshots: `figma-clipboard/B-*.png`.

### Deviations (recorded, not fudged)

1. **No Rectangle layers.** Our `rect` comes back as a **Frame** named "Container", because Figma's capture maps divs to frames.
2. **Extra wrapper on V3.** Mixed-bidi text gets an extra auto-layout **Frame** (170×32), and the text overflows it by 12 px to the left. The right edge is still exact.
3. **Text widths are Figma's own measurements:** 128 vs. 130 captured for V1, 116 vs. 150 for V2.
4. **Font race.** One V1 clipboard capture taken before the Inter web font loaded came in as **Arimo**, the font the browser had actually used. With `figmadelay=1500` it was correct. Figma converts what the browser *rendered*, not our plan's font choice.
5. **Two conversions.** Our plan is drawn as HTML by the browser, then re-interpreted by Figma's engine. Plan details that HTML/CSS can't carry (e.g. placeholder reasons, layer names) are lost or renamed ("Container (…)").

## 4. Route A: our own fig-kiwi clipboard payload (isolated, after Route B)

Safeguards:
- `spikes/figma-clipboard/` is not in the workspace or any build.
- No third-party schemas or code. The only dependency is `kiwi-schema@0.5.0` (evanw/kiwi, MIT), spike-local.
- The format was learned **only** from the user's own copy in their own file.
- Samples are gitignored.

1. **Sample.** The user copied a frame (with an Arabic text) in Figma Web, and `inspector.html` captured the paste locally.
   - The payload is `text/plain` + `text/html` with `<span data-metadata>` (figmeta `dataType:"scene"`, fileKey, pasteID) and `<span data-buffer>`.
   - The buffer is `fig-kiwi`, version **106**, in two chunks: (0) **embedded Kiwi schema**, 672 definitions, deflate-raw; (1) the message, zstd.
   - The stop rule (no embedded schema) was **not** triggered.
2. **Encoder.** `encode.mjs` serializes RenderPlan → NodeChanges (FRAME, ROUNDED_RECTANGLE, TEXT) using the payload's own schema. Strokes, effects and blend modes are reported as skipped, not silently dropped. A spike-local round-trip test passes (`node --test spikes/figma-clipboard/encode.test.mjs`, 4/4).
3. **Real paste (user, Figma Web, copy-event method)**, two encodings:

| Encoding | Frame + Rectangle | Text on the canvas | Text font (Plugin API) | Arabic |
|---|---|---|---|---|
| `minimal` (V1–V3) | ✅ exact; a **true Rectangle layer** | ❌ **invisible until the user clicks into the text box** | "mixed" (unresolved) | ❌ reversed and unjoined (`ملاعلاب ابحرم`) in Figma's server render; the user saw left-to-right after clicking |
| `observed` (+ the text flags seen in Figma's own copy: `textBidiVersion`, `hasHadRTLText`, layout versions) | ✅ exact | ❌ **still invisible until clicked** | ✅ resolved | ✅ correct RTL in Figma's server render only |

**Root cause.** Figma's own copy carries `derivedTextData`: pre-computed glyph positions, baselines and layout (about 2.5 KB for one short line). The editor draws text from that data and recomputes it only when the text is edited. Producing it ourselves means re-implementing Figma's text layout:
- font files;
- complex shaping, including Arabic joining and bidi (e.g. HarfBuzz/WASM);
- line breaking;
- Figma's internal glyph format, matched exactly.

That is a **second layout engine**, which the spike constraints forbid. It would break whenever Figma changes the format, which is currently at version 106.

Payload size: about 47 KB of clipboard HTML for 3 nodes, of which about 35 KB is the embedded schema (fixed cost).

## 4b. Route C: SVG on the clipboard (documented import, follow-up spike 2026-11-10)

Isolated in `spikes/figma-svg/` (details and measured rules in its README; evidence in `docs/spikes/figma-svg/`).
The unchanged RenderPlan is serialized to one SVG and written to the clipboard as `text/plain`; Ctrl+V in Figma Web
uses Figma's documented SVG import. No Figma code, no reverse-engineered format, no plugin, no backend.

| Check (REAL FIGMA WEB, user's Ctrl+V + read-back through the official Figma MCP) | Result |
|---|---|
| Paste creates native layers | ✅ FRAME with groups, vectors and **editable TEXT** |
| Arabic shaping, bidi order, right alignment | ✅ after fix 1 (physical `text-anchor`; Figma ignores `direction`) |
| Text position | ✅ edges within 0.5 px, box tops exact after fix 2 (`y = top + font-size`) |
| Fonts and weights (Tajawal, Cairo, Noto Sans Arabic, Inter) | ✅ after fix 3 (PostScript-style family names) |
| Paste = `createNodeFromSvg` | ✅ identical numbers |
| Items can be selected and removed | ✅ after fix 4 (flat structure, no wrapper group or masks); confirmed by the user |

Limits of this route: boxes are vector shapes in groups (no real frames, corner-radius property or auto layout);
a wrapped paragraph is a group of single-line text layers; justified text is start-aligned; inner shadows and
per-side borders are approximated; it inherits the engine's gaps (images, CSS backgrounds). **Goal B relevance:**
this is the only route found that an extension can ship alone with documented behavior and no legal blocker.

## 5. Goal B: what extra integration would be needed

| Option | What our extension would have to do | Blockers / risks |
|---|---|---|
| **B-clip**: Figma's `capture.js` clipboard mode | Render our plan as HTML (`renderPlanHtml` already exists) in an extension page or tab, run Figma's capture script on it, and let it write the `h2d` clipboard. | **MV3 forbids remotely hosted code**, so the script would have to be bundled. It is **Figma's proprietary, unversioned script**, and redistribution or standalone use is not documented or licensed. Figma's engine re-interprets our HTML (§3 deviations). It needs **written permission or a supported API from Figma**. |
| **B-file**: MCP `generate_figma_design` | Act as an MCP client: Figma OAuth, request capture IDs, inject the script, poll. | The remote MCP serves **listed clients** (Claude Code, Cursor, VS Code, …); a custom extension is not one. Captures are **uploaded to Figma's servers** (SEC-1/OQ-10 "local only" would need a decision). Seat and plan rate limits apply. A target file is needed, and it isn't Ctrl+V. |
| **B-h2d**: write the `h2d` payload ourselves | Emit Figma's internal `h2d` JSON directly from CaptureDocument. | Undocumented internal format: the same ToS and drift risks as Route A. Not tested; its contents were not decoded. |
| Route A (fig-kiwi) | Our own encoder plus a full text-layout engine | §4: not viable |
| Existing plugin (status quo) | Import a JSON file | B-1 (macOS/Windows for development/publishing) and B-2 (Org/Enterprise plan for Fedora users) |

## 6. Constraints measured or confirmed

- **Clipboard.** `text/html` is written via the `copy` event (`setData`) or `ClipboardItem`. Both need a user gesture or a focused document, and the extension already has `clipboardWrite`.
- **Payload size.** About 3.8 KB `h2d` for 3 nodes (Route B); about 47 KB fig-kiwi (Route A). Large pages remain untested. `generate_figma_design` documents a 50 MB capture limit.
- **Fonts.** Route B takes the font the browser actually rendered, so web fonts must finish loading before capture (font race, §3). Route A text needs Figma-side layout data.
- **Images and SVG.** Out of PoC scope. In Route B, Figma's script rasterizes images itself. In Route A, image hashes/blobs are unknown.
- **Arabic/RTL.**
  - Route B renders correctly in Figma (V2, V3).
  - This is **not** evidence for our Plugin API path: R-5 / Spike S4-B (PLG-RTL-*) is still unverified, because Figma's importer created these layers, not our adapter.
- **Rich text.** Not exercised. CaptureDocument has one style per TEXT node (OQ-11).

## 7. Recommendation

1. **Goal A: proceed (as a validation tool).** Use Route B (`generate_figma_design` into a scratch file) as a **real-Figma verification harness** from Fedora: it proved that what our RenderPlan describes is representable as native editable layers, including Arabic. It is not a substitute for verifying our plugin (B-1).
2. **Goal B: investigate another route.** No documented interface lets a third-party extension put native layers on the Figma clipboard.
   - The only promising path is **B-clip** (Figma's own capture/`h2d` clipboard mechanism), and only **if Figma confirms in writing** that an internal tool may bundle or use it. Ask Figma (developer support / account team) before any work.
   - Otherwise, Goal B goes through the existing plugin, with B-2 (an Organization plan → private plugin usable in Figma Web) as the Fedora path.
3. **Route A: stop.** Frames and rectangles are trivial, but editable text needs a re-implementation of Figma's text engine, which goes against the no-second-engine constraint. The format is undocumented and versioned (106), and there is a **ToS §2.2(i) risk**. **No production adoption without legal review**, and none is recommended.

## 8. Reproduce

```bash
node spikes/figma-official/make-html.ts --figma-capture            # Route B pages → spikes/figma-official/out/
(cd spikes/figma-official/out && python3 -m http.server 4317 --bind 127.0.0.1)
#   B-file: ask the Figma MCP for a capture ID (generate_figma_design), open <page>#figmacapture=<id>&figmaendpoint=…
#   B-clipboard: open http://127.0.0.1:4317/v1.html#figmacapture&figmaselector=.root&figmadelay=1500, then Ctrl+V in Figma
node spikes/figma-official/compare.ts                                # plan vs evidence.json

cd spikes/figma-clipboard && npm ci && node serve.mjs               # Route A: http://127.0.0.1:4318/ (inspector), /copy.html
node decode.mjs results/sample-….local.json                          # decode your own Figma copy
node build-payloads.mjs && node --test encode.test.mjs
```

Evidence: `docs/spikes/figma-clipboard/` contains `evidence.json` (read-back values), `compare.json`, and screenshots.
- Route B images are Figma renders of the pasted/captured layers.
- Route A images are Figma's *server* render. On the canvas, Route A text was invisible until clicked, per the user's observation.
