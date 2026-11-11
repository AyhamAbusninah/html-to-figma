# Fixtures

Static, deterministic HTML pages that the extractor is tested against (`SYS-4`, `TST-2`, `TST-3`).
They are generic web pages with no product-specific markup, because the converter is meant to work
on any site.

## Run

```sh
node fixtures/scripts/fetch-assets.mjs && node fixtures/scripts/gen-images.mjs && node fixtures/serve.mjs
```

Then open <http://localhost:4173/pages/index.html>.

| Script | What it does |
|---|---|
| `scripts/fetch-assets.mjs` | Downloads third-party fonts (OFL / Apache-2.0 / MIT) into `assets/vendor/`, which is git-ignored: Tajawal 400/500/700, Cairo (variable), Noto Sans Arabic (variable), Inter 400/600/700 (Latin subset), Font Awesome Free 6.5.2 (solid + CSS), and Material Symbols Outlined. It skips files that already exist; pass `--force` to download everything again. Exits non-zero if any download fails. |
| `scripts/gen-images.mjs` | Regenerates the test images in `assets/img/`. They are committed, so you only need to run this after changing the script. Output is byte-identical between runs. PNG and SVG need no dependencies. JPEG, WebP, GIF and ICO need ImageMagick, and the WebM clip needs ffmpeg; if a tool is missing, that format is skipped with a note. |
| `serve.mjs` | A static server with no dependencies, running on three origins (below). Exports `start()` for Playwright. |
| `scripts/check-links.mjs` | Smoke test. Starts the server, fetches every page, and checks that every local asset URL resolves (`src`, `srcset`, CSS `url()`, `srcdoc`, linked CSS). It also checks the `/login` + `/protected` flow and that path traversal is blocked. Pass `--external` to test a server that is already running. |

### Origins

| Origin | Role |
|---|---|
| `http://localhost:4173` | Main origin. Pages load from here. |
| `http://127.0.0.1:4174` | Second origin, with **no CORS headers**. It is on the extension's host allow-list. `GET /login` sets the cookie `h2f_session=ok; SameSite=Lax`. `GET /protected/<file>` serves `assets/<file>` only when that cookie is present, and returns 401 otherwise. |
| `http://127.0.0.2:4175` | Third origin, with no CORS headers. It is **not** on the allow-list, so it exercises the optional-permission path. On macOS, run `sudo ifconfig lo0 alias 127.0.0.2 up` first. Without it, the server logs a warning and runs only the other two origins. |

Every origin serves `/pages/*` and `/assets/*`, responds with `Cache-Control: no-store` and correct MIME types, and supports byte ranges (needed for seeking `<video>`). You can override the ports with `H2F_PORT_MAIN`, `H2F_PORT_SECOND` and `H2F_PORT_THIRD`. When the ports are not the defaults, the cross-origin URLs inside served HTML are rewritten to match. Set `H2F_LOG=1` to log requests.

```js
import { start } from "./fixtures/serve.mjs";
const server = await start({ quiet: true });          // or { ports: { main: 0, second: 0, third: 0 } }
// server.origins.main, server.origins.second, server.origins.third (null if unavailable)
await server.close();
```

## Pages

Each page starts with an HTML comment that lists its **purpose**, the **requirement IDs** it exercises, and the **expected capture behaviour** for a human verifier to check. Elements of interest have a `data-testid`.

