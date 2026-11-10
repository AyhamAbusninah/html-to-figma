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
