# HTML to Figma (H2F): install the Chrome extension (Fedora)

Version 0.2.1 · internal Arkan Tech tool · not published to the Chrome Web Store.

## Install (once)

1. Get the extension folder, either way:
   - **Folder:** `release/html-to-figma-extension-0.2.1/` from a local build, or
   - **ZIP:** unpack it to a folder you'll keep (Chrome loads the extension from that folder every time it starts):
     ```bash
     mkdir -p ~/h2f && unzip -o html-to-figma-extension-0.2.1.zip -d ~/h2f/html-to-figma-extension-0.2.1
     ```
2. Open Google Chrome and go to **`chrome://extensions`**.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the folder that contains `manifest.json`
   (e.g. `~/h2f/html-to-figma-extension-0.2.1`).
5. "HTML to Figma (H2F) 0.2.1" appears in the list. Click the puzzle icon in the toolbar and **pin** it.

Don't delete or move the folder afterwards, or Chrome will disable the extension. To update, replace the folder
contents and click the ↻ reload button on the extension's card.

## Capture a page

1. Open any website (public or behind your company login) and wait until it has loaded.
2. Click the **H2F** toolbar icon, then **Capture page**.
3. On success you'll see the page size, direction (LTR/RTL), node count, and a short **Not captured yet** list.
4. Click **Download JSON**. The popup confirms "Saved to your Downloads folder as `figma-capture_<site>_<time>.json`".
   **Copy to clipboard** is available for files up to 5 MB.

## Permissions (why each one)

| Permission | Why |
|---|---|
| `activeTab` | Read the tab you clicked the icon on, only when you click. Works on any website. |
| `scripting` | Inject the capture script into that tab on demand (no always-on scripts) |
| `downloads` | Save the JSON file |
| `clipboardWrite` | "Copy to clipboard" |
| Host access: `*.arkantechjo.com`, `localhost`, `127.0.0.1`, `*.localhost` | Company and local development sites (approved allow-list). Not needed for capturing other sites; `activeTab` covers those. |

The extension sends nothing anywhere. The file stays on your machine.

## Changes in 0.2.1

- Wrapped text that starts or ends next to a link, bold word or label tag no longer overlaps its neighbors in Figma:
  its lines are split into separate text layers where needed (plain paragraphs stay one layer). Arabic and Latin.

## Limitations of 0.2.1

- **Images, SVG icons/charts, canvas, video and iframes** become marked placeholder layers (coming in a later release).
- Not captured yet: gradients, CSS background images, `::before/::after` decorations, "…" truncation.
  Every capture lists what was skipped.
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