| Page | Exercises | Key requirements |
|---|---|---|
| `boxes.html` | Backgrounds in rgba, oklch, lab, color-mix and currentColor; per-side borders (dashed, dotted, double, groove, hidden); per-corner, percentage and elliptical radii; multiple and inset box-shadows; opacity; mix-blend-mode; blur, backdrop and unsupported filters; rotate, skew and translate transforms; zero-size wrappers; `display:none`; a `visibility:hidden` parent with a visible child; `opacity:0`; an off-screen element | EXT-V-1…9, EXT-T-2…6, EXT-G-3, AC-EXT-1, AC-EXT-6 |
| `typography.html` | Sizes and weights 100–900; italic; line-height normal, number and px; letter-spacing; text-transform; decoration; alignment including start/end; every white-space mode; wrapping; ellipsis; inline runs; a missing first font; generic families | EXT-X-1…5, EXT-X-8, PLG-F-* |
| `images-same-origin.html` | srcset (w and x descriptors); `<picture>` with WebP; every object-fit value; rounded and circular images; data: and blob: URLs; JPEG, animated GIF, alpha PNG/WebP, ICO and SVG-as-img; dedupe; a 404 image; a lazy image 3000 px down; canvas; video poster and current frame | EXT-I-1, 2, 5, 6, 7, 9, 10, EXT-C-1 |
| `images-cross-origin.html` | No-CORS images from the second and third origins; `crossorigin` without CORS; a cross-origin CSS background and SVG; a cookie-protected image; a tainted canvas | EXT-I-2…5, EXT-I-8, EXT-P-4, AC-EXT-2, AC-EXT-3 |
| `backgrounds.html` | background-size, position, repeat (including space and round), origin and clip (including text); layered url + gradient; linear and radial gradients; repeating and conic gradients (unsupported, so they fall back); SVG and data: backgrounds | EXT-I-8, EXT-V-3 |
| `svg-icons.html` | currentColor; CSS-class styling; a hidden `<symbol>` sprite with `<use href>` and `xlink:href`; viewBox-only and no-viewBox sizing; nested SVG; `<text>`; `<image href>`; `<filter>`; `<img src=*.svg>`; `<script>`, `on*` and `<foreignObject>` (all must be stripped) | EXT-S-1…6, AC-EXT-4, SEC-5 |
| `stacking.html` | Negative, auto and positive z-index where DOM order differs from paint order; stacking contexts from opacity, transform, z-index and isolation; a fixed header; a sticky subheader; a long page | EXT-T-8, EXT-T-9, AC-EXT-7 |
| `overflow.html` | overflow hidden and clip; rounded clipping; scrolled `overflow:auto` boxes (Y and X); overflow-x only; clip-path and mask (rasterised) | EXT-V-8, EXT-V-10 |
| `forms.html` | Value vs placeholder; `::placeholder` colour; password masking (`secret-password-123` must never appear); hidden inputs; textarea; select and multi-select; native and `appearance:none` checkboxes and radios; a toggle; buttons; disabled states; range, date, number and colour inputs | EXT-X-6, EXT-X-7, AC-EXT-5 |
| `shadow-dom.html` | Open and closed roots; named, default and fallback slots; unassigned slot content; nested shadow roots; `::slotted`; `::part` | EXT-T-1 |
| `iframes.html` | srcdoc iframes; a same-origin `src` iframe; border + padding offsets; a scrolled iframe; a cross-origin iframe (placeholder) | EXT-T-7 |
| `app-shell.html` | A `100vh; overflow:hidden` shell with a fixed sidebar and two inner scroll containers (48 product tiles and 30 cart lines) | EXT-C-5, EXT-C-6, AC-EXT-14 |
| `pseudo-elements.html` | ::before and ::after with strings, `counter()`, `attr()`, `url()`, empty decorative boxes, status-dot pills, breadcrumb separators, quotes and checkbox marks; a clearfix (ignored) | EXT-T-11, AC-EXT-8, AC-EXT-13 |
| `icon-fonts.html` | Font Awesome solid; Material Symbols ligatures; a Private Use Area glyph without an icon class; text next to icons | EXT-X-9, AC-EXT-15 |
| `page-effects.html` | A fixed header and a bar shown only after scrolling; a mirrored image and icon (`scaleX(-1)`); a section clipped with `clip-path: inset(-9999px -9999px 0)`; `text-transform: capitalize`; a block that relies on `mix-blend-mode`; a 1200 px tainted canvas (Tier 3 stitching) | EXT-T-9, AC-EXT-7, EXT-I-4, EXT-G-3, EXT-V-10, AC-EXT-8 |
| `rtl-arabic.html` | `dir=rtl lang=ar`; Tajawal, Cairo and Noto Sans Arabic; an Inter-first stack; start/end and explicit alignment; wrapping; mixed-direction strings; Arabic-Indic digits; bidi control characters; a word split across `<mark>`; Arabic letter-spacing; Arabic inputs and placeholders; an LTR island and code block; `dir=auto`; an SVG chart with Arabic labels; a table | EXT-RTL-1…6, PLG-F-6, AC-EXT-11, AC-PLG-10, AC-PLG-12 |
| `rtl-overflow.html` | An RTL document 2048 px wide (2000 px content) with labelled left and right edge markers and a ruler | EXT-RTL-4, AC-EXT-12 |
| `landing-page.html` | Benchmark: a marketing page with a sticky blurred nav, a hero with photo + gradient, a features grid, testimonials, a pricing table, an FAQ, a CTA band and a footer | All of §3 |
| `spa.html` | Benchmark: client-rendered UI on an empty body, CSS-in-JS with hashed classes, a portal modal, a toast, tabs and a web component. Wait for `html[data-ready=true]` before capturing. | EXT-C-2, EXT-C-3, EXT-T-8, EXT-T-9 |
| `dashboard.html` | Benchmark: KPI cards with sparklines, SVG bar and line charts, a table with a sticky header in a scroll box, status pills, an avatar group and progress bars | EXT-S-*, EXT-V-8, EXT-C-5 |
| `ecommerce.html` | Benchmark: a product grid with srcset and lazy images, rotated sale badges, struck-through prices, SVG star ratings (half star via gradient), a filter sidebar, a static hover-state card and a cart badge | EXT-I-*, EXT-G-3, EXT-S-2 |

The page layouts assume a **1280 × 800** viewport, which the Playwright harness should pin. Pages use only local assets and contain no randomness or time-dependent content. The one exception is the `blob:` URL string in `images-same-origin.html`, which changes on every load; goldens must not compare it.

## Golden captures

Golden JSON captures (`*.golden.json`, compared with rect tolerance ±0.5 px and colour tolerance ±1/255) will be added here once the extractor exists (TST-2, AC-EXT-1).

## Known limitations of the fixtures

- No AVIF image: the ImageMagick build used here has no AVIF encoder.
- The Material Symbols font from Google Fonts is a static instance, so `ms-filled` (`'FILL' 1`) renders outlined in Chrome. The capture should match what Chrome shows.
- In `images-cross-origin.html`, the protected image usually shows as broken *in the page* even after `/login`. The cookie is `SameSite=Lax` and this is a cross-site subresource request. The extension's Tier 2 fetch is what is under test.
- Inter is a Latin-only subset on purpose, so Arabic text in an Inter-first stack falls back.
