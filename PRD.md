# PRD — HTML-to-Figma (Internal Tool)

| Field | Value |
|---|---|
| Status | v0.3: scope corrected to **universal** (SC-1). All decisions made (see `OPEN_QUESTIONS.md`). Only R-5 (Spike S4) is pending. |
| Target | **Any HTML page Chrome can render**, public or internal: static sites, landing pages, React/Vue/Angular SPAs, SaaS dashboards, e-commerce. Both **LTR and RTL (Arabic)**. |
| Benchmarks | Generic fixture pages + **Frappe/ERPNext v15 as a stress-test benchmark only** (complex Flexbox/Grid, sticky headers, inner scrolls, RTL). It is not a target platform, and no engine logic is specific to it. |
| Date | 2026-11-08 |
| Owner | Arkan Tech, Internal Tools |
| Components | Chrome Extension ("Extractor") + Figma Plugin ("Renderer") |
| Related docs | `USER_FLOWS.md`, `REQUIREMENTS.md`, `OPEN_QUESTIONS.md` |

---

## 1. Product Vision

Designers and engineers should be able to take **any page they can see in Chrome** (a public marketing site, a competitor's product page, a React SPA, a third-party SaaS dashboard, or an internal page behind company login) and get an **editable Figma design** of it in under a minute, with no manual redrawing.

The converter is **universal by construction**: it understands pages only through standard web platform APIs (DOM, `getComputedStyle`, `getBoundingClientRect`, Range geometry). It never relies on knowledge of a particular framework, CSS library, or site.

Today, recreating an existing internal screen in Figma (for a redesign, an audit, documentation, or a new feature mock-up) means taking screenshots and redrawing by hand. That takes hours per screen and drifts from the real product. HTML-to-Figma reads the live, rendered page and rebuilds it as real Figma layers: frames, text, images, and vectors.

## 2. Problem Statement

1. **Redrawing is slow.** A typical internal screen takes 1–4 hours to recreate faithfully in Figma.
2. **Screenshots can't be edited.** A flat PNG gives no editable text, no layer structure, and no way to change colors.
3. **Existing SaaS converters can't reach internal pages.** Server-side or headless tools (Puppeteer-based services, public plugins that fetch a URL) can't get past SSO, VPN, or session-cookie authentication, and sending internal pages to a third-party service is a data-handling risk.

## 3. Objectives & Success Metrics

| # | Objective | Metric (MVP target) |
|---|---|---|
| O1 | Fast capture-to-Figma | Median under **60 s** from clicking the extension to a rendered frame, for a page with ≤ 2,000 visible elements |
| O2 | Spatial fidelity | ≥ **95%** of rendered boxes within **±2 px** of the source position and size (see `REQUIREMENTS.md` §6) |
| O3 | Editability | 100% of visible DOM text becomes editable Figma `TEXT` nodes, not raster |
| O4 | Works on authenticated pages | Capture works on the user's logged-in internal pages with no extra credentials |
| O5 | Zero data egress | No page content leaves the user's machine apart from the user moving the JSON file into Figma |
| O6 | Adoption | ≥ 5 designers/engineers use it weekly within 4 weeks of release |
| O8 | Universality | O2 is met on the **generic benchmark set** (landing page, SPA, dashboard, e-commerce fixtures, plus 3–5 real public sites per release) and on the Frappe stress test alike. **Zero** site- or framework-specific code in the engine (CI-enforced, SYS-5/6). |
| O7 | Arabic / RTL parity | Arabic captures meet O2 and O3 like LTR ones. 100% of Arabic text renders in an Arabic-capable font (Tajawal / Cairo / Noto Sans Arabic) with joined letters and correct bidi order. |

## 4. Target Users

| Persona | Need |
|---|---|
| **Product Designer** | Start a redesign from the real current state of an internal screen instead of a blank canvas |
| **Frontend Engineer** | Hand a "what's live today" design to design or QA, or document a screen |
| **Product / QA** | Annotate or mark up real screens in Figma for specs and bug reports |

## 5. Solution Overview

```
┌───────────────────────── User's Chrome (authenticated session) ─────────────────────────┐
│                                                                                         │
│  Popup ──► Content Script ──(DOM walk, getComputedStyle, getBoundingClientRect)──┐      │
│                 ▲                                                                ▼      │
│                 │  asset requests          Service Worker (privileged fetch,  ◄──┘      │
│                 └──────────────────────────  image → Base64, SVG text)                  │
│                                                       │                                 │
│                                                       ▼                                 │
│                                        capture.json (schema-versioned)                  │
└───────────────────────────────────────────────────────┼─────────────────────────────────┘
                                                        │  download / copy (user-moved)
┌──────────────────────────────── Figma Desktop / Web ──┼─────────────────────────────────┐
│  Plugin UI (iframe): load file / paste ─► validate ─► postMessage ─►  Plugin main thread │
│                                                                      │                  │
│                     resolve + load fonts ─► create nodes at absolute (x, y) ─► report   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Key architectural decisions (accepted)

| ID | Decision | Rationale |
|---|---|---|
| AD-1 | Chrome Extension, not a headless browser | Reuses the user's live authenticated session (SSO, cookies, VPN). No credentials to manage, and no server. |
| AD-2 | JSON as the only interface between the two components | Decouples the two parts. Each can be tested on its own, and the file can be archived, diffed, and replayed. |
| AD-3 | All assets embedded in the JSON (Base64 rasters, raw SVG strings) | The Figma plugin has no network access (CORS, and a no-network security posture). |
| AD-4 | Absolute positioning only, no Auto Layout | Translating Flexbox/Grid to Auto Layout is a separate, much larger problem. Absolute placement is deterministic and testable. |
| AD-5 | Font fallback, no custom font fetching | Figma can only render fonts installed or shared in the org. Missing fonts fall back to an available family. |
| AD-6 | Three-tier image pipeline (canvas → service-worker fetch → screenshot crop) | OQ-1. Canvas alone fails on cross-origin images. |
| AD-7 | Host permissions: allow-list (`*.arkantechjo.com` + local dev) + optional per-origin grant | OQ-2. No install-time "all websites" warning. |
| AD-8 | RTL & Arabic are first-class (MVP-blocking) | OQ-18. Absolute positioning covers mirrored layout automatically. The work is in text direction, alignment, and an Arabic font chain (Tajawal → Cairo → Noto Sans Arabic). |
| AD-9 | Pruned DOM hierarchy, one text layer per DOM text node | OQ-6, OQ-11. Keeps layer counts usable. Merged rich-text runs come in v1.1. |
| AD-10 | **Universal engine: no site-specific logic** | SC-1. Every behavior is derived from standard web APIs and expressed in terms of computed style and geometry, never class names, IDs, URL patterns, or framework globals. Frappe/ERPNext exists only in `fixtures/` as a benchmark. |
| AD-11 | **Three logical components, conversion in the extension** | Re-architecture 2026-11-08. Collector (extension, browser-bound reads) → Conversion engine (`@h2f/core`, pure TS) → CaptureDocument → Figma plugin (pure planner + thin `figma.*` adapter). Maximizes what can be built and tested on Fedora, because the Figma plugin runtime is macOS/Windows-only. |
| AD-12 | **File-based transfer only, no backend** | JSON file (primary) and clipboard (≤ 5 MB). A relay or other infrastructure is added only after the file workflow shows a concrete, documented limitation. |

### Architecture review notes (amendments proposed by the Lead Architect)

These amend the original brief and are reflected in `REQUIREMENTS.md`. Items needing a decision are in `OPEN_QUESTIONS.md`.

1. **Canvas alone cannot capture most images (critical).** Drawing a cross-origin `<img>` onto a `<canvas>` *taints* the canvas, and `toDataURL()` then throws a `SecurityError`. That covers CDN images, a separate asset domain, and most internal apps. Re-requesting with `crossOrigin="anonymous"` only works if the server sends CORS headers, which internal servers usually don't. **Amendment:** a three-tier asset pipeline: (1) canvas for same-origin, data:, and blob: images; (2) a **privileged fetch from the extension service worker**, which is not subject to page CORS when the extension holds host permission for that origin; (3) a raster fallback by cropping a tab screenshot. Canvas stays, but as one tier rather than the whole mechanism.
2. **Pasting JSON doesn't scale.** With embedded Base64 images, captures often reach 5–50 MB. Pasting that into a textarea freezes the plugin UI. **Amendment:** file import (picker or drag-and-drop) is the primary path. Paste is supported for small payloads only.
3. **Raw SVG `outerHTML` is often not self-contained.** Icons commonly depend on `currentColor`, CSS classes, and `<use href="#sprite-id">` references to elsewhere in the document. **Amendment:** the extractor must inline the computed paint styles and resolve `<use>` references before serializing, and it ships a raster fallback for each SVG.
4. **Viewport vs. document coordinates.** `getBoundingClientRect()` is viewport-relative. The extractor converts to document coordinates (adding scroll offsets). The renderer converts those to parent-relative coordinates, because Figma child positions are relative to the parent frame.

## 6. Scope — MVP (v1.0)

### 6.1 Chrome Extension (Extractor)
- One-click capture of the **current tab** (full scrollable document) from the extension popup, **or of a single picked element** (element picker).
- Opt-in, auto-suggested **expansion of inner scroll areas** (needed for app-shell layouts: admin dashboards, POS terminals, chat and mail clients), detected purely from computed `overflow` and scroll geometry.
- **`::before` / `::after` pseudo-elements** captured through temporary materialization (status dots, custom checkboxes, separators, decorative bars).
- **Icon fonts** (Font Awesome, Material Icons, etc.) rasterized per glyph.
- **RTL & Arabic:** per-text direction, physical alignment resolution (`start`/`end`), RTL scroll-coordinate normalization, Arabic-capable font chain.
- Recursive traversal of the rendered DOM, including open (and, where the API allows, closed) Shadow DOM and same-origin iframes.
- Per element: absolute geometry, background color, linear/radial gradients, borders (width/color/style per side), per-corner border radius, box shadows, opacity, overflow clipping, visibility.
- Per text run: content (with whitespace normalized per CSS `white-space`), font family stack, size, weight, style, line height, letter spacing, color, alignment, decoration, text-transform.
- Images: `<img>`, `<picture>`, CSS `background-image: url(...)`, and `<canvas>` when it isn't tainted, converted to Base64 through the three-tier pipeline.
- Inline `<svg>` serialized as self-contained SVG strings, plus a raster fallback.
- Stacking (paint) order preserved, so Figma layer order matches what the user sees.
- Output: one schema-versioned JSON file. The user can **download** it or **copy** it to the clipboard.
- Capture summary in the popup: node count, image count, payload size, warnings.
- Passwords always masked.

### 6.2 Figma Plugin (Renderer)
- Import JSON by file picker or drag-and-drop (primary), or by paste (≤ 5 MB).
- Schema validation with clear errors (bad JSON, unsupported schema version, missing assets).
- Creates one top-level frame per capture, sized to the captured document.
- Recreates boxes as frames/rectangles, text as editable text nodes, images as image fills, and SVGs as vector nodes, each at its exact absolute position.
- Font resolution: walks the CSS font stack, picks the nearest available weight and style, and falls back to `Inter`. Arabic-script text always uses an Arabic-capable family: the page's own stack first, then configurable defaults (initially Tajawal → Cairo), then Noto Sans Arabic.
- RTL text: right-edge anchoring, so font substitution doesn't shift right-aligned text, plus base-direction handling (per Spike S4).
- Progress indicator, plus a post-render report (nodes created, fonts substituted, failed nodes and assets).
- Meaningful layer names (e.g. `div#header.nav-bar`, `img.logo`).
- No network access (`networkAccess: none`).

## 7. Out of Scope (MVP)

| Item | Reason / Future |
|---|---|
| **Auto Layout** (Flexbox/Grid → Auto Layout) | AD-4. Candidate for v2. |
| **Custom / web font fetching or installation** | AD-5. Users install brand fonts in Figma themselves. |
| Figma Components, Variants, Styles, Variables / design tokens | v2: detect repeated patterns and extract styles |
| Interactive states (`:hover`, `:focus`, open dropdowns) | Only the state at capture time is captured |
| Animations, transitions, video playback | Static snapshot only; `<video>` → poster or current frame |
| Responsive / multi-breakpoint capture | Captured at the user's current viewport width (see OQ) |
| CSS transforms beyond translation (rotate, skew, 3D) | Captured as an axis-aligned bounding box plus a warning |
| Cross-origin iframe content | Placeholder rectangle plus a warning |
| Complex CSS: `clip-path`, `mask`, most `filter`s, conic/repeating gradients | Fallback (solid color or raster) plus a warning |
| Batch / multi-page crawling | One tab per capture |
| Two-way sync, Figma → HTML, code generation | Different product |
| Any server, cloud storage, or account system | AD-1/O5: local-only by design |
| Browsers other than Chromium-based (Chrome, optionally Edge) | Firefox/Safari extension APIs differ |
| Virtualized / infinite lists beyond what is currently rendered (virtualized data grids, infinite feeds) | Only rendered DOM exists to capture |
| Site-, framework-, or library-specific handling (selectors, class names, URL rules, framework globals) | Violates AD-10. Fidelity gaps are fixed with generic, style/geometry-based rules. |
| Arabic letter-joining across separate inline elements (a word split by `<mark>`, `<b>`, etc.) | Consequence of one layer per text node (AD-9). Fixed by merged text runs in v1.1. |
| Text redaction mode | v1.1 fast-follow (OQ-10) |

## 8. Assumptions & Dependencies

- Users run a recent Chrome (stable, ≥ the minimum version set in `REQUIREMENTS.md`).
- Users have Figma Desktop or Web with permission to run the plugin, either as a private org plugin or as an imported development plugin (see OQ on distribution).
- Pages render correctly in the user's browser at capture time. The tool captures what is rendered, not what the source code intends.
- Figma's bundled font library (including Google Fonts) is available to the plugin, and brand fonts may be available if the org has shared them.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Images fail to capture because of CORS/taint | High | High | Three-tier asset pipeline, placeholder plus warning on final failure |
| Text wraps differently in Figma because of font substitution | High | Medium | Single-line text uses auto-width, and multi-line text uses a fixed width. Substitutions are reported. |
| Huge payloads (many or large images) | Medium | High | Image dedupe, downscaling to 2× rendered size, JPEG for opaque photos, file import instead of paste |
| Figma's SVG parser rejects some SVGs | Medium | Low | Per-SVG raster fallback |
| App-shell layouts with inner scroll containers only capture the viewport | High (SaaS/admin apps) | High | Opt-in, auto-suggested scroll-area expansion (OQ-5) |
| Over-fitting to the benchmark (rules that pass Frappe but break other sites) | Medium | High | Generic benchmark set given equal weight (O8), CI guard against site-specific code (SYS-6), real public sites checked per release |
| **No macOS/Windows environment** (B-1): Figma plugin development, testing, and every publish require the macOS/Windows desktop app | Certain (today) | **High**: blocks real-Figma validation (R5) and distribution (R6) | Do everything else on Fedora with mocks clearly labelled (TST-7). Acquire a Windows VM or Mac access before R5. |
| **Fedora employees can't run the plugin** unless the Figma plan allows private org plugins (B-2) | Unknown | **High** for adoption | Verify the actual plan and test a private plugin in browser Figma on Fedora before committing to a distribution strategy |
| Figma renders Arabic/bidi text created through the Plugin API incorrectly (shaping, base direction) | Medium | **High** (AD-8 is blocking) | Spike S4 in P1, before renderer work. Pre-agreed workaround with directional marks. Escalation path in OQ R-5. |
| Substituted fonts shift right-aligned (RTL) text | High | Medium | Aligned-edge anchoring (PLG-R-9a) |
| Very large DOMs (10k+ nodes) slow capture or rendering | Medium | Medium | Pruning of non-visual wrappers, batched rendering with progress, documented limits |
| The extension's host permissions alarm security review | Medium | Medium | Optional host permissions requested at runtime, or a fixed allow-list of internal domains (OQ) |

## 10. Milestones (proposed)

> **Superseded (2026-11-08)** by the R0–R6 phase plan (architecture assessment for the Fedora environment):
> R0 Reconstruct & stabilise ✅ (see `docs/verification/R0.md`) · R1 S4-A ⏸ **deferred / not executed** (scheduling decision 2026-11-08) ·
> R2 Collector + engine · R3 Planner + adapter · R4 Assets · R5 Real-Figma validation (macOS/Windows) ·
> R6 Distribution & pilot. The table below is kept for history.

| Phase | Deliverable | Exit criteria |
|---|---|---|
| P0 Decisions & scaffolding | ✅ Decisions made. Monorepo, shared schema package, CI (incl. site-specific-code guard), generic fixture pages (incl. `rtl-arabic` and the universal benchmark pages), Dockerized Frappe v15 benchmark bench. | Schema v1 frozen, and both components build |
| P1 Technical spikes | S1: Tier-2 fetch with session cookies across origins. S2: `createNodeFromSvg` robustness (icon sprites, chart-library SVGs). S3: text wrap fidelity with fallback fonts. **S4: Arabic shaping, bidi, and base direction via the Plugin API.** | Spike reports with go/no-go. S4 resolves R-5. |
| P2 Extractor core | Traversal, geometry, box styles, text | Fixture JSON matches golden snapshots |
| P3 Renderer core | Frames, rectangles, text, fonts, layer order | Fixtures render within the fidelity tolerance |
| P4 Assets | Image pipeline (3 tiers), backgrounds, SVG plus fallback | Image/SVG fixtures pass, with failures reported |
| P5 Hardening & pilot | Performance limits, error reporting, packaging (unpacked extension + Figma dev plugin), pilot with 3–5 users | O1–O3, O7, and O8 met on the generic benchmark set **and** the 10 Frappe stress-test captures (5 views × EN/AR) |
