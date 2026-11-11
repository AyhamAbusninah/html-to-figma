# Technical Requirements & Acceptance Criteria — HTML-to-Figma

Status: v0.2 (2026-11-08). All decisions are recorded in `OPEN_QUESTIONS.md` §1. The keywords **MUST**, **MUST NOT**, **SHOULD**, and **MAY** follow RFC 2119.
Tags **[OQ-n]** point to the decision that a requirement implements. **[S4]** marks requirements whose final form depends on Spike S4 (R-5).

**Target:** any HTML page Chrome can render, in both **LTR** and **RTL (Arabic)** (§3.10). **Frappe/ERPNext is a stress-test benchmark only** (§3.12, §6). The engine contains no logic specific to it or to any other site (SYS-5).

ID prefixes: `SCH` schema · `EXT` extension · `PLG` plugin · `NFR` non-functional · `SEC` security · `TST` testing.

---

## 1. System & Repository

| ID | Requirement |
|---|---|
| SYS-1 | The codebase MUST be a TypeScript pnpm monorepo built with **Vite** **[OQ-14]**, with four packages: `packages/schema` (CaptureDocument contract: TypeBox source → JSON Schema, standalone validators, types), `packages/core` (conversion engine: pure `RawPageSnapshot → CaptureDocument`, no DOM lib), `packages/extension` (Chrome MV3: collector + UX), `packages/figma-plugin` (UI + main thread). Toolchain versions are pinned in `pnpm-lock.yaml` and installs MUST use `--frozen-lockfile`. |
| SYS-1a | **CaptureDocument is the only cross-component contract.** `RawPageSnapshot` (extension → engine) and plugin-internal render plans are internal and unversioned. Conversion runs in the extension, so the plugin stays a thin renderer (plan §3). |
| SYS-2 | Both components MUST import capture types from `packages/schema` only. Neither may define its own copy of the schema types. |
| SYS-3 | The only interface between the components is the capture JSON (§2). Neither component may depend on the other at runtime. |
| SYS-4 | `fixtures/` MUST contain static HTML test pages and their golden JSON captures (see §6). |
| SYS-5 | **Universal engine [SC-1]:** code in `packages/core`, `packages/extension` and `packages/figma-plugin` MUST NOT reference site-, framework-, or CSS-library-specific class names, IDs, selectors, attribute names, URL/path patterns, or JS globals. Every behavior MUST be derived from standard web APIs (DOM/flat-tree traversal, `getComputedStyle`, `getBoundingClientRect`, Range geometry, Fetch, Canvas) and expressed as rules over computed style and geometry. Values that are inherently names (icon-font family names in EXT-X-9, font alias and fallback tables in PLG-F-*) MUST live in one named, documented, configurable constants module, never inline in logic. |
| SYS-6 | CI MUST run `scripts/check-universal.mjs`, which fails the build if engine sources (`packages/extension/src`, `packages/figma-plugin/src`) contain benchmark-specific tokens (initially: `frappe`, `erpnext`, `\bdesk\b`, `awesomplete`) outside the constants module, or contain any `querySelector*`/`closest`/`matches` call whose selector is a class or ID literal. Exceptions require an inline `// h2f-universal-exempt: <reason>` comment and code review. |
| SYS-7 | Benchmark-specific material (Frappe bench Docker setup, login scripts, page URLs, expected node counts) MUST live only under `fixtures/` and test specs. |

---

## 2. Capture JSON Schema (v1.0.0)

### 2.1 Conventions

| ID | Requirement |
|---|---|
| SCH-1 | The root object MUST contain `schemaVersion` (semver string, `"1.0.0"`), `meta`, `assets`, and `root`. |
| SCH-2 | All lengths are **CSS pixels** (1 CSS px = 1 Figma unit). |
| SCH-3 | Every `rect` is in **document coordinates**, with the origin at the top-left of the captured root (the document, or the picked element in UF-3). Values are floats rounded to 2 decimals. |
| SCH-4 | Colors are `{ r, g, b, a }` with every channel in **0–1** (Figma-native), in sRGB. |
| SCH-5 | Image data is stored **once** in `assets.images` keyed by content hash. Nodes reference images by `assetId`. |
| SCH-6 | Base64 strings MUST NOT include a `data:` URI prefix. The MIME type goes in a separate `mime` field. |
| SCH-7 | Children arrays MUST be in **paint order**, back to front (index 0 is painted first and sits bottom-most in Figma). |
| SCH-8 | The plugin MUST accept any `1.x.y` version and reject any other major version (E-8). Adding fields is a minor version bump. Removing or changing fields is a major bump. |
| SCH-9 | A JSON Schema file (`capture.schema.json`) MUST be generated from or kept in sync with the TS types, and used for validation in both CI and the plugin. `pnpm schema:check` fails CI on any drift between `src/schema.ts` and the committed generated files. |
| SCH-10 | **Frozen baselines.** Each released schema version is frozen at `packages/schema/contract/capture-<version>.schema.json` and never edited. Compatibility tests MUST show that every sample document valid under each frozen 1.x baseline stays valid under the current schema and `validateCapture` (SCH-8: additive changes only within a major). |

### 2.2 Shape (normative TypeScript)

