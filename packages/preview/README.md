# @h2f/preview: local CaptureDocument preview

Opens a `figma-capture_*.json` from disk and draws what the H2F Figma plugin would create, with HTML/CSS. It's for
Fedora/Linux, where the Figma plugin can't run. **Not a Figma rendering.**

```bash
pnpm preview:open        # from the repo root: build + open dist/index.html in the default browser
```

- One self-contained file: `packages/preview/dist/index.html` (opens via `file://`, no server, nothing uploaded).
- Reuses, instead of re-implementing: `validateCapture` (`@h2f/schema`), `buildPlan` and font resolution
  (`@h2f/figma-plugin/plan`, `/fonts`). Only `src/render.ts` (plan → HTML) is preview-specific.
- Tests: `test/render.test.ts` (unit) and `e2e/preview.spec.ts` (built page: every layer at its capture rect ±0.5 px,
  counts, RTL, warnings, zoom/fit/pan, file unchanged, invalid input).

Guide: [`docs/FIGMA_IMPORT.md`](../../docs/FIGMA_IMPORT.md).
