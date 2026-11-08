# User Flows — HTML-to-Figma

Status: v0.2 (2026-11-08). All flow decisions are made (`OPEN_QUESTIONS.md` §1). `[OQ-x]` points to the decision behind a step.

Actors: **User** (designer/engineer), **Extension** (Chrome Extractor: popup, content script, service worker), **Plugin** (Figma Renderer: UI iframe plus main thread).

---

## UF-0 — One-time Setup

**Extension**
1. **Pilot [OQ-9]:** user unzips the release and loads it via `chrome://extensions` → Developer mode → **Load unpacked**. (After the pilot this moves to enterprise force-install or an unlisted Web Store item.)
2. User pins the extension icon to the Chrome toolbar.
3. **[OQ-2]** Images on `*.arkantechjo.com` and local dev hosts (`localhost`, `127.0.0.1`, `*.localhost`) work with **no prompt**, because they are granted at install. Only the first capture that needs images from another origin (e.g. a public site's image CDN or a SaaS app's object storage) shows a prompt such as "Allow HTML-to-Figma to read `bucket.s3.amazonaws.com`?". The user clicks **Allow** once per origin.

**Plugin**
1. **Pilot [OQ-9]:** in Figma Desktop, user goes to **Plugins → Development → Import plugin from manifest…** and selects `manifest.json` from the release zip. (After the pilot this moves to a private org plugin, if the Figma plan allows it.)
2. No font installation needed: **Tajawal, Cairo, Noto Sans Arabic**, and **Inter** are all Google Fonts that ship with Figma.

---

## UF-1 — Primary Flow: Capture a Page and Render It in Figma

**Preconditions:** The user is logged into the target page in Chrome, and the page is fully loaded.

### Part A: Capture (Chrome)

| Step | User action | System response |
|---|---|---|
| A1 | Navigates to the page and opens the exact state to capture (tab selected, filters applied, and so on) | — |
| A2 | Clicks the extension icon | Popup opens in **Idle** state and shows the page title, URL, viewport size, and capture options |
| A3 | *(Optional)* Adjusts options: ☐ Auto-scroll to load lazy content · ☐ Expand inner scroll areas **[OQ-5]** · Image quality (Standard / High) | Options are remembered per user. If inner scroll areas are detected (e.g. on a dashboard with a fixed app shell), the expand option is highlighted: "💡 2 scroll areas found — expand to capture all content?" (still off until the user ticks it). |
| A4 | Clicks **Capture page** | Popup → **Preparing**. Content script is injected (`activeTab` + `scripting`). If auto-scroll is on, it scrolls the page in steps, waits for images to load, then returns to the top. |
| A5 | Waits | Popup → **Extracting**: "Reading layout… 1,240 elements". The DOM walk collects geometry, styles, and text. |
| A6 | Waits | Popup → **Processing assets**: "Images 14 / 22 · SVG 37". Tiered image capture runs, and SVGs are serialized. |
| A7 | — | Popup → **Done**. Summary: `1,240 nodes · 22 images · 37 vectors · 6.8 MB`, plus a collapsible **Warnings (3)** list (e.g. "2 images could not be fetched, captured from screenshot", "1 cross-origin iframe skipped"). |
| A8 | Clicks **Download JSON** (primary) or **Copy to clipboard** (enabled only ≤ 5 MB) | File saved as `figma-capture_<hostname>_<YYYYMMDD-HHmmss>.json` in Downloads, or toast "Copied 1.2 MB". |

### Part B: Render (Figma)

| Step | User action | System response |
|---|---|---|
| B1 | Opens a Figma design file and goes to the target page | — |
| B2 | Runs **Plugins → HTML-to-Figma** | Plugin window opens with a drop zone ("Drop capture .json here or **Browse**") and a collapsed "Paste JSON" tab |
| B3 | Drags the `.json` file onto the drop zone (or browses to it, or pastes it) | UI parses and validates against the schema. It shows a preview card: source URL, capture date, document size `1440 × 5210`, node/image counts, and the schema version. |
| B4 | *(Optional)* Chooses placement: ◉ New frame on current page (default) · ○ New page | — |
| B5 | Clicks **Render** | Progress: "Loading fonts (6)… → Creating layers 640 / 1,240 → Applying images 22 / 22" |
| B6 | — | A top-level frame named `Page Title — hostname — 2026-11-08 14:32` appears to the right of existing content. The viewport zooms to it and it is selected. |
| B7 | Reviews the **Render report** in the plugin | `1,238 layers created · 2 failed` · **Fonts substituted:** "Helvetica Neue 500 → Inter Medium", "Arkan Sans 400 → Inter Regular" · **Warnings** carried over from capture · button **Copy report** |
| B8 | Closes the plugin and edits the design | Text is editable, images are image fills, icons are vectors, and layers are named after DOM elements |

**Postconditions:** One new top-level frame exists. Nothing else in the file was modified. A single undo (Ctrl/Cmd+Z) removes the whole render (see REQUIREMENTS PLG-R-12).

### Sequence (happy path)

```
User        Popup          ContentScript        ServiceWorker         Plugin UI        Plugin Main
 │ click ──►│                    │                    │                    │                 │
 │          │── inject+start ───►│                    │                    │                 │
 │          │◄── progress ───────│ walk DOM           │                    │                 │
 │          │                    │── fetchAsset(url)─►│ fetch w/ session   │                 │
 │          │                    │◄── base64 ─────────│                    │                 │
 │          │◄── capture JSON ───│                    │                    │                 │
 │◄─ Done ──│                    │                    │                    │                 │
 │ download │                    │                    │                    │                 │
 │ ════════════════════ user moves file into Figma ═══════════════════════►│                 │
 │                                                                         │ parse+validate  │
 │ Render ────────────────────────────────────────────────────────────────►│── postMessage ─►│
 │                                                                         │◄─ progress ─────│ load fonts
 │                                                                         │◄─ report ───────│ create nodes
```