```ts
type RGBA = { r: number; g: number; b: number; a: number };         // 0–1
type Rect = { x: number; y: number; width: number; height: number }; // document coords

interface CaptureDocument {
  schemaVersion: "1.0.0";
  meta: {
    sourceUrl: string;            // with query string; fragment stripped
    title: string;
    capturedAt: string;           // ISO 8601
    captureMode: "page" | "element";
    lang: string;                 // <html lang>, e.g. "ar", "en"; "" if absent
    direction: "ltr" | "rtl";     // computed direction of the capture root
    viewport: { width: number; height: number };
    document: { width: number; height: number };    // == root.rect size
    devicePixelRatio: number;
    extractorVersion: string;
    userAgent: string;
    stats: { nodeCount: number; textCount: number; imageCount: number; svgCount: number; bytes: number };
    warnings: CaptureWarning[];
  };
  assets: { images: Record<string, ImageAsset> };
  root: FrameNode;
}

interface CaptureWarning {
  code: string;                   // e.g. "IMAGE_FETCH_FAILED", "IFRAME_CROSS_ORIGIN", "TRANSFORM_UNSUPPORTED"
  message: string;
  nodeId?: string;
  detail?: string;                // e.g. the URL
}

interface ImageAsset {
  mime: "image/png" | "image/jpeg" | "image/gif";
  data: string;                   // Base64, no prefix
  width: number;                  // pixel size of encoded data
  height: number;
  source: "canvas" | "fetch" | "screenshot";   // tier that produced it
  originalUrl?: string;
}

interface BaseNode {
  id: string;                     // unique within document, e.g. "n482"
  name: string;                   // readable layer name, e.g. "Button · Add to cart" (≤ 64 chars); CSS-style name in domPath
  domPath?: string;               // CSS-ish path, for debugging/report
  rect: Rect;
  opacity: number;                // 0–1, element's own opacity (not cumulative)
  blendMode?: string;             // Figma BlendMode enum value, omitted if NORMAL
}

interface FrameNode extends BaseNode {
  type: "FRAME";
  fills: Paint[];                 // bottom → top (CSS background layers reversed)
  strokes?: Border;
  radii?: { tl: number; tr: number; br: number; bl: number };
  effects?: Effect[];
  clipsContent: boolean;          // overflow != visible
  children: CaptureNode[];
}

interface TextNode extends BaseNode {
  type: "TEXT";
  characters: string;             // whitespace already normalized; text-transform NOT applied
  lineCount: number;              // number of line boxes in DOM (from Range.getClientRects)
  style: {
    fontFamilies: string[];       // CSS stack, unquoted, in order
    fontWeight: number;           // 100–900
    fontStyle: "normal" | "italic";
    fontSize: number;
    lineHeight: number | "normal";// px
    letterSpacing: number;        // px
    color: RGBA;
    direction: "ltr" | "rtl";     // computed `direction` of the parent element
    textAlign: "left" | "center" | "right" | "justify";   // physical; start/end already resolved (EXT-RTL-2)
    textDecoration: "none" | "underline" | "line-through";
    textCase: "none" | "upper" | "lower" | "title";
  };
}

interface ImageNode extends BaseNode {
  type: "IMAGE";
  assetId: string | null;         // null → placeholder (capture failed)
  scaleMode: "FILL" | "FIT" | "STRETCH";       // from object-fit: cover | contain | fill
  radii?: { tl: number; tr: number; br: number; bl: number };
}

interface SvgNode extends BaseNode {
  type: "SVG";
  svg: string;                    // self-contained SVG markup (see EXT-S-*)
  fallbackAssetId: string | null; // raster fallback
}

type CaptureNode = FrameNode | TextNode | ImageNode | SvgNode;

type Paint =
  | { type: "SOLID"; color: RGBA }
  | { type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL"; angleDeg?: number; stops: { position: number; color: RGBA }[] }
  | { type: "IMAGE"; assetId: string; scaleMode: "FILL" }; // backgrounds are pre-composited (EXT-I-8)

interface Border {
  top: Side; right: Side; bottom: Side; left: Side;
}
interface Side { width: number; color: RGBA; style: "solid" | "dashed" | "dotted" }

type Effect =
  | { type: "DROP_SHADOW" | "INNER_SHADOW"; color: RGBA; offset: { x: number; y: number }; radius: number; spread: number }
  | { type: "LAYER_BLUR" | "BACKGROUND_BLUR"; radius: number };
```

---

## 3. Chrome Extension (Extractor)

### 3.1 Platform & Permissions

| ID | Requirement |
|---|---|
| EXT-P-1 | MUST be Manifest V3, with a service worker background, a popup, and a content script injected on demand. |
| EXT-P-2 | MUST support Chrome stable ≥ 120 **[OQ-15]**. SHOULD work unmodified in Microsoft Edge. |
| EXT-P-3 | Permissions MUST be limited to `activeTab`, `scripting`, `downloads`, `clipboardWrite`, `storage`. |
| EXT-P-3a | **Release 0.2.0 permissions (2026-11-08 packaging audit):** `activeTab`, `scripting`, `downloads`, `clipboardWrite` + the EXT-P-4 allow-list. `storage` removed (unused). `optional_host_permissions` deferred to R4, when the Tier-2 fetch that needs it exists. `scripts/package-extension.mjs` fails the build on any other permission. |
| EXT-P-4 | Image host access **[OQ-2]**: (a) `host_permissions` MUST be exactly the allow-list `*://*.arkantechjo.com/*`, `*://localhost/*`, `*://127.0.0.1/*`, `*://*.localhost/*` (dev domains per R-1), granted at install. (b) `optional_host_permissions: ["<all_urls>"]`. **Revised 2026-11-10 (user decision):** the popup asks for it once, with the user's click on **Allow images from other sites**, shown on the Done screen when images came from screenshots or are missing (a prompt during Capture would block capture). Not granted → Tier 3. |
| EXT-P-5 | The content script MUST NOT be declared in `content_scripts` (no always-on injection). It is injected only on user gesture through `chrome.scripting.executeScript`. |
| EXT-P-6 | MUST detect restricted URLs (`chrome://`, `chrome-extension://`, `chromewebstore.google.com`, `view-source:`, PDF viewer) and disable capture with a clear message (E-1). |

### 3.2 Pre-capture

| ID | Requirement |
|---|---|
| EXT-C-1 | If "auto-scroll" is enabled, MUST scroll the document (and expanded scroll containers) in viewport-height steps, wait ≤ 500 ms per step for pending `<img>` loads, and stop at the end or after 30 s total. It then restores `scrollTo(0, 0)`. |
| EXT-C-2 | MUST wait for `document.fonts.ready` and for all in-viewport `<img>` elements to be `complete` (timeout 5 s) before walking. |
| EXT-C-3 | MUST record any DOM mutation during the walk (MutationObserver) and emit warning `DOM_MUTATED_DURING_CAPTURE` if one occurs. |
| EXT-C-4 | Any temporary DOM/style changes (auto-scroll, scroll-container expansion **[OQ-5]**, pseudo-element materialization **[OQ-7]**) MUST be fully reverted after capture, including on error (`try/finally`). |
| EXT-C-5 | **Scroll-container detection [OQ-5]:** when the popup opens, the extension MUST find elements with `overflow-y` (or `overflow-x`) of `auto`/`scroll` whose `scrollHeight − clientHeight > 50 px` and whose area is ≥ 15% of the viewport. If any exist, the "Expand inner scroll areas" option MUST be shown as suggested (with a count, e.g. "2 scroll areas found"). It stays **off by default**. |
| EXT-C-6 | **Scroll-container expansion [OQ-5]:** when enabled, for each detected container *and each of its ancestors up to `<body>`* that constrains height, the extension MUST set inline `overflow: visible; height: auto; max-height: none` with `!important` (saving the original `style` attribute value exactly), wait two animation frames for layout, then capture. Original `style` attributes MUST be restored byte-for-byte (EXT-C-4). The warning `SCROLL_AREAS_EXPANDED` (with count) MUST be added. |

### 3.3 Traversal & Filtering

