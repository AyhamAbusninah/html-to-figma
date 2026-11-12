# HTML to Figma (H2F): install the Chrome extension (Fedora)

Version 0.5.0 · internal Arkan Tech tool · not published to the Chrome Web Store.

## Install (once)

1. Get the extension folder, either way:
   - **Folder:** `release/html-to-figma-extension-0.5.0/` from a local build, or
   - **ZIP:** unpack it to a folder you'll keep (Chrome loads the extension from that folder every time it starts):
     ```bash
     mkdir -p ~/h2f && unzip -o html-to-figma-extension-0.5.0.zip -d ~/h2f/html-to-figma-extension-0.5.0
     ```
2. Open Google Chrome and go to **`chrome://extensions`**.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the folder that contains `manifest.json`
   (e.g. `~/h2f/html-to-figma-extension-0.5.0`).
5. "HTML to Figma (H2F) 0.5.0" appears in the list. Click the puzzle icon in the toolbar and **pin** it.

Don't delete or move the folder afterwards, or Chrome will disable the extension. To update, replace the folder
contents and click the ↻ reload button on the extension's card.

## Capture a page and paste it into Figma

1. Open any website (public or behind your company login) and wait until it has loaded.
2. Click the **H2F** toolbar icon, then **Capture page**.
3. On success you'll see the page size, direction (LTR/RTL), node count, and a short **Not captured yet** list.
4. Click **Copy to Figma**. In a Figma file in the browser (or the desktop app): click the canvas, press **Esc**,
   then **Ctrl+V**. The page arrives as a frame with editable text and shapes; click a section to select it,
   double-click (or Ctrl+click) to reach items inside it, and press Delete to remove anything.
   No Figma plugin and no desktop app are needed. Boxes come in as shapes inside groups (not auto-layout frames).
5. Optional: click **Copy styles** and paste next to the page. You get the page's colors and text styles as named
   swatches and samples; select one and use **Create style** in Figma's right panel.

## Or save the JSON (for the Figma plugin)

1. Click **Download JSON**. The popup confirms "Saved to your Downloads folder as `figma-capture_<site>_<time>.json`".
   **Copy JSON** is available for files up to 5 MB.

## Permissions (why each one)

| Permission | Why |
|---|---|
| `activeTab` | Read the tab you clicked the icon on, only when you click. Works on any website. |
| `scripting` | Inject the capture script into that tab on demand (no always-on scripts) |
| `downloads` | Save the JSON file |
| `clipboardWrite` | "Copy to clipboard" |
| Host access: `*.arkantechjo.com`, `localhost`, `127.0.0.1`, `*.localhost` | Company and local development sites (approved allow-list). Not needed for capturing other sites; `activeTab` covers those. |
| *Optional:* read images on all sites | Asked only if you click **Allow images from other sites** after a capture. Lets the extension download images that other websites don't share with the page, at full quality. Without it, those images are cropped from screenshots. You can remove it any time on the extension's card (Details → Site access). |

The extension sends nothing anywhere. The file stays on your machine.

## Changes in 0.5.0

- **Readable layer names** in Figma: "Header", "Nav · Main menu", "Button · Add to cart", "Heading 2 · New
  arrivals", "Image · Leather tote", "Product card" instead of CSS class names.
- **Copy styles:** a second button copies a board with the page's colors (named swatches, most used first) and its
  type scale (a sample of the page's own text for each font, weight and size). Paste it next to the page, select a
  swatch or sample, and create Figma styles from it.
- **Form fields:** text inside inputs, selects and buttons sits where it does on the page (it was a few pixels high);
  textarea text starts at the top and keeps its line breaks.
- **"…" truncation:** text the page cuts with an ellipsis comes in as the visible part followed by "…", editable.
- **Google fonts kept:** pages using any Google font (Manrope, Jost, Cormorant Garamond…) keep it in Figma with the
  exact weight, instead of falling back to Inter.
- **Letter spacing:** Figma's paste ignores letter spacing, so **Match letter spacing** (on by default, under Copy to
  Figma) recreates it with invisible hair spaces sized for each font. Untick it for clean text that is easier to
  retype. Spaced layers are named with their value, e.g. "THE NEW SEASON · tracking 5.88px".
- **Videos and canvases** that read back blank (hardware-decoded video, WebGL) use the poster or a screenshot instead
  of an empty image. Thin outlines drawn with `box-shadow` (outlined buttons, focus rings) come in as borders.

## Changes in 0.4.0

- **Images and icons:** photos, logos, inline SVG icons (editable vectors in Figma), canvas and video frames.
  Images from other sites are downloaded by the extension (company hosts, or all sites after **Allow images from
  other sites**) or cropped from screenshots of the page.
- **Gradients and CSS background images** (linear and radial gradients, background size/position/repeat).
- **`::before`/`::after` decorations** (badges, dots, separators, numbered steps) and **icon fonts** (Font Awesome,
  Material Symbols, Bootstrap Icons…).
- **Captured as seen from the top** even if you scrolled: fixed and sticky headers sit at the top of the page, bars
  that only appear on scroll are left out, and your scroll position is restored.
- **Screenshot crops** are never covered by fixed headers or sticky bars, and images taller than the window are joined
  from two screenshots.
- **Mirrored images and icons** (CSS `scaleX(-1)`), **`clip-path: inset()`** clipping, and capitalized text
  (`text-transform: capitalize`) come in as on the page. Blocks that rely on CSS blend modes come in as a picture.

## Changes in 0.3.0

- **Copy to Figma:** paste a captured page straight into Figma (Ctrl+V) as editable layers, Arabic included,
  without the plugin or the desktop app.

## Changes in 0.2.1

- Wrapped text that starts or ends next to a link, bold word or label tag no longer overlaps its neighbors in Figma:
  its lines are split into separate text layers where needed (plain paragraphs stay one layer). Arabic and Latin.

## Limitations of 0.5.0

- Not captured yet: the page's own (html/body) background image, repeating and conic gradients (first color), list
  bullets (`::marker`), multi-line clamps (`-webkit-line-clamp`), rotation and skew (bounding box only), CSS masks and
  clip-path shapes other than `inset()`. Every capture lists what was skipped.
- A wrapped paragraph arrives as a group of one-line text layers: Figma's SVG import can't create a multi-line text
  layer.
- Images taller than four windows or wider than the window can't be cropped from screenshots; allow images from other
  sites to download them instead.
- Carousels and scroll-linked effects are copied as they look at the top of the page. Hover states, open menus and
  popups aren't captured yet.
- Sections sized from the window (e.g. a hero as tall as the screen) keep the size of the window you captured in.
- With **Match letter spacing** on, spaced text contains invisible hair spaces: retyping a word removes its spacing.
- Blocks that use CSS blend modes come in as pictures, not editable layers.
- Pages Chrome protects can't be captured: `chrome://` pages, the Chrome Web Store, the built-in PDF viewer.
  Local `file://` pages need **Details → Allow access to file URLs** on the extension card.
- **Figma:** the plugin that imports the JSON needs the Figma **desktop app (macOS/Windows)** to load as a development
  plugin. It hasn't been verified in real Figma yet. On Fedora you can inspect the JSON, but you can't import it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Chrome doesn't allow extensions to capture this page." | Expected on chrome://, Web Store, and PDF pages. Open a normal web page. |
| Capture button disabled | You're on a restricted page (see above). |
| Error on a `file://` page | Enable **Allow access to file URLs** on the extension card. |
| "Capture failed" | Open **Technical details** in the popup and include them in your report. |
| Extension shows "Errors" on chrome://extensions | Click it, copy the message, and report it. |
