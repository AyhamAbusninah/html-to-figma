# HTML to Figma (H2F): agent rules

Goal: an html.to.design-style tool. Capture any website's design (LTR or Arabic/RTL) and recreate it in Figma as
native, editable layers. Product docs: README.md, PRD.md, REQUIREMENTS.md, OPEN_QUESTIONS.md.

<!-- arch-bootstrap:start -->
## Context loading (mandatory)

Before editing code, read `docs/architecture/ai_architecture_map.yaml`, find the domain you are touching, and check
its `blast_radius`, `hidden_hooks_or_events`, `critical_invariants`, plus `hidden_dependencies` and
`registration_rules`. Trust the map over memory, but confirm a named file or function exists before editing it.
If the area is unmapped or `trace_depth: entry_only`, trace it with `rg` and update the YAML first.
Humans read the same architecture in `docs/architecture/MAP.html`; the workflow is in `docs/AI_WORKFLOW.md`.

## Project invariants (never weaken)

- `CaptureDocument` v1 (`packages/schema`) is the only cross-component contract. Validate before it leaves the page
  (`content/index.ts`) and before rendering (plugin UI, preview). v1.0.0 is frozen by `contract.test.ts`: a schema
  change needs `pnpm schema:generate`, a minor bump in `version.ts` and a new baseline. Never reject 1.x.y docs.
- Fail-closed limits stay: > 10,000 nodes throws (`core/convert.ts` countNode), > 200 MB refused (popup),
  unsupported schema major rejected (`validate.ts`).
- Capture is read-only and local-only: never mutate the page DOM (e2e compares outerHTML), mask passwords in the
  collector, send nothing over the network, no remote code in the extension (MV3), plugin `networkAccess: none`.
- Permissions: only `activeTab`, `scripting`, `downloads`, `clipboardWrite` + the approved host allow-list.
  `scripts/package-extension.mjs` fails on anything else; new permissions need the user's approval.
- Universal engine: no site-specific selectors or tokens in `packages/{core,extension,figma-plugin}/src`
  (`pnpm check:universal`); site constants live only in `src/config/`. Frappe/ERPNext is a benchmark only.
- The collector only reads the browser; all interpretation lives in `@h2f/core` (pure, deterministic,
  unit-tested). `RawPageSnapshot` is internal: change collector and core together.
- One layout source: `buildPlan` (`figma-plugin/src/plan/plan.ts`, pure) decides every Figma layer for the
  plugin, the preview and the spikes. Never add a second layout/conversion engine.
- Nothing silent: unsupported content becomes a placeholder or a warning code (`schema/src/warnings.ts`); render
  failures stay isolated per node (`adapter/render.ts`).
- Arabic/RTL is MVP-blocking: physical alignment from start/end, RTL x normalization, Arabic font rules
  (Tajawal/Cairo, fallback Noto Sans Arabic), no letter-spacing on Arabic. Test every text change on
  `fixtures/pages/rtl-arabic.html`.
- `spikes/` is isolated and never shipped. The fig-kiwi clipboard route (`spikes/figma-clipboard`) is
  reverse-engineered (Figma ToS §2.2(i)): no production use without legal review.
- Extension version lives in 5 places (package.json, manifest.json, config/version.ts, e2e/extension.spec.ts,
  INSTALL.md); bump them together for any shipped extension change.
- `pnpm run verify` must be green before commit; say at which level a result was verified (unit, browser,
  Figma mock, real Figma). Never claim real-Figma success without a real Figma test.

## Micro-doc rule (mandatory)

After any verified code change, append the 3-line entry to `docs/architecture/CHANGELOG.md` under today's
`## YYYY-MM-DD` heading:

- **Feature/File modified:** [File path]
- **What changed:** [Brief technical description of logic added/altered]
- **Hooks/Dependencies updated:** [Hooks, events, locks, registrations, or shared state touched]
<!-- arch-bootstrap:end -->