---

## UF-2 — Capture an Authenticated Internal Page

Same as UF-1, but this flow highlights the authentication guarantees.

1. User signs into any web app (internal tool, SaaS dashboard, e-commerce admin) in their normal Chrome profile, e.g. via SSO.
2. User opens the page and runs UF-1 Part A.
3. Protected images served from the page's own origin are already loaded with the user's session cookie, so they are captured directly through the canvas (Tier 1). Images on other origins (CDNs, object storage, avatar services) are fetched by the extension service worker (Tier 2) with the user's cookies for that origin. **No credentials are entered into the tool.**
4. If a protected image still fails (e.g. a token-in-header API that cookies can't satisfy), the extension falls back to cropping a screenshot of the visible tab (tier 3) and records a warning.

> ⚠ Behavior in step 3 must be confirmed by **Spike S1** against our real internal apps (see OQ-1).

---

## UF-3 — Capture a Selected Element Only **[OQ-4]**

1. In the popup, the user clicks **Pick element** instead of **Capture page**.
2. The popup closes. The page shows a hover highlight overlay with the element's tag and size (e.g. `div.form-section 1120 × 340`).
3. User clicks the target element. `Esc` cancels, `↑` selects the parent, `↓` the first child, and `Enter` confirms the highlighted element.
4. The extension captures only that subtree. Coordinates are rebased so the element's top-left is (0, 0).
5. Progress and the **Done** panel (Download / Copy, warnings) appear in an in-page panel at the corner of the page, since the popup has closed.
6. The flow continues from UF-1 Part B. The resulting Figma frame is sized to the element.

---

## UF-6 — Capture an Arabic (RTL) Page **[OQ-18]**

**Preconditions:** the page renders right-to-left, e.g. an Arabic news site, an Arabic-localized SaaS app, or any page with `dir="rtl"` on `<html>` or on any ancestor.

1. User runs UF-1 exactly as for an English page. No extra option is needed, because direction is detected automatically.
2. The popup Done screen shows `Direction: RTL · Language: ar` in the summary.
3. In Figma, the rendered frame is mirrored like the page: sidebar on the right, labels right-aligned, and the layout matches Chrome because every box sits at its measured position.
4. Arabic text layers use **Tajawal / Cairo** (whichever the page uses) or **Noto Sans Arabic** as the fallback. Mixed strings (e.g. `فاتورة INV-2026-00042`) display in the same order as in Chrome.
5. The render report lists font mappings, e.g. "InterVariable 400 → Tajawal Regular (Arabic text, 214 layers) ℹ".
6. Known limitation: if a single Arabic word is split across inline elements (e.g. a search highlight), the letters on either side of the split are not joined in Figma. This is listed in the Known Limitations doc and fixed in v1.1.

---

## UF-4 — Error and Edge Scenarios

| ID | Trigger | What the user sees | Recovery |
|---|---|---|---|
| E-1 | Restricted page (`chrome://`, Chrome Web Store, built-in PDF viewer, `file://` without permission) | Popup: "This page can't be captured by Chrome extensions." Capture button disabled. | Open the content in a normal web page |
| E-2 | Images on an origin outside the allow-list (`*.arkantechjo.com`, local dev) **[OQ-2]** | Chrome permission prompt for that origin. If denied: "Images from `<origin>` will be captured from screenshots (lower resolution)." | Grant permission, or continue (Tier 3 used) |
| E-3 | Some images fail all tiers | Done state with warning "3 images could not be captured, replaced by gray placeholders" listing the URLs | Accept, or re-capture after scrolling the images into view |
| E-4 | Capture exceeds the soft size limit (> 25 MB) | Warning: "Large capture (48 MB). Figma import may be slow." with the option **Re-capture with Standard image quality** | Lower image quality, or capture a single element (UF-3) |
| E-5 | Page mutates during capture (live data, auto-refresh) | Possible inconsistent geometry. Warning shown if the DOM changed during the walk (MutationObserver). | Re-capture, or pause the page's live updates |
| E-6 | Capture exceeds the hard element limit **[OQ-12]** | "Page has 18,400 visible elements (limit 10,000). Capture a section instead." | UF-3 element pick |
| E-6a | Virtualized table / infinite list captured | Only the rows currently rendered appear (no error) | Known limitation. Scroll to the rows you need before capturing. |
| E-7 | Invalid / truncated JSON in plugin | "File is not valid JSON (unexpected end at byte 1,048,576). The file may be truncated." Render disabled. | Re-download / re-copy |
| E-8 | Schema version mismatch | "Capture made with schema v2.0. This plugin supports v1.x. Please update the plugin." | Update the plugin |
| E-9 | Font unavailable | Render continues with a fallback. The report lists each substitution. | Install the font in Figma, then re-render |
| E-10 | SVG rejected by Figma's parser | That vector is rendered from its raster fallback and listed in the report | Accept, or redraw manually |
| E-11 | Individual node creation throws | Node skipped, rendering continues, failure listed in the report with its DOM path | Report to the tool maintainers with **Copy report** |
| E-12 | User closes the plugin mid-render | Partially rendered frame remains and is named with the suffix `(incomplete)` | Delete it and re-render |

---

## UF-5 — Iterate on a Capture

1. User spots something missing (e.g. a dropdown was closed).
2. User opens the dropdown in Chrome, then captures again (UF-1).
3. User renders the new capture into the same Figma page. It's placed next to the previous frame (frames never overwrite each other).
4. User copies the needed layers between frames manually.

> Merging and diffing captures is out of scope for the MVP.