| ID | Requirement |
|---|---|
| EXT-T-1 | MUST walk the **flat tree** (composed tree): light DOM, open shadow roots, closed shadow roots via `chrome.dom.openOrClosedShadowRoot()`, and `<slot>` assigned nodes in their rendered position. |
| EXT-T-2 | MUST skip any subtree whose root has `display: none`, and skip `<script>`, `<style>`, `<template>`, `<noscript>`, `<head>`, `<meta>`, `<link>`, and `<input type="hidden">`. |
| EXT-T-3 | Elements with `visibility: hidden` / `collapse` MUST NOT emit their own paint but MUST still be traversed (children can override visibility). |
| EXT-T-4 | Elements with `opacity: 0` and elements whose rect lies entirely outside the root rect MUST be skipped with their subtree. |
| EXT-T-5 | Zero-area elements (`width` or `height` = 0) MUST NOT emit paint unless `overflow` is `visible` and they have visible descendants. In that case they are traversed and their descendants are hoisted to the parent. |
| EXT-T-6 | **Pruning:** an element with no paint (transparent background, no border, no shadow, no clipping, opacity 1, normal blend) MUST NOT become a FrameNode. Its children are hoisted to the nearest emitted ancestor. This keeps Figma layer counts manageable. **[OQ-6]** |
| EXT-T-7 | **Same-origin iframes:** MUST traverse `contentDocument`, offsetting the iframe's rect plus its border and padding. **Cross-origin iframes:** emit a FrameNode placeholder (light gray fill) with warning `IFRAME_CROSS_ORIGIN`. |
| EXT-T-8 | **Paint order:** children MUST be ordered by simplified CSS stacking. Within a stacking context the order is: negative `z-index` positioned → non-positioned block/inline (DOM order) → `z-index: auto/0` positioned (DOM order) → positive `z-index` ascending. Elements that create a stacking context (positioned with z-index ≠ auto, opacity < 1, transform, filter, isolation) group their descendants. |
| EXT-T-9 | `position: fixed` and `position: sticky` elements MUST be captured at their rendered position after the scroll-to-top in EXT-C-1. A fixed element whose clip/stacking ancestor is the viewport MUST be hoisted to the root. *Implemented (0.4.0):* the capture scrolls to the top before the read, waits for the page's scroll handlers and the finite animations/transitions they start (≤ 1 s), and scrolls back to the user's position afterwards, also on error (AC-EXT-7). |
| EXT-T-10 | Hard limit: if the number of emitted nodes exceeds `MAX_NODES` (default 10,000, **[OQ-12]**), the capture MUST abort with error E-6, without silently truncating. |
| EXT-T-11 | **Pseudo-element materialization [OQ-7]:** before the walk, for every element whose `getComputedStyle(el, "::before" / "::after")` has `content` ≠ `none`/`normal` and that produces a visible box (non-zero size, or a background, border, or text): (1) inject one `<style data-h2f>` sheet that hides the pseudo-element on marked elements (`[data-h2f-pseudo~="before"]::before { content: none !important }`); (2) insert a `<span data-h2f-materialized>` as first/last child carrying the pseudo-element's full computed style (copied as inline style) and its resolved `content` text (string, `counter()`, `attr()`; `url()` → background image); (3) walk normally, so the span becomes regular nodes named `::before` / `::after`. All injected nodes, attributes, and styles MUST be removed afterwards (EXT-C-4). The per-capture limit is 5,000 materialized pseudo-elements; beyond that they are skipped with warning `PSEUDO_LIMIT`. |

### 3.4 Geometry

| ID | Requirement |
|---|---|
| EXT-G-1 | Element rect = `getBoundingClientRect()` + `(window.scrollX, window.scrollY)` − root origin. In RTL documents with horizontal overflow, see EXT-RTL-4. |
| EXT-G-2 | Text rect = `Range.selectNodeContents(textNode).getBoundingClientRect()`, converted the same way. `lineCount` = the number of distinct line tops in `Range.getClientRects()`. |
| EXT-G-3 | If the element has a non-translation `transform` (rotate/skew/scale ≠ 1/3D), the AABB from `getBoundingClientRect` MUST be used and warning `TRANSFORM_UNSUPPORTED` emitted. *Exception (0.4.0):* a mirroring transform (`scaleX(-1)`, `scaleY(-1)`, `rotate(180deg)`, `rotateY(180deg)`, on the element or an ancestor) is reproduced on the images, icon glyphs, backgrounds and SVGs inside it (pixels flipped when encoded, SVG content wrapped in a mirroring group); the warning is only emitted when the flipped element contains text. |
| EXT-G-4 | The root rect MUST equal `{0, 0, scrollWidth, scrollHeight}` of `document.scrollingElement` (page mode), or the picked element's rect (element mode). |

### 3.5 Visual Styles (from `getComputedStyle`)

| ID | Requirement |
|---|---|
| EXT-V-1 | **Colors:** MUST parse `rgb()`/`rgba()`. Any other computed color syntax (`oklch`, `lab`, `color()`, `color-mix`) MUST be converted to sRGB by painting a 1×1 canvas pixel and reading it back. `transparent` → omit the paint. |
| EXT-V-2 | **Background color** → `SOLID` paint. |
| EXT-V-3 | **Gradients:** `linear-gradient` and `radial-gradient` (single layer or multiple) → gradient paints with stops in 0–1. `repeating-*` and `conic-gradient` → `SOLID` of the first stop plus warning `GRADIENT_UNSUPPORTED`. |
| EXT-V-4 | **Borders:** per-side width, color, style. `double`/`groove`/`ridge`/`inset`/`outset` → `solid` plus a warning. Sides with style `none`/`hidden` or width 0 → width 0. |
| EXT-V-5 | **Border radius:** per corner, resolved to px (percentages resolved against the box and elliptical radii reduced to the horizontal value), clamped to `min(w, h) / 2`. |
| EXT-V-6 | **Box shadow:** every layer → `DROP_SHADOW`, or `INNER_SHADOW` for `inset`, preserving CSS order (renderer handles Figma ordering). |
| EXT-V-7 | **Opacity** → node `opacity`. **mix-blend-mode** → `blendMode` (mapped to Figma enum). Unmappable values → omitted plus a warning. *0.4.0:* an element with `mix-blend-mode` other than `normal` (≤ 3 viewports in area) is captured with a Tier 3 screenshot of its border box as an IMAGE named "… · blended" (children not repeated), warning `BLEND_MODE_RASTERIZED`, because the Copy to Figma SVG cannot express blend modes. Without a screenshot (no extension runtime, Tier 3 failed) the layers keep `blendMode`. |
| EXT-V-8 | **Overflow:** `hidden`/`clip`/`auto`/`scroll` on either axis → `clipsContent: true`. Scroll containers are captured at their current scroll offset unless expanded **[OQ-5]**. |
| EXT-V-9 | `filter: blur(r)` → `LAYER_BLUR`. `backdrop-filter: blur(r)` → `BACKGROUND_BLUR`. Other filters → ignored plus warning `FILTER_UNSUPPORTED`. |
| EXT-V-10 | `clip-path`, `mask`, and `-webkit-mask` → the element SHOULD be rasterized via Tier 3 (EXT-I-4) and emitted as an IMAGE node, plus warning `CLIP_MASK_RASTERIZED` **[OQ-8]**. If Tier 3 fails, the element is emitted unclipped with warning `CLIP_MASK_UNSUPPORTED`. *0.4.0:* `clip-path: inset(…)` (px/%, uniform `round`) is reproduced exactly as a clipping FRAME "clip · …" around the element's output, sized to the inset box intersected with the content's extent (so `inset(-9999px -9999px 0)` clips only the bottom edge); no frame when nothing visible is cut. Other shapes keep the rule above. |

### 3.6 Text

