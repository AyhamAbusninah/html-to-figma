# Architecture changelog (AI workflow)

Append-only log of verified changes made through the AI workflow (see `docs/AI_WORKFLOW.md`). Never edit or delete
past entries. Add new entries at the bottom, under a `## YYYY-MM-DD` heading for the day, in this exact format:

```
- **Feature/File modified:** [File path]
- **What changed:** [Brief technical description of logic added/altered]
- **Hooks/Dependencies updated:** [Hooks, events, locks, registrations, or shared state touched]
```

## 2026-11-10

- **Feature/File modified:** `docs/architecture/ai_architecture_map.yaml`, `docs/architecture/MAP.html`, `docs/architecture/CHANGELOG.md`, `docs/AI_WORKFLOW.md`, `CLAUDE.md`, `AGENTS.md`, `.prettierignore`
- **What changed:** Architecture bootstrap at commit bfc1bb2: 9 domains (collector, engine, schema-contract, extension-shell, plugin-planner, plugin-adapter, preview, quality-gates, spikes), entry points, invariants, known gaps and the roadmap to an html.to.design-class tool; interactive Mermaid map; agent rules in Direct Mode (no triage tags).
- **Hooks/Dependencies updated:** None in code. `docs/architecture/` excluded from Prettier so the generated map keeps its layout.

- **Feature/File modified:** `spikes/figma-svg/` (svg.mjs, measure.mjs, build.ts, copy.html, svg.test.mjs), `docs/spikes/FIGMA_CLIPBOARD.md` §4b, `OPEN_QUESTIONS.md` CB-5
- **What changed:** Route C spike: RenderPlan → SVG for Ctrl+V into Figma Web. Fixed from real-Figma measurements: physical text-anchor (Figma ignores direction), y = top + font-size, PostScript font names, flat layer structure so items can be removed.
- **Hooks/Dependencies updated:** None in production code; spike imports buildPlan read-only. Not wired into the extension.

- **Feature/File modified:** `packages/figma-plugin/src/svg/svg.ts` (new), `packages/extension/src/shared/figma-copy.ts` (new), `packages/extension/src/popup/popup.{ts,html}`, `packages/extension/src/content/index.ts`, `packages/extension/src/shared/messages.ts`, `packages/core/src/{convert,document,index}.ts`, extension 0.3.0
- **What changed:** Copy to Figma (EXT-O-7): popup button writes one SVG of the capture to the clipboard; Ctrl+V in Figma Web creates editable layers without the plugin. SVG writer productionized from spikes/figma-svg (physical text-anchor, y = top + font-size, PostScript fonts, flat tree, per-line direction marks); line breaks from the engine's new `textLines` side output (`buildCapture`).
- **Hooks/Dependencies updated:** New export `@h2f/figma-plugin/svg`; extension now depends on `@h2f/figma-plugin`; `CaptureResult.textLines` (not in CaptureDocument, schema unchanged); version bumped in the 5 places.

