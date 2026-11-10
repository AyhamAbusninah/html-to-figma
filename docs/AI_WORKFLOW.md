# AI workflow

How AI agents (Claude Code, OpenCode, Cursor, Codex) and developers keep this repo understandable between sessions.
The product goal: an **html.to.design-style tool** that captures any website's design and recreates it in Figma
as native, editable layers, with first-class Arabic/RTL support.

## The files

| File | For | What it is |
|---|---|---|
| `docs/architecture/ai_architecture_map.yaml` | Agents | **Source of truth.** Domains, entry points (`path:line`), hidden couplings, invariants, blast radius, known gaps, the roadmap to the goal, and a change playbook. |
| `docs/architecture/MAP.html` | Humans | Visual map of the same architecture. Open it in a browser; scroll to zoom, drag to pan, **Reset** to fit. Red = fail-closed checks, amber = gaps/hazards, blue = shared state/data, grey dashed = stubs. |
| `docs/architecture/CHANGELOG.md` | Everyone | Append-only record of changes made through the AI workflow (3 lines each). |
| `REQUIREMENTS.md`, `OPEN_QUESTIONS.md`, `PRD.md` | Everyone | Requirement IDs (EXT-*, PLG-*, SCH-*) and decisions (OQ-*, B-*, CB-*) the code cites. |
| `docs/verification/` | Everyone | Evidence per phase (what was verified, at which level: unit, browser, Figma mock, real Figma). |

## The agent's loop

1. **Read the map.** Find the domain in the YAML; check its `blast_radius`, `hidden_hooks_or_events` and
   `critical_invariants`, plus `hidden_dependencies` and `registration_rules`.
2. **Confirm before editing.** The map can lag the code: confirm a named file or function exists. If the area is
   unmapped or `trace_depth: entry_only`, trace it with `rg` and update the YAML first.
3. **Change the code** within the invariants, with tests in the existing style (Vitest unit, Playwright e2e).
4. **Verify:** `pnpm run verify` must be green (CI runs the same).
5. **Record:** append the 3-line entry to `CHANGELOG.md` under today's date.
6. **Keep the map current:** new entry point, hook, domain or data flow → update the YAML and the Mermaid in
   `MAP.html` (the generator source is the `<pre class="mermaid">` block; HTML-escape `<`, `>`, `&`).

## What developers should do

- When you change architecture by hand, update the YAML (and `MAP.html` if a box or arrow changed).
- When reporting a bug to an agent, give evidence: the capture JSON, the page URL or fixture, the popup's
  **Technical details**, a screenshot of page vs Figma/preview.
- Real Figma checks need the Figma desktop app (macOS/Windows) or an Org plan. On Fedora use the preview
  (`pnpm preview:open`) and the Figma-mock tests, and say which level a result was verified at.

## Top invariants (from the YAML)

- **One contract.** `CaptureDocument` v1 is the only thing that crosses from extension to plugin. It is validated
  before leaving the page and again before rendering; v1.0.0 is frozen, so schema changes need a minor bump and a
  new baseline.
- **Read-only, local-only capture.** The page DOM is never modified, passwords are masked at the source, nothing is
  sent over the network, and the extension keeps its minimal permission set (packaging fails otherwise).
- **Universal engine.** No site-specific selectors or tokens in `packages/{core,extension,figma-plugin}/src`
  (`check-universal`); Frappe/ERPNext is only a benchmark.
- **One layout source.** `buildPlan` (pure) decides every Figma layer for the plugin, the preview and the spikes;
  never add a second layout engine.
- **Nothing silent.** Anything not reproduced becomes a placeholder or a warning code the user sees; render failures
  are isolated per node and reported.
- **Arabic/RTL is MVP-blocking.** Alignment resolved from start/end, RTL coordinates normalized, Arabic font rules,
  no letter-spacing on Arabic, bidi marks where needed.
