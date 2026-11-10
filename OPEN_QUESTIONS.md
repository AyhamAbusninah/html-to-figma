# Open Questions — Decision Log & Remaining Items

Status: v0.3 (2026-11-08). All questions are **decided**, including scope correction SC-1. The requirements in `REQUIREMENTS.md` that reference `[OQ-n]` implement the decision recorded here.

New items raised by the decisions are listed in §2. Only **R-5** blocks implementation, and it is resolved by a spike rather than by a stakeholder answer.

---

## 1. Decision Log

| ID | Topic | Decision | Notes / Consequences |
|---|---|---|---|
| **SC-1** | **Scope correction (2026-11-08)** | ✅ **Universal HTML-to-Figma converter** for any public or internal page (static sites, SPAs, SaaS dashboards, e-commerce). **Frappe/ERPNext is a stress-test benchmark only.** | No site-, framework-, or library-specific logic in the engine, which relies only on standard web APIs (PRD AD-10, REQUIREMENTS SYS-5/6/7, CI guard). The generic benchmark set has equal weight to the Frappe stress test (TST-6). |
| OQ-1 | Image capture strategy | ✅ **A: tiered pipeline** (canvas → service-worker fetch → screenshot crop) | Same-origin images (the common case, including session-protected uploads) are covered by Tier 1. Tier 2 covers CDNs, object storage, and avatar services. |
| OQ-2 | Host permissions | ✅ **C + B: fixed allow-list + optional runtime grant** | `host_permissions`: `*://*.arkantechjo.com/*` (also matches the apex domain) and local dev domains (R-1). `optional_host_permissions: ["<all_urls>"]` prompts per origin for anything else, which covers every public site. |
| OQ-3 | JSON transfer | ✅ **A: file import primary, paste ≤ 5 MB** | — |
| OQ-4 | Capture scope | ✅ **B: full page + element picker** | Element picker is now MVP (EXT-E-*). |
| OQ-5 | Inner scroll containers | ✅ **B: opt-in expansion, auto-suggested** | Detected generically from computed `overflow` and scroll geometry. Needed for app-shell layouts (dashboards, POS, mail/chat clients). Exercised by `app-shell` and by the Frappe POS benchmark. |
| OQ-6 | Layer hierarchy | ✅ **B: pruned DOM hierarchy** | — |
| OQ-7 | `::before` / `::after` | ✅ **B: temporary materialization** | Very common on the web: status dots, checkmarks, separators, decorative bars, badge counters. |
| OQ-8 | Screenshot fallback (Tier 3) | ✅ **A: yes, only for failures/unsupported** | Each use is flagged in warnings. |
| OQ-9 | Distribution | ✅ **Pilot: unpacked extension + Figma development plugin**, then enterprise/private org distribution | Post-pilot channel depends on R-2. |
| OQ-10 | Data handling | ✅ **A: local only + notice** | Text redaction mode is a fast-follow (v1.1). |
| OQ-11 | Text granularity | ✅ **A: one Figma text layer per DOM text node** | ⚠ **Arabic caveat:** if one word is split across inline elements (e.g. `<mark>` search highlights), the letters won't join across Figma layers. This is accepted as a known limitation, and merged text runs (B) are the first v1.1 item. **Update 2026-11-09:** the overlap of wrapped text that starts or ends mid-line (PREVIEW §4) is fixed within A: such a text node is split into runs of lines that share their aligned edge (one layer each); plain paragraphs stay one layer. |
| OQ-12 | Size limits | ✅ **Defaults:** 10,000 nodes · warn at 25 MB / fail at 200 MB · 4096 px per image side · 512 KB per SVG | — |
| OQ-13 | Benchmark targets | ✅ **Two equally weighted sets (per SC-1):** (A) universal fixtures + 3–5 real public sites; (B) Frappe/ERPNext **stress test**: Workspaces, List, Form, POS, Custom Web Pages × EN/AR | See TST-6. REQUIREMENTS §3.12 maps generic patterns to both sets, with no special handling. |
| OQ-14 | Tech stack | ✅ **TS strict · pnpm workspaces · Vite · Vitest · Playwright · Ajv · GitHub Actions** | Repo host: R-3. |
| OQ-15 | Support matrix | ✅ **Chrome ≥ 120 + Edge · Figma Desktop & Web** | — |
| OQ-16 | Icon fonts | ✅ **B: detect and rasterize glyphs** | Primary signal is generic (Private Use Area code points). A configurable family list covers ligature fonts (Material Symbols). |
| OQ-17 | Viewport width | ✅ **A: current window width only** | — |
| OQ-18 | Fonts & RTL | ✅ **RTL + Arabic is MVP-blocking.** Fonts: **Tajawal, Cairo**, fallback **Noto Sans Arabic** | All three are Google Fonts and ship with Figma, so no font installation is needed. Requirements EXT-RTL-*, PLG-RTL-*, PLG-F-6, and Spike S4 are added. |

