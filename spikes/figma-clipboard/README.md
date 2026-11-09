# Spike Route A: Figma's internal clipboard format (ISOLATED; DO NOT SHIP)

> ⚠ **Undocumented, reverse-engineered format. Figma ToS §2.2(i)** (effective 2026-03-11) restricts attempts to discover the
> "underlying structure" of the Services. The project owner accepted this risk for an **internal experiment only**
> (2026-11-09). **No production adoption without legal review.** The result was **stop** (see `docs/spikes/FIGMA_CLIPBOARD.md` §4/§7).

- **Isolation:** not part of the pnpm workspace, CI, or any package. It imports the plugin planner read-only.
- **Dependency:** `kiwi-schema@0.5.0` (evanw/kiwi, MIT), installed locally with `npm ci`.
- **Source of truth:** the format was learned only from the user's own Figma copy in their own file. No third-party schema files or code were used.
- **Local data:** samples and payloads contain Figma's schema bytes and the user's data, so they stay in `results/*.local.json` (gitignored).

| File | Purpose |
|---|---|
| `serve.mjs` | Local-only server on 127.0.0.1:4318: inspector, copy page, saves pasted samples to `results/` |
| `inspector.html` | Paste target that detects `fig-kiwi` (Figma copy) vs `h2d` (capture-script) payloads |
| `decode.mjs` | Parses the fig-kiwi container, decompresses (deflate-raw / zstd), decodes with the embedded schema; stop rule if there is no schema |
| `encode.mjs` | RenderPlan → NodeChanges → clipboard HTML (serializer only) |
| `build-payloads.mjs` | Test doc V1–V3 → `buildPlan` → payloads (`minimal`, `observed`, `file`) |
| `copy.html` | "Copy to Figma" buttons (copy event / Clipboard API) |
| `encode.test.mjs` | Round trip (node:test); skipped without a local sample |
