# Spike Route B: official Figma MCP / capture script

This spike checks whether Figma's official tooling turns our RenderPlan into native editable layers (Goal A). Results are in `docs/spikes/FIGMA_CLIPBOARD.md` §3.

| File | Purpose |
|---|---|
| `testdoc.ts` | The 3-node test CaptureDocument (V1 Latin, V2 Arabic, V3 mixed bidi), shared with Route A |
| `make-html.ts` | `validateCapture` → `buildPlan` → `renderPlanHtml` → `out/v*.html` (+ `--figma-capture` adds Figma's `capture.js` tag) |
| `compare.ts` | Plan vs values read back from real Figma (`docs/spikes/figma-clipboard/evidence.json`) |

`out/` is generated and gitignored. The capture-script tag loads Figma's hosted script from mcp.figma.com: it's for this
spike only and is never added to the extension.