---

## 2. Remaining Items

| ID | Item | Priority | Default if no answer |
|---|---|---|---|
| R-1 | Local dev domains for the allow-list | ✅ Approved | `*://localhost/*`, `*://127.0.0.1/*`, `*://*.localhost/*` (ports are ignored by match patterns) |
| R-2 | Figma plan / Chrome management | ✅ Approved | Pilot distribution (unpacked + dev plugin) |
| R-3 | Repo host / org | ✅ Approved | GitHub + GitHub Actions |
| R-4 | Frappe/ERPNext version | ✅ Approved, **benchmark only** | `frappe/erpnext:v15.124.5`, used solely by `fixtures/frappe-bench/`. It has no influence on engine logic (SYS-5/7). |
| R-5 | How Figma renders Arabic / bidi text created through the Plugin API | 🔴 Resolved by **Spike S4** | See below |

### R-5 — Arabic / bidirectional text in Figma (Spike S4)

**Context.** Because the layout uses absolute positioning, RTL *layout* is handled automatically: every box sits at its measured position, so a mirrored RTL page comes out mirrored in Figma. The open risk is **text**:

1. Does a `TextNode` created through the Plugin API apply Arabic contextual shaping (joined letter forms) and the Unicode bidi algorithm for mixed text such as `فاتورة INV-2026-00042 بتاريخ 08/11`?
2. How does Figma pick a paragraph's base direction? We know of no Plugin API property that sets it explicitly; S4 will verify. If Figma uses the first strong character, a paragraph that starts with a number or a Latin word will get the wrong base direction.
3. Do right-aligned, multi-line Arabic paragraphs wrap and align like Chrome's?

**Spike S4 (≈1 day):** render the `rtl-arabic` fixture (REQUIREMENTS TST-3) with Tajawal, Cairo, and Noto Sans Arabic, then compare it to Chrome.

**Pre-agreed outcomes (no further input needed unless S4 fails badly):**
- If shaping and bidi are correct but base direction follows the first strong character, the plugin inserts an invisible directional mark (U+200F RLM or U+200E LRM) at the start (PLG-RTL-2). This is the expected outcome.
- If shaping and bidi are correct and direction is detected well, no workaround is needed.
- **If shaping or bidi is broken**, I'll come back to you with options: (a) accept with warnings, (b) rasterize affected Arabic text (correct visuals, not editable), (c) a hybrid of editable text plus a hidden raster reference layer. **This is the only path that needs another decision from you.**

---

## 3. Re-architecture decisions & blocking items (2026-11-08)