| ID | Requirement |
|---|---|
| EXT-X-1 | Each non-whitespace DOM `Text` node MUST produce one `TextNode`, styled from its parent element's computed style. **[OQ-11]** Exception: a text node that wraps and whose line boxes don't all share the edge their alignment pins (it starts or ends mid-line next to an inline element) MUST produce one `TextNode` per run of lines that do, each positioned at those line boxes, so no layer is drawn over its neighbors. |
| EXT-X-2 | Whitespace MUST be normalized per `white-space`: `normal`/`nowrap` collapse runs to single spaces and trim leading/trailing spaces at line edges, while `pre`/`pre-wrap`/`pre-line`/`break-spaces` preserve whitespace as specified. |
| EXT-X-3 | `text-transform` MUST be emitted as `textCase`, not applied to `characters`, so the text stays editable in Figma. Copy to Figma (EXT-O-7) has no text-transform in SVG, so it writes the transformed characters: upper, lower and capitalize (first letter of each word, CSS rules). |
| EXT-X-4 | `font-family` MUST be emitted as the full ordered stack with quotes removed. Generic families (`sans-serif`, `serif`, `monospace`, `system-ui`) are kept as the literal generic. |
| EXT-X-5 | `line-height: normal` → `"normal"`. Numeric or length values → resolved px. |
| EXT-X-6 | **Form controls:** `<input>`, `<textarea>`, and `<select>` MUST emit their box as a FrameNode plus a TextNode for the displayed value (or `placeholder` with its `::placeholder` color, or the selected `<option>` text). |
| EXT-X-7 | `<input type="password">` values MUST always be emitted as `•` × length. Raw password values MUST NEVER appear in the capture. |
| EXT-X-8 | Text hidden by `text-overflow: ellipsis` MUST be emitted as the visible truncated string with a trailing `…`, measured by Range rects. |
| EXT-X-9 | **Icon fonts [OQ-16]:** a text node is an *icon glyph* if (a) all of its characters are in the Private Use Area `U+E000–U+F8FF` / `U+F0000+` (primary, fully generic signal), or (b) its resolved font family is in the `ICON_FONT_FAMILIES` constant (SYS-5), initially `FontAwesome`, `Font Awesome *`, `Material Icons*`, `Material Symbols*`, `bootstrap-icons`, `icomoon`, `Glyphicons Halflings`, which is needed for ligature-based icon fonts that use ordinary letters. Icon glyphs MUST NOT emit a TextNode. Instead they are drawn onto a canvas at 2 × DPR using the page's own loaded font (`ctx.font` = the computed shorthand, `fillStyle` = color) and emitted as an IMAGE node. If canvas drawing fails (font not loaded), Tier 3 is used. Ligature icon fonts (Material) MUST be drawn with their ligature text. |

### 3.7 Images — Tiered Asset Pipeline

