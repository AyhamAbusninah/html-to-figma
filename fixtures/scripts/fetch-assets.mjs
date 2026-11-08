#!/usr/bin/env node
// Downloads third-party (OFL / MIT / Apache-2.0) fonts used by the fixture pages
// into fixtures/assets/vendor/. The folder is git-ignored; run this once after cloning.
//
//   node fixtures/scripts/fetch-assets.mjs           # skip files that already exist
//   node fixtures/scripts/fetch-assets.mjs --force   # re-download everything
//
// Zero dependencies (Node >= 22: global fetch). Exits non-zero if any download fails.

import { mkdir, writeFile, stat, rename } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(HERE, "..", "assets", "vendor");
const FORCE = process.argv.includes("--force");

const GF = "https://raw.githubusercontent.com/google/fonts/main/ofl";
const JSD = "https://cdn.jsdelivr.net/npm";
const FA = `${JSD}/@fortawesome/fontawesome-free@6.5.2`;
const INTER = `${JSD}/@fontsource/inter@5.0.18/files`;
const CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** Resolve the current Material Symbols Outlined woff2 URL from the Google Fonts CSS API. */
async function materialSymbolsUrl() {
  const css = await (
    await fetch("https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined", {
      headers: { "user-agent": CHROME_UA },
    })
  ).text();
  const m = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/);
  if (!m) throw new Error("could not find woff2 URL in Google Fonts CSS");
  return m[1];
}

/** @type {{ path: string, urls: (string | (() => Promise<string>))[], minBytes?: number }[]} */
const ASSETS = [
  // Tajawal — static instances (OFL)
  { path: "fonts/tajawal/Tajawal-Regular.ttf", urls: [`${GF}/tajawal/Tajawal-Regular.ttf`] },
  { path: "fonts/tajawal/Tajawal-Medium.ttf", urls: [`${GF}/tajawal/Tajawal-Medium.ttf`] },
  { path: "fonts/tajawal/Tajawal-Bold.ttf", urls: [`${GF}/tajawal/Tajawal-Bold.ttf`] },
  { path: "fonts/tajawal/OFL.txt", urls: [`${GF}/tajawal/OFL.txt`], minBytes: 1000 },
  // Cairo — only a variable font exists upstream (slnt, wght 200–1000)
  { path: "fonts/cairo/Cairo-Variable.ttf", urls: [`${GF}/cairo/Cairo%5Bslnt,wght%5D.ttf`] },
  { path: "fonts/cairo/OFL.txt", urls: [`${GF}/cairo/OFL.txt`], minBytes: 1000 },
  // Noto Sans Arabic — variable (wdth, wght 100–900)
  {
    path: "fonts/noto-sans-arabic/NotoSansArabic-Variable.ttf",
    urls: [`${GF}/notosansarabic/NotoSansArabic%5Bwdth,wght%5D.ttf`],
  },
  { path: "fonts/noto-sans-arabic/OFL.txt", urls: [`${GF}/notosansarabic/OFL.txt`], minBytes: 1000 },
  // Inter — static Latin-subset woff2 (fontsource). Latin-only on purpose: Arabic must fall back.
  { path: "fonts/inter/Inter-400.woff2", urls: [`${INTER}/inter-latin-400-normal.woff2`] },
  { path: "fonts/inter/Inter-600.woff2", urls: [`${INTER}/inter-latin-600-normal.woff2`] },
  { path: "fonts/inter/Inter-700.woff2", urls: [`${INTER}/inter-latin-700-normal.woff2`] },
  { path: "fonts/inter/OFL.txt", urls: [`${GF}/inter/OFL.txt`], minBytes: 1000 },
  // Font Awesome Free 6.5.2 — solid webfont + core/solid CSS (CSS references ../webfonts/)
  { path: "fontawesome/css/fontawesome.min.css", urls: [`${FA}/css/fontawesome.min.css`], minBytes: 1000 },
  { path: "fontawesome/css/solid.min.css", urls: [`${FA}/css/solid.min.css`], minBytes: 100 },
  { path: "fontawesome/webfonts/fa-solid-900.woff2", urls: [`${FA}/webfonts/fa-solid-900.woff2`] },
  { path: "fontawesome/webfonts/fa-solid-900.ttf", urls: [`${FA}/webfonts/fa-solid-900.ttf`] },
  { path: "fontawesome/LICENSE.txt", urls: [`${FA}/LICENSE.txt`], minBytes: 1000 },
  // Material Symbols Outlined (Apache-2.0) — Google Fonts woff2, npm mirror as fallback
  {
    path: "material-symbols/MaterialSymbolsOutlined.woff2",
    urls: [materialSymbolsUrl, `${JSD}/material-symbols@0.27.0/material-symbols-outlined.woff2`],
  },
];

async function exists(p) {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

async function download(asset) {
  const dest = join(VENDOR, asset.path);
  if (!FORCE && (await exists(dest))) return { status: "skipped", bytes: (await stat(dest)).size };
  const errors = [];
  for (const candidate of asset.urls) {
    let url = "(unresolved)";
    try {
      url = typeof candidate === "function" ? await candidate() : candidate;
      const res = await fetch(url, { redirect: "follow", headers: { "user-agent": CHROME_UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < (asset.minBytes ?? 4096)) throw new Error(`suspiciously small (${buf.length} B)`);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest + ".part", buf);
      await rename(dest + ".part", dest);
      return { status: "downloaded", bytes: buf.length, url };
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  return { status: "failed", errors };
}

const results = [];
// Small fixed concurrency keeps it polite and deterministic in output order.
const queue = ASSETS.map((a, i) => ({ a, i }));
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const { a, i } = queue.shift();
      results[i] = { asset: a, ...(await download(a)) };
    }
  }),
);

let failed = 0;
for (const r of results) {
  const rel = relative(process.cwd(), join(VENDOR, r.asset.path));
  if (r.status === "failed") {
    failed++;
    console.error(`  FAIL  ${rel}\n        ${r.errors.join("\n        ")}`);
  } else {
    const kb = (r.bytes / 1024).toFixed(1).padStart(8);
    console.log(`  ${r.status === "skipped" ? "skip" : " get"}  ${kb} KB  ${rel}`);
  }
}
const got = results.filter((r) => r.status === "downloaded").length;
const skipped = results.filter((r) => r.status === "skipped").length;
console.log(`\nfetch-assets: ${got} downloaded, ${skipped} already present, ${failed} failed.`);
process.exit(failed ? 1 : 0);
