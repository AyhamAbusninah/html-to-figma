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