- **Feature/File modified:** `packages/extension/src/content/{assets.ts (new),collect.ts,index.ts}`, `packages/core/src/{raw-snapshot,convert,document}.ts`, `packages/figma-plugin/src/{plan/plan.ts,svg/svg.ts,adapter/render.ts}`, `packages/preview/src/render.ts`, `e2e/assets.spec.ts`, `spikes/figma-svg/media.*`
- **What changed:** Phase 1 (images & icons), first part: inline SVG (EXT-S-1..3, S-5) and Tier 1 image pixels (EXT-I-2/6/7/9: canvas, data/blob, CORS fetch, canvas/video frames) captured into SvgNode / ImageNode + assets; Copy to Figma emits <image> (object-fit, rounded clip) and nested <svg> (Figma behavior verified by the user's pastes, spikes/figma-svg/README.md); preview draws them; plugin keeps placeholders.
- **Hooks/Dependencies updated:** New collector asset phase (async, before buildCapture); RawElement.svg/assetId/assetFailed + RawPageSnapshot.assets; PlanImage/PlanSvg kinds + RenderPlan.images; warning IMAGE_FETCH_FAILED aggregated. CaptureDocument schema unchanged.

- **Feature/File modified:** `packages/extension/src/background/service-worker.ts`, `packages/extension/src/content/{assets,collect}.ts`, `packages/extension/src/popup/{popup.ts,popup.html}`, `packages/extension/src/shared/{messages,popup-model}.ts`, `packages/extension/public/manifest.json`, `scripts/package-extension.mjs`, `REQUIREMENTS.md` EXT-P-4b
- **What changed:** Images from any site (user decision: fetch + screenshot). Tier 2: service worker fetches images the page can't read (allow-list hosts, or all sites after the optional grant). Tier 3: remaining images, tainted canvases, video and iframes cropped from captureVisibleTab screenshots (page scrolled per image, scroll restored, ≤ 24 shots, 2/s). Popup offers "Allow images from other sites" once when screenshots/missing images occurred, then re-captures.
- **Hooks/Dependencies updated:** New permission: `optional_host_permissions: ["<all_urls>"]` (approved; packaging policy updated). Worker messages h2f:fetch-asset (implemented) and h2f:capture-visible (new). Collector jobs gain kind `frame` (iframe/object/embed).

- **Feature/File modified:** `packages/core/src/gradient.ts` (new), `packages/core/src/{convert,raw-snapshot,index}.ts`, `packages/extension/src/content/{assets,collect}.ts`, `packages/figma-plugin/src/{plan/plan.ts,svg/svg.ts,adapter/render.ts}`, `packages/preview/src/render.ts`
- **What changed:** Phase 1 part 3: CSS gradients (linear with angles/side+corner keywords/px+% stops, radial with shapes/sizes/positions) and CSS background images (each url() layer composited at the element size honoring background-size/-position incl. calc()/-repeat/-origin, EXT-I-8) become fills, stacked in CSS layer order over the background color. Repeating/conic gradients and background-clip:text fall back to the first color (GRADIENT_UNSUPPORTED). Copy to Figma draws each layer as its own shape (gradient defs on the CSS gradient line); preview draws CSS layers; plugin adapter keeps solid fills.
- **Hooks/Dependencies updated:** RAW_STYLE_KEYS + background-size/-position/-repeat/-clip; RawElement.bgAssets; collector job kind `bg` (per CSS layer index); PlanBox.fills is now PaintSpec (solid | gradient | image). Page (html/body) background images still not captured.

- **Feature/File modified:** `packages/extension/src/content/pseudo.ts` (new), `packages/extension/src/content/{collect,assets,index}.ts`, `packages/extension/src/config/constants.ts`, `packages/core/src/{convert,raw-snapshot}.ts`
- **What changed:** Phase 1 part 4: ::before/::after materialized for the DOM read (EXT-T-11, OQ-7 B): spans with the pseudo's computed style and resolved content (strings, counter()/counters() in document order, attr(), quotes, url() as an image), pseudo hidden by an adopted style sheet; everything removed right after the read (DOM and adoptedStyleSheets asserted unchanged). Icon fonts (EXT-X-9): text that is all Private-Use-Area characters or in an ICON_FONT_FAMILIES family is drawn with the page font (ligatures included) into a PNG and emitted as an IMAGE.
- **Hooks/Dependencies updated:** The collector is now async and briefly mutates the page (materialization, undone in finally); ICON_FONT_FAMILIES constant (SYS-5); RawText.iconAssetId; collector jobs `glyph`; background jobs snapshot their CSS at read time (BgBox). Pseudo-elements on shadow hosts and beyond 5,000 stay PSEUDO_ELEMENT_NOT_CAPTURED.

## 2026-11-11

- **Feature/File modified:** `packages/extension/src/content/{index,assets,collect}.ts`, `packages/extension/src/content/settle.ts` (new), `packages/core/src/{css,convert,raw-snapshot,index}.ts`, `packages/figma-plugin/src/svg/svg.ts`, `packages/schema/src/warnings.ts`, `packages/extension/src/shared/popup-model.ts`, `fixtures/pages/page-effects.html` (new), `REQUIREMENTS.md` (EXT-T-9, EXT-G-3, EXT-V-7, EXT-V-10, EXT-X-3, EXT-I-4)
- **What changed:** Phase 1 part 5, fixes from a real-site test (mid-scroll capture): (1) capture scrolls to the top, settles (scroll handlers, finite animations ≤ 1 s) and scrolls back, so fixed/sticky headers sit at the top (EXT-T-9, AC-EXT-7); (2) Tier 3 crops elements inside fixed/sticky ones first, then hides fixed/sticky elements, settles after each scroll, crops at live rects and stitches elements up to 4 viewports tall; (3) mirroring transforms (scaleX(-1), rotate(180deg)… incl. ancestors) flip encoded pixels and wrap SVG content, and clip-path: inset() becomes a clipping frame "clip · …" trimmed to the content; (4) Copy to Figma applies text-transform: capitalize; (5) mix-blend-mode elements are captured as a screenshot IMAGE "… · blended" (BLEND_MODE_RASTERIZED).
- **Hooks/Dependencies updated:** collectPage returns `pinned` (fixed/sticky elements) → resolveAssets(snapshot, jobs, pinned); collector walk passes `Inherited {flip, inRaster}`; jobs carry `flip`, new job kind `raster`; RawElement.raster; new core exports flipOf/parseInsetClip; screenshots temporarily set data-h2f-hide + an adopted style sheet (restored in finally, asserted by e2e); new warning code BLEND_MODE_RASTERIZED (aggregated). CaptureDocument schema unchanged.


- **Feature/File modified:** `packages/extension/{package.json,public/manifest.json,src/config/version.ts,INSTALL.md}`, `e2e/extension.spec.ts`
- **What changed:** Extension 0.4.0 (Phase 1, images & icons) for release: version bumped in the 5 places; INSTALL.md gains the 0.4.0 changes and updated limitations.
- **Hooks/Dependencies updated:** None beyond the version constant (popup, service worker log, BUILD-INFO.json, release ZIP name).

- **Feature/File modified:** `packages/core/src/naming.ts` (new), `packages/core/src/{convert,raw-snapshot,index}.ts`, `packages/extension/src/content/collect.ts`, `packages/core/test/naming.test.ts` (new), `e2e/{assets,extension}.spec.ts`, `spikes/figma-svg/{editing.mjs (new),media.html,README.md}`, `REQUIREMENTS.md` PLG-R-10
- **What changed:** Phase 2 start (branch feat/easier-editing): readable layer names from HTML semantics only (tag, ARIA role/label, alt/title, input type, visible text, readable class/id; hashed and utility classes skipped), e.g. "Button · Add to cart", "Nav · Main menu", "Image · Leather tote", "Product card". The CSS-style name moves to `domPath` (already optional in schema v1). Paragraph spike board: line feeds, dy, inline-size and foreignObject all fail in Figma's SVG import; separator test pending a paste.
- **Hooks/Dependencies updated:** RawElement.attrs (role, aria-label, alt, title, type, img src) read by the collector; every element-derived node now sets domPath; tests that matched CSS names now match domPath. Schema unchanged.

- **Feature/File modified:** `spikes/figma-svg/README.md`
- **What changed:** Paragraph spike round 2 (user paste, read via Figma REST API): U+2028/U+2029 are stripped and line-height hints ignored, so Figma's SVG import cannot make a multi-line TEXT. Decision: Copy to Figma keeps grouped line layers.
- **Hooks/Dependencies updated:** None in code. New measurement channel for real-Figma checks: REST API with a read-only personal access token kept in a local file.