| ID | Item | Status | Notes |
|---|---|---|---|
| A-1 | Architecture: collector (extension) → conversion engine (`@h2f/core`) → CaptureDocument → plugin (planner + adapter) | ✅ Approved | PRD AD-11, REQUIREMENTS SYS-1/1a |
| A-2 | Transfer: file-based JSON (clipboard ≤ 5 MB). No backend, relay, or other infrastructure until the file workflow shows a concrete limitation. | ✅ Approved | PRD AD-12 |
| A-3 | Verification levels UNIT / BROWSER INTEGRATION / FIGMA MOCK / REAL FIGMA. No Figma feature is "validated" on mocks alone. | ✅ Approved | REQUIREMENTS TST-7/8/9 |
| **B-1** | **macOS/Windows environment** for running the plugin in Figma (development plugins and every publish need the desktop app) | 🔴 **Open: none available** | Blocks R5/R6. Options: Windows 11 VM on Fedora (KVM), a borrowed/teammate machine, or a rented cloud desktop |
| **B-2** | **Actual Figma plan** (Organization/Enterprise needed for private plugins) and **proof that Fedora employees can run a private plugin in browser Figma** | 🔴 **Open: unknown** | Must be verified before committing to a distribution strategy (R6). The first private publish itself needs B-1. |
| R-5 | Arabic/RTL text in Figma | ⏸ **Open, not verified** | **S4-A deferred / not executed** (2026-11-08 scheduling decision by the project owner to prioritize an end-to-end MVP; this is not a technical conclusion). No S4-A findings exist. Arabic shaping, bidi, RLM and RTL behavior in Figma are **unverified**. S4-B and real-Figma validation remain outstanding. The spike and S4-A tooling are kept for later execution. 2026-11-09: in Figma Web, layers created by **Figma's own importer** rendered Arabic and mixed bidi correctly (clipboard spike, below). This is **not** evidence for text created by our plugin through the Plugin API, so R-5 stays open. |

## 4. Direct import without the plugin (clipboard spike, 2026-11-09)

Report: [`docs/spikes/FIGMA_CLIPBOARD.md`](docs/spikes/FIGMA_CLIPBOARD.md). Verification level: REAL FIGMA WEB (Starter plan, View seat).

| ID | Item | Status | Notes |
|---|---|---|---|
| CB-1 | **Goal A:** can our RenderPlan become native editable layers through Figma's official tooling? | ✅ **Proven** (frame, box, editable text, Arabic, mixed bidi) | Remote Figma MCP `generate_figma_design` (file) and Figma's capture script in clipboard mode (Ctrl+V). Deviations: boxes become Frames, V3 gets an extra auto-layout wrapper, fonts come from what the browser rendered (font race). |
| CB-2 | **Goal B:** extension "Copy to Figma" → Ctrl+V without MCP or a manual workflow | 🔴 **Open: no documented interface** | Only promising path: Figma's own capture/`h2d` clipboard mechanism, **only with Figma's written permission or a supported API** (MV3 forbids remote code, and the script is proprietary and undocumented). Otherwise Goal B goes through the plugin plus B-2. Decision needed: ask Figma? |
| CB-3 | Route A: our own encoder for Figma's internal `fig-kiwi` clipboard format | ⛔ **Stopped** | Frames and Rectangles are exact, but text is invisible until clicked: Figma needs pre-computed glyph layout (`derivedTextData`), which would require re-implementing its text engine, including Arabic shaping. Undocumented and versioned (106). **ToS §2.2(i) risk: no production adoption without legal review.** Kept isolated in `spikes/figma-clipboard/`. |
| CB-4 | `html_to_figma` MCP tool | ⏸ Not available on this account/client | Absent from the tool list (Starter/View, Claude Code). Re-check on another plan if needed. |
| CB-5 | Extension-only Copy → Ctrl+V via SVG (Route C, 2026-11-10) | ✅ **Works in real Figma Web** (editable text, correct Arabic, exact positions and weights, items removable) | Documented SVG import, no legal blocker. Layers are groups/vectors, not frames; no auto layout. Next decision: wire a "Copy to Figma" button into the extension (needs approval). See `docs/spikes/FIGMA_CLIPBOARD.md` §4b. |