| ID | Requirement |
|---|---|
| EXT-I-1 | Sources in scope: `<img>` (using `currentSrc`, so `srcset`/`<picture>` resolve to the rendered candidate), CSS `background-image: url()` on elements, `<canvas>`, `<video>` (poster or current frame), and `<svg><image href>`. |
| EXT-I-2 | **Tier 1: canvas.** For same-origin, `data:`, and `blob:` sources (or CORS-clean images), draw onto an `OffscreenCanvas`/hidden `<canvas>` and encode. Catch the `SecurityError` on `toDataURL`/`convertToBlob` and fall through to Tier 2. |
| EXT-I-3 | **Tier 2: privileged fetch.** The content script sends `{url}` to the service worker, which runs `fetch(url, { credentials: "include" })`. Host permission for the origin is required. The response is decoded with `createImageBitmap`, re-encoded via `OffscreenCanvas`, and returned as Base64. Per-request timeout 10 s, concurrency ≤ 6. |
| EXT-I-4 | **Tier 3: screenshot crop.** **[OQ-8]** For images that fail Tiers 1–2: scroll the element into view, call `chrome.tabs.captureVisibleTab` (rate limit ≤ 2 calls/s), crop the element rect × DPR, and set `source: "screenshot"`. Batch multiple elements per screenshot. *0.4.0:* (a) elements inside fixed/sticky elements are cropped first, at the current scroll position; (b) then the fixed/sticky elements are hidden (visibility only, via a data attribute + adopted style sheet, restored afterwards; EXT-C-4) so headers and sticky bars never cover a crop; (c) after each scroll the page settles (≤ 800 ms of running animations) and each element is cropped at its live rect; (d) elements up to 4 viewports tall are stitched from consecutive screenshots. |
| EXT-I-5 | If all tiers fail: `assetId: null` and warning `IMAGE_FETCH_FAILED` with the URL. The renderer draws a placeholder. |
| EXT-I-6 | **Encoding:** output MUST be PNG, JPEG, or GIF only (Figma `createImage` support). WebP/AVIF/SVG-as-img/ICO MUST be re-encoded. Opaque images > 256×256 SHOULD be JPEG at quality 0.85, and images with alpha MUST be PNG. Animated GIFs keep their first frame only (re-encode to PNG). |
| EXT-I-7 | **Sizing:** encoded pixel size MUST NOT exceed `min(natural size, 2 × rendered size × max(1, DPR))` and MUST NOT exceed 4096 px on either side (Figma's limit). Larger images are downscaled proportionally. "High" quality option: cap at natural size (≤ 4096). |
| EXT-I-8 | **CSS backgrounds:** MUST be **pre-composited** in the extension onto a canvas the size of the element's padding box, honoring `background-size`, `background-position`, `background-repeat`, and `background-origin`, then emitted as a single `IMAGE` paint with `scaleMode: "FILL"`. Multiple `url()` layers are composited together. Gradient layers stay native (EXT-V-3). |
| EXT-I-9 | **Dedupe:** assets MUST be keyed by SHA-256 of the encoded bytes (`crypto.subtle.digest`), and identical images stored once. Fetches MUST be cached by URL within a capture. |
| EXT-I-10 | `<img>` `object-fit`: `cover` → `FILL`, `contain`/`scale-down` → `FIT`, `fill` (default) → `STRETCH`, `none` → `FIT` plus a warning. |

### 3.8 SVG

| ID | Requirement |
|---|---|
| EXT-S-1 | Each top-level inline `<svg>` MUST emit one `SvgNode` (nested SVGs stay inside the parent string). It is not traversed as frames. |
| EXT-S-2 | Before serializing, the SVG MUST be **cloned** (never mutate the live DOM) and made self-contained: (a) `<use href="#id">` replaced with a clone of the referenced `<symbol>`/element (including external-document sprites fetched through Tier 2 when same-origin); (b) the computed `fill`, `stroke`, `stroke-width`, `opacity`, `fill-opacity`, `stroke-opacity`, `color`, `font-*`, `display`, and `visibility` inlined as attributes on every shape element; (c) `currentColor` replaced with the resolved color; (d) explicit `width`/`height` set to the rendered size and `viewBox` preserved or synthesized; (e) `<image href>` inside SVG converted to a `data:` URI through the image pipeline; (f) `xmlns` present. |
| EXT-S-3 | `<script>`, event-handler attributes (`on*`), and `<foreignObject>` MUST be stripped from serialized SVGs. |
| EXT-S-4 | Each SvgNode MUST include a raster fallback (`fallbackAssetId`), produced by drawing the serialized SVG (as a data URL `Image`) on a canvas at 2× size. |
| EXT-S-5 | `<img src="*.svg">` SHOULD fetch the SVG text (Tier 1/2), emit an `SvgNode` (to keep vectors editable), and fall back to raster on failure. |
| EXT-S-6 | Serialized SVG strings larger than 512 KB MUST be emitted as raster only (IMAGE node) plus warning `SVG_TOO_LARGE`. |

### 3.9 Element Picker [OQ-4]

| ID | Requirement |
|---|---|
| EXT-E-1 | The popup MUST offer **Pick element** next to **Capture page**. Activating it injects an overlay (in a closed shadow root, `z-index: 2147483647`, `pointer-events: none` on the highlight) that outlines the hovered element and shows a label `tag.class  W × H`. |
| EXT-E-2 | Controls: click = select · `Esc` = cancel · `↑` / `↓` = select parent / first child of the current highlight · `Enter` = confirm the highlight. The overlay MUST NOT itself appear in the capture. |
| EXT-E-3 | Element mode sets `meta.captureMode = "element"`. The root rect is the element's border box, and all coordinates are rebased to it (EXT-G-4). Ancestor backgrounds visible behind a transparent element MUST be included as the root fill (the first non-transparent ancestor background color). |
| EXT-E-4 | Because the popup closes when the page gets focus, the picker MUST run entirely in the content script and report its result (and progress) through the service worker. The **Done** UI is then shown in an in-page panel (closed shadow root) with the same buttons as EXT-O-5. |

### 3.10 RTL & Arabic [OQ-18]

| ID | Requirement |
|---|---|
| EXT-RTL-1 | Every TextNode MUST record the computed `direction` of its parent element. `meta.direction` and `meta.lang` MUST be filled from the capture root and `<html lang>`. |
| EXT-RTL-2 | Computed `text-align` MUST be resolved to a physical value: `start` → `right` if direction is rtl else `left`; `end` → the opposite; `-webkit-left`/`-webkit-right`/`-webkit-center` → `left`/`right`/`center`; `match-parent` → the parent's resolved value. |
| EXT-RTL-3 | `characters` MUST be emitted in **logical order** (as in the DOM), never visually reordered. Bidi control characters present in the DOM (`U+200E/F`, `U+202A–202E`, `U+2066–2069`) MUST be preserved. |
| EXT-RTL-4 | **RTL horizontal overflow:** Chrome reports `scrollX ≤ 0` in RTL documents (0 at the right-hand start edge). Document X MUST be normalized so the left edge of the scrollable area is `x = 0`: `docX = rect.left + scrollX + (scrollWidth − clientWidth)` (for the scrolling element). Same rule for expanded RTL inner containers. |
| EXT-RTL-5 | For text containing Arabic-script characters (`U+0600–06FF`, `U+0750–077F`, `U+08A0–08FF`, `U+FB50–FDFF`, `U+FE70–FEFF`), a non-zero `letter-spacing` MUST be emitted as `0` with warning `ARABIC_LETTER_SPACING_IGNORED`, because tracking breaks cursive joining in Figma. |
| EXT-RTL-6 | `<input>`/`<textarea>` in RTL context MUST resolve their text alignment through EXT-RTL-2 (placeholder text included). |

### 3.11 Output & Popup UX

| ID | Requirement |
|---|---|
| EXT-O-1 | Popup states: `Idle → Preparing → Extracting → Processing assets → Done | Error`. Progress counts update at least every 500 ms. A **Cancel** button is available in all non-terminal states. |
| EXT-O-2 | **Download JSON** MUST save via `chrome.downloads` as `figma-capture_<hostname>_<YYYYMMDD-HHmmss>.json`. |
| EXT-O-3 | **Copy to clipboard** MUST be available only when the payload is ≤ 5 MB. Above that it is disabled with the tooltip "Too large to paste — use Download". |
| EXT-O-4 | The JSON MUST be minified. Size thresholds: warn at > 25 MB (E-4), hard fail at > 200 MB. |
| EXT-O-5 | The Done screen MUST show the stats from `meta.stats` and a list of warnings grouped by code with counts. |
| EXT-O-7 | **Copy to Figma (2026-11-10, extension 0.3.0):** the Done screen MUST offer **Copy to Figma**, which writes one SVG of the capture (built from the plugin's render plan, the page's own line breaks, `text/plain`) to the clipboard, so that Ctrl+V in Figma Web creates editable layers without the plugin or the desktop app. Text uses physical `text-anchor`, `y = line top + font-size` and PostScript-style font names; the layer tree stays flat so items can be selected and removed (measured rules: `docs/spikes/FIGMA_CLIPBOARD.md` §4b). The JSON file stays the contract for the plugin. |
| EXT-O-6 | Large captures MUST NOT be passed through `chrome.runtime` messaging as a single message if they exceed the message size limit. They MUST be assembled in the context that performs the download (e.g. chunked transfer or a Blob URL created in the content script's page context). |

### 3.12 Benchmark Coverage Matrix (informative)

This lists generic web patterns, the generic requirement that handles each, and where the benchmarks exercise it. The patterns are identified **only** by computed style and geometry (SYS-5). The "Frappe" column says where the stress-test benchmark happens to contain the pattern. It does not mean special handling.

| Generic pattern (detected via standard APIs) | Handled by | Generic fixture | Frappe stress test |
|---|---|---|---|
| In-document SVG sprites (`<use href="#id">` → hidden `<symbol>` sheet) | EXT-S-2(a) | `svg-icons` | Desk icons |
| Pseudo-element decorations (status dots, custom checkmarks, separators) | EXT-T-11 | `pseudo-elements`, `forms` | List indicator pills |
| `appearance: none` controls with data-URI backgrounds | EXT-I-2 (Tier 1) | `forms` | Checkboxes |
| Sticky / fixed headers and sidebars | EXT-T-9 | `stacking`, `landing-page` | Navbar, page head |
| Session-protected same-origin images | EXT-I-2 (Tier 1) | `images-same-origin` | Private attachments |
| Cross-origin images without CORS (CDN, object storage) | EXT-I-3 (Tier 2) | `images-cross-origin` | External attachment storage |
| Fixed-height app shell with independent inner scroll containers | EXT-C-5/6 | `app-shell` | POS view |
| Chart-library SVG with `<text>` labels (incl. Arabic) | EXT-S-*, S2, S4 | `dashboard`, `rtl-arabic` | Workspace charts |
| Client-side-rendered DOM, CSS-in-JS, portals | Standard traversal, EXT-C-2 | `spa` | Desk (SPA) |
| Web components / Shadow DOM | EXT-T-1 | `shadow-dom`, `spa` | — |
| Rich inputs, selects, editors | EXT-X-6 | `forms` | Form views |
| Live DOM updates during capture | EXT-C-3 | `spa` (toast timer) | Realtime list refresh |
| Virtualized rows | Out of scope | — | Report view |
| RTL documents (`dir="rtl"` anywhere in the tree) | §3.10, PLG-RTL-*, PLG-F-6 | `rtl-arabic`, `rtl-overflow` | Arabic UI language |
| Page web fonts that also exist in Figma (Google Fonts) | PLG-F-2 | `typography`, `rtl-arabic` | Web pages |

### 3.13 Extension Acceptance Criteria

- **AC-EXT-1** Given fixture `fixtures/pages/boxes.html` (nested divs with backgrounds, borders, radii, shadows), the capture JSON matches `fixtures/golden/boxes.golden.json` (rect tolerance ±0.5 px, color tolerance ±1/255).
- **AC-EXT-2** Given a page with a cross-origin `<img>` from a server without CORS headers and host permission granted, the image is captured with `source: "fetch"` and no `SecurityError` reaches the user.
- **AC-EXT-3** Given a page behind cookie-based login, protected images are captured via Tier 2 using the logged-in session (verified on ≥ 2 real internal apps, Spike S1).
- **AC-EXT-4** Given an SVG icon using `fill="currentColor"` and a `<use href="#icon-x">` sprite reference, the serialized SVG contains no `currentColor` and no `<use>`, and renders identically when opened standalone in Chrome.
- **AC-EXT-5** Given `<input type="password" value="secret">`, the string `secret` appears nowhere in the output file.
- **AC-EXT-6** Given an element with `display:none`, it and its subtree are absent. Given `visibility:hidden` on a parent with a `visibility:visible` child, only the child is present.
- **AC-EXT-7** Given a page scrolled to the middle when capture starts, the output is identical to capturing from the top (modulo EXT-C-3 mutations), and the user's scroll position is restored afterwards.
- **AC-EXT-8** After any capture (success, error, or cancel), the page's DOM and inline styles are byte-identical to before (verified via `outerHTML` snapshot in fixture tests).
- **AC-EXT-9** A page with 2,000 emitted nodes and 20 images completes capture in ≤ 10 s on a reference laptop (excluding auto-scroll time).
- **AC-EXT-10** The output validates against `capture.schema.json` for every fixture.
- **AC-EXT-11** Given `fixtures/pages/rtl-arabic.html` (`<html dir="rtl" lang="ar">`, default `text-align: start`), every TextNode not marked `data-align-explicit` and not inside an LTR or `dir="auto"` island has `direction: "rtl"` and `textAlign: "right"`, and `characters` equals the DOM text in logical order.
- **AC-EXT-12** Given `fixtures/pages/rtl-overflow.html` (RTL page, 2,048 px wide body in a 1,280 px viewport), all rects have `x ≥ 0`, and the right-most element's right edge equals `document.width` (±0.5 px).
- **AC-EXT-13** Given the status-dot badge in `fixtures/pages/pseudo-elements.html` (dot drawn by `::before`), the capture contains a node named `::before` with the dot's color and radius, and the page's DOM is unchanged after capture (AC-EXT-8).
- **AC-EXT-14** Given `fixtures/pages/app-shell.html` (two inner scroll containers) with expansion enabled, every item in both containers appears in the capture, and all original `style` attributes are restored exactly.
- **AC-EXT-15** Given a Font Awesome icon (`<i class="fa fa-check">`), the capture contains an IMAGE node (not a TEXT node) that visually matches the glyph.
- **AC-EXT-16** In element mode, picking a KPI card in `fixtures/pages/dashboard.html` produces a capture whose root rect is `{0, 0, w, h}` of that section, and the picker overlay is absent from the output.

---

## 4. Figma Plugin (Renderer)

### 4.1 Platform & Manifest

| ID | Requirement |
|---|---|
| PLG-P-1 | `manifest.json`: `editorType: ["figma"]`, `documentAccess: "dynamic-page"`, `networkAccess: { allowedDomains: ["none"] }`. |
| PLG-P-2 | Split into a UI iframe (file input, parsing, validation, progress) and a main thread (`figma.*` API calls). |
| PLG-P-3 | The main thread MUST use only async variants of the document APIs required by `dynamic-page` (e.g. `getNodeByIdAsync`). |

### 4.2 Import & Validation

| ID | Requirement |
|---|---|
| PLG-I-1 | MUST accept a `.json` file via file picker and drag-and-drop (primary), and a paste textarea (secondary, input > 5 MB rejected with a hint to use file import). |
| PLG-I-2 | MUST parse in the UI iframe and validate against `capture.schema.json` (structure, `schemaVersion` major = 1, every referenced `assetId` exists in `assets.images`). Errors MUST show a human-readable message plus the JSON path of the first error. |
| PLG-I-3 | Before rendering, MUST show a preview: source URL, captured date, document size, node/image/SVG counts, and the capture warnings count. |
| PLG-I-4 | MUST transfer the document to the main thread via `postMessage`. Payloads > 25 MB SHOULD be sent in chunks (nodes, then assets in batches) to keep the UI responsive. |

### 4.3 Rendering

| ID | Requirement |
|---|---|
| PLG-R-1 | MUST create one top-level `FrameNode` named `<title> — <hostname> — <YYYY-MM-DD HH:mm>`, sized to `meta.document`, with a white fill unless the root has its own fill. It is placed 100 px to the right of the right-most existing top-level node on the current page (or at (0,0) on an empty page). |
| PLG-R-2 | **Coordinates:** each Figma node's `x/y` MUST be `node.rect − parentNode.rect` (document → parent-relative). Size set via `resize(max(w, 0.01), max(h, 0.01))`. |
| PLG-R-3 | **Hierarchy:** `FRAME` nodes become Figma `FrameNode`s with `clipsContent` from the capture. Children are appended in array order (SCH-7) so later children render on top. |
| PLG-R-4 | **Fills:** `SOLID` → `SolidPaint` (alpha → `opacity` on the paint). Gradients → `GradientPaint` with `gradientTransform` computed from `angleDeg` per the CSS gradient-line definition. `IMAGE` → `figma.createImage(figma.base64Decode(data)).hash` in an `ImagePaint`. |
| PLG-R-5 | **Strokes:** `strokeAlign: "INSIDE"`, with per-side `strokeTopWeight`/`strokeRightWeight`/`strokeBottomWeight`/`strokeLeftWeight`. If side colors differ, use the color of the widest side and add a report warning. `dashed` → `dashPattern [3w, 3w]`, `dotted` → `[w, w]` with round caps. |
| PLG-R-6 | **Radii:** per-corner `topLeftRadius` etc. **Effects:** mapped 1:1, with the shadow order adjusted so the visual stacking matches CSS (first CSS shadow on top). |
| PLG-R-7 | **Images:** `IMAGE` nodes → `RectangleNode` with an `ImagePaint` (`FILL`/`FIT` as given; `STRETCH` → `scaleMode: "CROP"` with identity `imageTransform`). `assetId: null` → light gray rectangle with a 1 px dashed border, named `⚠ missing image`. Each asset is created once via `createImage`, and the hash is reused across nodes. |
| PLG-R-8 | **SVG:** `figma.createNodeFromSvg(svg)` and position/resize to the rect. On exception, use the raster fallback as an image rectangle and log `SVG_PARSE_FAILED`. |
| PLG-R-9 | **Text:** `TextNode` with `characters`, `fontName` (§4.4), `fontSize`, `lineHeight` (`"normal"` → `{unit:"AUTO"}`, else `{unit:"PIXELS"}`), `letterSpacing` (px), `fills` (color), `textAlignHorizontal`, `textDecoration`, and `textCase`. Sizing: `lineCount == 1` → `textAutoResize = "WIDTH_AND_HEIGHT"` (prevents spurious wrapping from wider fallback fonts); `lineCount > 1` → fixed width = rect width, `textAutoResize = "HEIGHT"`. |
| PLG-R-9a | **Edge anchoring:** for auto-width (single-line) text, after the width is known the node MUST be anchored by its aligned edge, so substituted fonts drift away from that edge rather than off it: `textAlign = right` → `x = rect.x + rect.width − node.width` · `center` → `x = rect.x + (rect.width − node.width) / 2` · `left` → `x = rect.x`. This is required for RTL, where most text is right-aligned. |
| PLG-R-10 | **Layer names** come from `node.name`. TextNodes are named from their first 40 chars of content. *0.5.0:* element layers get readable names from HTML semantics only (tag, ARIA role/label, alt/title, input type, visible text, readable class/id; generated and utility classes skipped): "Header", "Nav · Main menu", "Button · Add to cart", "Heading 2 · New arrivals", "Image · Leather tote", "Input · Email", "Product card", "Box". The CSS-style name ("div#main.card") moves to `domPath` (core/naming.ts). |
| PLG-R-11 | **Resilience:** an exception while creating any single node MUST be caught. The node is skipped (its children are attempted under the nearest ancestor), recorded in the report, and rendering continues. |
| PLG-R-12 | The render MUST be a single undo step (no `figma.commitUndo()` calls mid-render). After rendering, the root frame is selected and `figma.viewport.scrollAndZoomIntoView([root])` is called. |
| PLG-R-13 | **Progress:** the main thread MUST post progress to the UI at least every 200 nodes and yield (`await` a resolved promise / short timer) between batches so Figma stays responsive. |
| PLG-R-14 | If the plugin is closed mid-render, the partial root frame MUST be renamed with the suffix ` (incomplete)` (best effort, via `figma.on("close")`). |

### 4.4 Font Resolution

| ID | Requirement |
|---|---|
| PLG-F-1 | Before creating any text, MUST collect all unique `(fontFamilies, weight, style)` tuples, resolve each to a Figma `FontName` once, and `loadFontAsync` every resolved font exactly once (in parallel). |
| PLG-F-2 | **Resolution algorithm:** for each family in the CSS stack in order, if it exists in `figma.listAvailableFontsAsync()` (case-insensitive match), choose that family's style nearest to the requested weight (weight → style name map: 100 Thin, 200 Extra Light, 300 Light, 400 Regular, 500 Medium, 600 Semi Bold, 700 Bold, 800 Extra Bold, 900 Black, with "Italic" variants for italic). Tie-break toward bolder for weight ≥ 500, lighter otherwise. Style-name variations ("SemiBold", "Semibold", "Demi Bold") MUST be normalized. |
| PLG-F-3 | **Generic & system mapping** (applied when reached in the stack, for text *without* Arabic script): `system-ui`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif` → `Inter`; `serif` → `Noto Serif`; `monospace` → `Roboto Mono`. Family aliases from the `FONT_ALIASES` constant (SYS-5), initially `InterVariable`, `Inter var`, `Inter Variable` → `Inter`, are applied before lookup. Each is verified available, with `Inter` as the final fallback. |
| PLG-F-4 | **Last-resort fallback:** `Inter` at the nearest weight (`Noto Sans Arabic` for Arabic-script text, see PLG-F-6). If even that fails to load, `Inter Regular` / `Noto Sans Arabic Regular`. |
| PLG-F-5 | Every substitution where the first family in the stack wasn't used MUST be listed in the report as `Requested family weight style → Used family style (N text layers)`. Arabic substitutions that follow PLG-F-6 rule (1) are reported as informational, not as warnings. |
| PLG-F-6 | **Arabic font chain [OQ-18]:** if a text node contains any Arabic-script character (ranges in EXT-RTL-5), the whole node MUST use an *Arabic-capable* family (all of these also contain Latin glyphs, so mixed text is safe). Chain: (1) the first family in the CSS stack that is in `ARABIC_CAPABLE` and available in Figma; (2)–(3) the configurable `ARABIC_PREFERRED_DEFAULTS` constant (organization preference, initially `Tajawal`, `Cairo`); (4) `Noto Sans Arabic`. `ARABIC_CAPABLE` MUST be a configurable constant, initially: `Tajawal, Cairo, Noto Sans Arabic, Noto Kufi Arabic, Noto Naskh Arabic, IBM Plex Sans Arabic, Almarai, Readex Pro, Amiri`. A Latin-only family (e.g. `Inter`) MUST NEVER be applied to Arabic text, even if it is first in the stack, because Chrome only rendered Latin glyphs in it. Steps (2) and (3) apply only if the CSS stack contains them **or** `meta.lang` starts with `ar`. Otherwise skip to (4). Weight matching follows PLG-F-2 (e.g. Tajawal has no 600 → `Bold`). |

### 4.4a RTL Text [OQ-18] [S4]

| ID | Requirement |
|---|---|
| PLG-RTL-1 | For `direction: "rtl"` TextNodes, the plugin MUST set `textAlignHorizontal` from the resolved physical `textAlign` (normally `RIGHT`) and apply PLG-R-9a anchoring. |
| PLG-RTL-2 | **[S4] Base-direction marks:** if Spike S4 confirms that Figma infers paragraph direction from the first strong character, the plugin MUST prefix `U+200F` (RLM) to `characters` when `direction = rtl` and the first strong character is LTR (e.g. `INV-0042 فاتورة`, or text starting with a Latin brand name), and `U+200E` (LRM) in the mirror case. The mark MUST be invisible and MUST NOT be added when it isn't needed. |
| PLG-RTL-3 | **[S4]** If Spike S4 finds Arabic shaping or bidi rendering broken, PLG-RTL-* will be revised per R-5 options before P3 completes. |
| PLG-RTL-4 | Text layer names for RTL text MUST be the first 40 characters in logical order (Figma displays them correctly). |

### 4.5 Report

| ID | Requirement |
|---|---|
| PLG-RP-1 | After rendering, the UI MUST show: layers created, layers failed (with DOM path and error), font substitutions, missing images, SVG fallbacks, and the extractor warnings carried over from `meta.warnings`. |
| PLG-RP-2 | **Copy report** copies a plain-text version to the clipboard for bug reports. |

### 4.6 Plugin Acceptance Criteria

- **AC-PLG-1** Rendering `fixtures/golden/boxes.golden.json` produces nodes whose `absoluteBoundingBox` matches each source `rect` within ±0.5 px, *excluding* text height.
- **AC-PLG-2** Every `TEXT` capture node becomes an editable Figma `TextNode` (not vector, not image) with matching `characters`.
- **AC-PLG-3** A capture whose fonts are all unavailable renders fully in `Inter`, without throwing, and lists every substitution.
- **AC-PLG-4** A deliberately invalid SVG renders from its raster fallback, and the report lists it.
- **AC-PLG-5** A file with `schemaVersion: "2.0.0"` is rejected before rendering with message E-8. Nothing is created in the document.
- **AC-PLG-6** A 25 MB capture with 5,000 nodes renders in ≤ 60 s on Figma Desktop on a reference laptop, the UI keeps updating progress, and Figma never shows "plugin not responding".
- **AC-PLG-7** Pressing Ctrl/Cmd+Z once after a render removes the entire rendered frame.
- **AC-PLG-8** The plugin makes zero network requests (verified via manifest `networkAccess: none` and DevTools during a test render).
- **AC-PLG-9** Two images with identical bytes referenced by 30 nodes result in exactly one `figma.createImage` call.
- **AC-PLG-10** Rendering the `rtl-arabic` capture: every Arabic text layer uses Tajawal, Cairo, or Noto Sans Arabic (never Inter), letters are visibly joined (contextual forms), and mixed strings like `فاتورة INV-2026-00042` display in the same visual order as Chrome. (Verified visually against a Chrome screenshot during S4 and each release.)
- **AC-PLG-11** A right-aligned single-line text whose substituted font is 10% wider than the original keeps its right edge within ±1 px of the source `rect` right edge (PLG-R-9a).
- **AC-PLG-12** A text node with stack `InterVariable, Inter, sans-serif` containing Arabic renders in `Noto Sans Arabic`, or in Tajawal when `meta.lang = "ar"` (PLG-F-6), and the report marks it informational.

---

## 5. Non-Functional & Security

| ID | Requirement |
|---|---|
| NFR-1 | **Performance:** see AC-EXT-9 and AC-PLG-6. The extractor walk SHOULD use a single `getComputedStyle` call per element (reading every needed property from the one result) and avoid forced reflows inside the loop (no style writes during the walk). |
| NFR-2 | **Determinism:** capturing the same static page twice MUST produce identical JSON except `meta.capturedAt` (no random IDs: IDs are assigned in traversal order). |
| NFR-3 | **Observability:** both components MUST log to their own console with the prefix `[h2f]`. A debug toggle MAY include `domPath` on all nodes. |
| SEC-1 | No component may send any data off the user's machine. No analytics, telemetry, or remote logging. |
| SEC-2 | No remotely hosted code (MV3 enforces this). Builds are reproducible from the repo. |
| SEC-3 | The extension MUST run only on explicit user gesture (no background capture, no always-on content scripts). |
| SEC-4 | The capture file may contain sensitive internal data. The popup's Done screen MUST show a one-line notice: "This file contains page content. Handle it per internal data policy." **[OQ-10]**: local only; no retention mechanism in MVP; text-redaction mode planned for v1.1. |
| SEC-5 | Serialized SVG MUST be sanitized (EXT-S-3). The plugin MUST treat all capture strings as data, never evaluate them. |

---

## 6. Testing & Fidelity Verification

| ID | Requirement |
|---|---|
| TST-1 | **Unit tests (Vitest):** color parsing/conversion, gradient angle → transform, border-radius resolution, whitespace normalization, stacking-order sort, font resolution algorithm, coordinate rebasing. ≥ 90% line coverage on these pure modules. |
| TST-2 | **Extractor integration (Playwright + unpacked extension in Chromium):** each `fixtures/pages/*.html` is served by `fixtures/serve.mjs` (three origins), captured in a **1280×800** viewport (pages that render client-side wait for `html[data-ready=true]`), and diffed against `fixtures/golden/*.golden.json` with numeric tolerances. Volatile values (`blob:` URLs, locale-formatted `<input type=date>` text) are excluded from comparison. This runs in CI. |
| TST-3 | **Fixture set (minimum):** `boxes`, `typography`, `images-same-origin`, `images-cross-origin` (local second-origin server without CORS), `backgrounds`, `svg-icons` (currentColor + sprites), `stacking` (z-index, fixed, sticky), `overflow`, `forms`, `shadow-dom`, `iframes`, `app-shell` (inner scroll container), `pseudo-elements`, `icon-fonts`, **`rtl-arabic`** (Tajawal/Cairo/Noto Sans Arabic via local font files; start/end alignment; mixed Arabic + Latin + digits; Arabic placeholders; Arabic SVG chart labels), **`rtl-overflow`**. |
| TST-3a | **Frappe stress-test e2e (benchmark only, SYS-7):** a pinned Frappe/ERPNext **v15.124.5** bench (`fixtures/frappe-bench/`) with demo data, run in CI via Docker. Playwright logs in and captures each benchmark view in **English and Arabic** user language, and the captures are validated against the schema and smoke-checked (node counts within ±10% of baseline, no new error-level warnings). |
| TST-4 | **Renderer tests:** the main-thread render logic MUST be written against a thin `FigmaAdapter` interface so it can be unit-tested with a mock that records created nodes and properties. |
| TST-5 | **Fidelity self-check (dev mode):** after rendering, the plugin compares every created node's `absoluteBoundingBox` to its source `rect` and reports the % within ±2 px (this is metric O2). |
| TST-6 | **Benchmarks [OQ-13, SC-1]:** before each release, fidelity (TST-5) and visual notes are recorded in `docs/benchmarks.md` for two equally weighted sets. **(A) Universal set:** the generic fixtures `landing-page`, `spa`, `dashboard`, `ecommerce`, `rtl-arabic`, plus **3–5 real public websites** chosen per release (a marketing site, an SPA, an e-commerce page, an RTL news or e-commerce site). These are captured manually because live sites change. **(B) Frappe stress test:** Desk Workspace, List View, Form View, POS (scroll expansion on), and Custom Web Page, each in English (LTR) and Arabic (RTL), giving 10 captures. A fix that improves (B) MUST NOT regress (A). |
| TST-7 | **Verification levels (mandatory labelling).** Every test file and every verification report MUST state its level: **UNIT** (Node, pure logic) · **BROWSER INTEGRATION** (real Chromium, Playwright) · **FIGMA MOCK** (strict mock of the Plugin API: proves API usage, not rendering) · **REAL FIGMA** (Figma desktop on macOS/Windows, or browser Figma running a privately published build). A Figma-side feature MUST NOT be reported as validated until it passes at REAL FIGMA level. |
| TST-8 | **Phase gates.** Each implementation phase ends with explicit acceptance criteria, automated tests, and a verification report in `docs/verification/<phase>.md` (results, levels, evidence, open risks). The next phase starts only after review. |
| TST-9 | **Regression coverage for fidelity.** Every conversion change MUST add or update a measurable check against `fixtures/` pages or golden captures (`fixtures/golden/`, introduced in R2). |

---

## 7. Definition of Done (MVP)

1. All MUST requirements above are implemented, or explicitly deferred with a recorded decision.
2. All AC-EXT-* and AC-PLG-* pass.
3. TST-2 fixtures pass in CI. Both benchmark sets in TST-6 (universal set A and Frappe stress test B) achieve O2 (≥ 95% of boxes within ±2 px) and AC-PLG-10. SYS-6 passes.
4. Pilot users complete UF-1 without help from the developers.
5. The installation guide and the known-limitations list are published.
