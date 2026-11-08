#!/usr/bin/env node
// Generates the deterministic test images in fixtures/assets/img/ (committed to the repo).
//
//   node fixtures/scripts/gen-images.mjs
//
// PNG + SVG are produced with zero dependencies (node:zlib). JPEG / WebP / GIF / ICO need
// ImageMagick (`magick` or `convert`); the WebM clip needs `ffmpeg`. Formats whose tool is
// missing are skipped with a note (the committed copies stay in place).
//
// Every raster carries big labels drawn with a built-in 5×7 bitmap font plus quadrant
// colours and coloured corner markers, so crops (object-fit, background-position) and
// srcset candidate selection are visible in screenshots and visual diffs.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "assets", "img");
mkdirSync(OUT, { recursive: true });
const TMP = mkdtempSync(join(tmpdir(), "h2f-img-"));

// ---------------------------------------------------------------- tool detection
function has(cmd, args = ["-version"]) {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const MAGICK = has("magick") ? "magick" : has("convert") ? "convert" : null;
const FFMPEG = has("ffmpeg") ? "ffmpeg" : null;
const written = [];
const skipped = [];

// ---------------------------------------------------------------- PNG encoder
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(img) {
  const opaque = img.isOpaque();
  const bpp = opaque ? 3 : 4;
  const stride = img.w * bpp;
  const raw = Buffer.alloc(img.w * img.h * bpp);
  for (let i = 0, j = 0; i < img.data.length; i += 4) {
    raw[j++] = img.data[i];
    raw[j++] = img.data[i + 1];
    raw[j++] = img.data[i + 2];
    if (!opaque) raw[j++] = img.data[i + 3];
  }
  // Adaptive per-row filter (None / Sub / Up / Paeth), minimum-sum heuristic.
  const out = Buffer.alloc((stride + 1) * img.h);
  const cand = [0, 1, 2, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < img.h; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    const prev = y ? raw.subarray((y - 1) * stride, y * stride) : null;
    let best = 0;
    let bestSum = Infinity;
    [0, 1, 2, 4].forEach((f, k) => {
      const c = cand[k];
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? row[x - bpp] : 0;
        const b = prev ? prev[x] : 0;
        const cc = prev && x >= bpp ? prev[x - bpp] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 4) {
          const p = a + b - cc;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
        }
        const v = (row[x] - pred) & 0xff;
        c[x] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) (bestSum = sum), (best = k);
    });
    out[y * (stride + 1)] = [0, 1, 2, 4][best];
    cand[best].copy(out, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(out, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 5×7 bitmap font
const G = {
  "0": [" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  "2": [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
  "3": ["#####", "   # ", "  #  ", "   # ", "    #", "#   #", " ### "],
  "4": ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "],
  "5": ["#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "],
  "6": ["  ## ", " #   ", "#    ", "#### ", "#   #", "#   #", " ### "],
  "7": ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
  "8": [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
  "9": [" ### ", "#   #", "#   #", " ####", "    #", "   # ", " ##  "],
  A: [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  B: ["#### ", "#   #", "#   #", "#### ", "#   #", "#   #", "#### "],
  C: [" ### ", "#   #", "#    ", "#    ", "#    ", "#   #", " ### "],
  D: ["#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "],
  E: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
  F: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#    "],
  G: [" ### ", "#   #", "#    ", "# ###", "#   #", "#   #", " ####"],
  H: ["#   #", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  I: [" ### ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  J: ["  ###", "   # ", "   # ", "   # ", "   # ", "#  # ", " ##  "],
  K: ["#   #", "#  # ", "# #  ", "##   ", "# #  ", "#  # ", "#   #"],
  L: ["#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "# # #", "#   #", "#   #", "#   #"],
  N: ["#   #", "#   #", "##  #", "# # #", "#  ##", "#   #", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  P: ["#### ", "#   #", "#   #", "#### ", "#    ", "#    ", "#    "],
  Q: [" ### ", "#   #", "#   #", "#   #", "# # #", "#  # ", " ## #"],
  R: ["#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"],
  S: [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  V: ["#   #", "#   #", "#   #", "#   #", "#   #", " # # ", "  #  "],
  W: ["#   #", "#   #", "#   #", "# # #", "# # #", "# # #", " # # "],
  X: ["#   #", "#   #", " # # ", "  #  ", " # # ", "#   #", "#   #"],
  Y: ["#   #", "#   #", " # # ", "  #  ", "  #  ", "  #  ", "  #  "],
  Z: ["#####", "    #", "   # ", "  #  ", " #   ", "#    ", "#####"],
  "-": ["     ", "     ", "     ", "#####", "     ", "     ", "     "],
  ".": ["     ", "     ", "     ", "     ", "     ", " ##  ", " ##  "],
  ":": ["     ", " ##  ", " ##  ", "     ", " ##  ", " ##  ", "     "],
  "/": ["    #", "    #", "   # ", "  #  ", " #   ", "#    ", "#    "],
  "@": [" ### ", "#   #", "# ###", "# # #", "# ###", "#    ", " ####"],
  " ": ["     ", "     ", "     ", "     ", "     ", "     ", "     "],
};

// ---------------------------------------------------------------- raster canvas
class Img {
  constructor(w, h, bg = [0, 0, 0, 0]) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    if (bg[3]) this.fillRect(0, 0, w, h, bg);
  }
  isOpaque() {
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i] !== 255) return false;
    return true;
  }
  /** Source-over blend of colour c=[r,g,b,a(0..255)] with coverage k (0..1). */
  blend(x, y, c, k = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const sa = ((c[3] ?? 255) / 255) * k;
    if (sa <= 0) return;
    const da = this.data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let ch = 0; ch < 3; ch++) {
      this.data[i + ch] = Math.round((c[ch] * sa + this.data[i + ch] * da * (1 - sa)) / oa);
    }
    this.data[i + 3] = Math.round(oa * 255);
  }
  fillRect(x0, y0, w, h, c) {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y0 + h); y++)
      for (let x = Math.max(0, x0); x < Math.min(this.w, x0 + w); x++) this.blend(x, y, c);
  }
  /** Fill using a function (x, y) -> colour. */
  paint(fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.blend(x, y, fn(x, y));
  }
  /** Anti-aliased disc (4×4 supersampling on the edge). */
  circle(cx, cy, r, c) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r - 1) this.blend(x, y, c);
        else if (d <= r + 1) {
          let n = 0;
          for (let sy = 0; sy < 4; sy++)
            for (let sx = 0; sx < 4; sx++)
              if (Math.hypot(x + (sx + 0.5) / 4 - cx, y + (sy + 0.5) / 4 - cy) <= r) n++;
          this.blend(x, y, c, n / 16);
        }
      }
  }
  ring(cx, cy, r, t, c) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const k = Math.max(0, Math.min(1, r - d + 0.5)) * Math.max(0, Math.min(1, d - (r - t) + 0.5));
        if (k > 0) this.blend(x, y, c, k);
      }
  }
  /** Filled triangle via barycentric test (no AA; fine for markers). */
  triangle(ax, ay, bx, by, cx, cy, c) {
    const minX = Math.floor(Math.min(ax, bx, cx)), maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.floor(Math.min(ay, by, cy)), maxY = Math.ceil(Math.max(ay, by, cy));
    const s = (px, py, x1, y1, x2, y2) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const d1 = s(x + 0.5, y + 0.5, ax, ay, bx, by);
        const d2 = s(x + 0.5, y + 0.5, bx, by, cx, cy);
        const d3 = s(x + 0.5, y + 0.5, cx, cy, ax, ay);
        const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) this.blend(x, y, c);
      }
  }
  textWidth(str, scale) {
    return str.length * 6 * scale - scale;
  }
  /** Draw text with the 5×7 font; (x, y) is the top-left unless align = "center". */
  text(str, x, y, scale, c, align = "left") {
    str = str.toUpperCase();
    const w = this.textWidth(str, scale);
    let ox = Math.round(align === "center" ? x - w / 2 : align === "right" ? x - w : x);
    const oy = Math.round(align === "center" ? y - (7 * scale) / 2 : y);
    for (const ch of str) {
      const g = G[ch] ?? G[" "];
      for (let gy = 0; gy < 7; gy++)
        for (let gx = 0; gx < 5; gx++)
          if (g[gy][gx] === "#") this.fillRect(ox + gx * scale, oy + gy * scale, scale, scale, c);
      ox += 6 * scale;
    }
  }
  /** Text on a rounded-ish dark pill for legibility. */
  label(str, cx, cy, scale, fg = [255, 255, 255, 255], bg = [17, 24, 39, 200]) {
    const w = this.textWidth(str.toUpperCase(), scale) + scale * 4;
    const h = 7 * scale + scale * 4;
    const x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
    const r = h / 2;
    // Stadium shape: distance to the horizontal centre segment, 1px anti-aliased edge.
    const x1 = x + r, x2 = x + w - r, yc = y + r;
    for (let py = y - 1; py <= y + h + 1; py++)
      for (let px = x - 1; px <= x + w + 1; px++) {
        const qx = Math.max(x1, Math.min(x2, px + 0.5));
        const d = Math.hypot(px + 0.5 - qx, py + 0.5 - yc);
        const k = Math.max(0, Math.min(1, r - d + 0.5));
        if (k > 0) this.blend(px, py, bg, k);
      }
    this.text(str, cx, cy, scale, fg, "center");
  }
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [0, 1, 2].map((i) => Math.round(lerp(c1[i], c2[i], t))).concat(255);
function hsl(h, s, l, a = 255) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255), a];
}

// ---------------------------------------------------------------- image recipes
/** "Photo-like" opaque picture: sky gradient, hills, sun, quadrant tints, numbers 1–4,
 *  coloured corner markers and a caption. */
function photo(w, h, caption, { hue = 210 } = {}) {
  const img = new Img(w, h, [255, 255, 255, 255]);
  const top = hsl(hue, 60, 45), bottom = hsl((hue + 40) % 360, 75, 82);
  img.paint((x, y) => mix(top, bottom, y / (h - 1)));
  img.circle(w * 0.72, h * 0.3, Math.min(w, h) * 0.12, [255, 214, 102, 255]);
  // Two hill bands (sine curves).
  img.paint((x, y) => {
    const y1 = h * (0.62 + 0.06 * Math.sin((x / w) * Math.PI * 2.2));
    const y2 = h * (0.75 + 0.05 * Math.sin((x / w) * Math.PI * 3.1 + 1.3));
    if (y > y2) return [34, 102, 68, 255];
    if (y > y1) return [76, 145, 92, 255];
    return [0, 0, 0, 0];
  });
  // Quadrant tints + numbers.
  const quads = [
    [0, 0, [239, 68, 68, 70], "1"],
    [1, 0, [34, 197, 94, 70], "2"],
    [0, 1, [59, 130, 246, 70], "3"],
    [1, 1, [234, 179, 8, 70], "4"],
  ];
  const qw = Math.floor(w / 2), qh = Math.floor(h / 2);
  const ns = Math.max(2, Math.floor(Math.min(qw, qh) / 18));
  for (const [qx, qy, tint, n] of quads) {
    img.fillRect(qx * qw, qy * qh, qx ? w - qw : qw, qy ? h - qh : qh, tint);
    img.text(n, qx * qw + qw / 2, qy * qh + qh / 2, ns, [255, 255, 255, 235], "center");
  }
  // Crosshair at the centre.
  img.fillRect(Math.floor(w / 2) - 1, 0, 2, h, [255, 255, 255, 140]);
  img.fillRect(0, Math.floor(h / 2) - 1, w, 2, [255, 255, 255, 140]);
  img.ring(w / 2, h / 2, Math.min(w, h) * 0.08, Math.max(2, Math.min(w, h) / 120), [255, 255, 255, 230]);
  // Corner markers: TL magenta, TR cyan, BL orange, BR lime.
  const m = Math.max(8, Math.round(Math.min(w, h) / 12));
  img.triangle(0, 0, m, 0, 0, m, [217, 70, 239, 255]);
  img.triangle(w, 0, w - m, 0, w, m, [6, 182, 212, 255]);
  img.triangle(0, h, m, h, 0, h - m, [249, 115, 22, 255]);
  img.triangle(w, h, w - m, h, w, h - m, [132, 204, 22, 255]);
  if (caption) img.label(caption, w / 2, h - Math.max(14, h * 0.09), Math.max(2, Math.floor(Math.min(w, h) / 90)));
  return img;
}

function alphaImage() {
  const s = 256;
  const img = new Img(s, s);
  // Soft radial glow with alpha falloff.
  img.paint((x, y) => {
    const d = Math.hypot(x + 0.5 - 128, y + 0.5 - 128) / 128;
    return [99, 102, 241, Math.round(Math.max(0, 1 - d) ** 1.5 * 255)];
  });
  img.fillRect(24, 24, 80, 80, [244, 63, 94, 160]); // semi-transparent square
  img.circle(184, 184, 44, [16, 185, 129, 255]); // opaque disc
  img.ring(128, 128, 120, 4, [17, 24, 39, 255]);
  img.text("ALPHA", 128, 128, 6, [255, 255, 255, 255], "center");
  return img;
}

function tile32() {
  const img = new Img(32, 32, [241, 245, 249, 255]);
  img.fillRect(0, 0, 16, 16, [203, 213, 225, 255]);
  img.fillRect(16, 16, 16, 16, [203, 213, 225, 255]);
  img.circle(16, 16, 5, [79, 70, 229, 255]);
  img.fillRect(0, 0, 32, 1, [148, 163, 184, 255]);
  img.fillRect(0, 0, 1, 32, [148, 163, 184, 255]);
  return img;
}

function dot(size, color) {
  const img = new Img(size, size);
  img.circle(size / 2, size / 2, size / 2 - 1, color);
  return img;
}

function avatar(i, initials) {
  const s = 96;
  const bg = hsl((i * 57 + 15) % 360, 65, 55);
  const img = new Img(s, s, bg);
  img.circle(48, 38, 18, [255, 255, 255, 90]);
  img.circle(48, 104, 40, [255, 255, 255, 90]);
  img.text(initials, 48, 48, 4, [255, 255, 255, 255], "center");
  return img;
}

function product(i, size, tag) {
  const hue = (i * 45 + 200) % 360;
  const img = new Img(size, size, hsl(hue, 45, 92));
  const c = hsl(hue, 70, 50);
  const k = size / 240;
  const shape = i % 4;
  if (shape === 0) img.circle(120 * k, 108 * k, 62 * k, c);
  else if (shape === 1) img.fillRect(Math.round(58 * k), Math.round(46 * k), Math.round(124 * k), Math.round(124 * k), c);
  else if (shape === 2) img.triangle(120 * k, 40 * k, 190 * k, 172 * k, 50 * k, 172 * k, c);
  else {
    img.circle(90 * k, 108 * k, 46 * k, c);
    img.circle(150 * k, 108 * k, 46 * k, hsl((hue + 30) % 360, 70, 40, 220));
  }
  img.text(`P${i}`, 120 * k, 108 * k, Math.round(5 * k), [255, 255, 255, 255], "center");
  img.label(tag, 120 * k, 212 * k, Math.max(1, Math.round(2 * k)));
  return img;
}

function badge(w, h, text, bg) {
  const img = new Img(w, h, bg);
  img.ring(w / 2, h / 2, Math.min(w, h) / 2 - 4, 4, [255, 255, 255, 255]);
  img.text(text, w / 2, h / 2, Math.max(2, Math.floor(w / (text.length * 7 + 4))), [255, 255, 255, 255], "center");
  return img;
}

function frame(n, w, h) {
  const hues = [350, 140, 220];
  const img = new Img(w, h, hsl(hues[(n - 1) % 3], 70, 45));
  img.text(String(n), w / 2, h / 2 - h * 0.08, Math.floor(h / 14), [255, 255, 255, 255], "center");
  img.label(`FRAME ${n}`, w / 2, h - h * 0.15, Math.max(1, Math.floor(h / 60)));
  return img;
}

// ---------------------------------------------------------------- writers
function writePNG(name, img) {
  writeFileSync(join(OUT, name), encodePNG(img));
  written.push(name);
}
function tmpPNG(name, img) {
  const p = join(TMP, name);
  writeFileSync(p, encodePNG(img));
  return p;
}
function magick(args, outName, why) {
  if (!MAGICK) return void skipped.push(`${outName} (${why}: ImageMagick not found)`);
  try {
    execFileSync(MAGICK, [...args, join(OUT, outName)], { stdio: ["ignore", "ignore", "pipe"] });
    written.push(outName);
  } catch (e) {
    skipped.push(`${outName} (${why}: ${String(e.stderr || e.message).trim().split("\n")[0]})`);
  }
}

// Photos (opaque PNG) + srcset candidates
writePNG("photo-800x500.png", photo(800, 500, "800X500 PNG"));
writePNG("photo-400x250.png", photo(400, 250, "400W 1X", { hue: 200 }));
writePNG("photo-1600x1000.png", photo(1600, 1000, "1600W 2X", { hue: 260 }));
writePNG("portrait-400x600.png", photo(400, 600, "PORTRAIT", { hue: 170 }));
writePNG("photo-160x100.png", photo(160, 100, "", { hue: 20 }));
writePNG("alpha-256.png", alphaImage());
writePNG("tile-32.png", tile32());
writePNG("dot-24.png", dot(24, [236, 72, 153, 255]));
writePNG("check-16.png", (() => {
  const i = new Img(16, 16);
  i.triangle(2, 8, 6, 12, 6, 15, [255, 255, 255, 255]);
  return i;
})());
const INITIALS = ["AL", "BK", "CM", "DN", "EO", "FR"];
INITIALS.forEach((ini, i) => writePNG(`avatar-${i + 1}.png`, avatar(i, ini)));
for (let i = 1; i <= 8; i++) {
  writePNG(`product-${i}-240.png`, product(i, 240, "240 1X"));
  writePNG(`product-${i}-480.png`, product(i, 480, "480 2X"));
}
// Cross-origin / protected test images (served from all three origins).
writePNG("remote-b.png", badge(200, 120, "ORIGIN B", [37, 99, 235, 255]));
writePNG("remote-c.png", badge(200, 120, "ORIGIN C", [220, 38, 38, 255]));
writePNG("remote-bg.png", badge(120, 120, "BG", [124, 58, 237, 255]));
writePNG("protected.png", badge(200, 120, "PRIVATE", [5, 150, 105, 255]));
writePNG("poster-320x180.png", (() => {
  const i = new Img(320, 180, [30, 41, 59, 255]);
  i.triangle(140, 60, 140, 120, 192, 90, [255, 255, 255, 255]);
  i.label("POSTER", 160, 150, 2);
  return i;
})());

// JPEG (opaque photos), WebP, animated GIF, ICO via ImageMagick. -strip removes timestamps.
const jpg = (src, out) => magick([src, "-strip", "-sampling-factor", "4:2:0", "-quality", "85"], out, "JPEG");
jpg(tmpPNG("p.png", photo(800, 500, "800X500 JPG", { hue: 30 })), "photo-800x500.jpg");
jpg(tmpPNG("hero.png", photo(1600, 900, "HERO 1600X900", { hue: 235 })), "hero-1600x900.jpg");
magick([tmpPNG("w.png", photo(800, 500, "800X500 WEBP", { hue: 300 })), "-strip", "-quality", "80"], "photo-800x500.webp", "WebP");
magick([tmpPNG("wa.png", alphaImage()), "-strip", "-define", "webp:lossless=true"], "alpha-256.webp", "WebP");
magick(
  ["-delay", "60", "-loop", "0", ...[1, 2, 3].map((n) => tmpPNG(`f${n}.png`, frame(n, 120, 120))), "-strip"],
  "anim-120.gif",
  "GIF",
);
magick([tmpPNG("ico.png", dot(32, [79, 70, 229, 255])), "-strip"], "favicon.ico", "ICO");
skipped.push("AVIF (not attempted: no encoder in the ImageMagick build here; extractor must re-encode AVIF anyway)");

// Tiny WebM clip (VP8) for <video>: three 1-second frames.
if (FFMPEG) {
  for (const n of [1, 2, 3]) tmpPNG(`v${n}.png`, frame(n, 320, 180));
  try {
    execFileSync(FFMPEG, [
      "-y", "-loglevel", "error", "-framerate", "1", "-i", join(TMP, "v%d.png"),
      "-c:v", "libvpx", "-b:v", "150k", "-pix_fmt", "yuv420p", "-an",
      "-fflags", "+bitexact", "-flags:v", "+bitexact", "-map_metadata", "-1",
      join(OUT, "clip-320x180.webm"),
    ], { stdio: ["ignore", "ignore", "pipe"] });
    written.push("clip-320x180.webm");
  } catch (e) {
    skipped.push(`clip-320x180.webm (ffmpeg failed: ${String(e.stderr || e.message).split("\n")[0]})`);
  }
} else skipped.push("clip-320x180.webm (ffmpeg not found; <video> falls back to its poster)");

// ---------------------------------------------------------------- SVG files
const SVGS = {
  "icon-star.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill="#f59e0b" stroke="#b45309" stroke-width="1" stroke-linejoin="round"/>
</svg>
`,
  "icon-check.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#16a34a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10" stroke-width="2"/>
  <path d="M7 12.5l3.2 3.2L17 9"/>
</svg>
`,
  "logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 40" width="160" height="40">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <rect x="2" y="4" width="32" height="32" rx="9" fill="url(#lg)"/>
  <path d="M10 28V12l8 10 8-10v16" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <g fill="#111827">
    <rect x="44" y="13" width="6" height="16" rx="1"/>
    <rect x="54" y="13" width="16" height="6" rx="1"/>
    <rect x="54" y="23" width="12" height="6" rx="1"/>
    <rect x="74" y="13" width="6" height="16" rx="1"/>
    <rect x="84" y="13" width="16" height="16" rx="8"/>
    <rect x="104" y="13" width="6" height="16" rx="1"/>
    <rect x="114" y="13" width="16" height="6" rx="1"/>
  </g>
</svg>
`,
  "chart-text.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" width="240" height="140" font-family="sans-serif">
  <rect width="240" height="140" fill="#f8fafc"/>
  <g fill="#6366f1">
    <rect x="30" y="70" width="30" height="40"/>
    <rect x="80" y="40" width="30" height="70"/>
    <rect x="130" y="55" width="30" height="55"/>
    <rect x="180" y="25" width="30" height="85"/>
  </g>
  <line x1="20" y1="110" x2="225" y2="110" stroke="#334155" stroke-width="1"/>
  <g font-size="11" fill="#334155" text-anchor="middle">
    <text x="45" y="126">Q1</text><text x="95" y="126">Q2</text>
    <text x="145" y="126">Q3</text><text x="195" y="126">Q4</text>
  </g>
  <text x="120" y="16" font-size="12" font-weight="700" text-anchor="middle" fill="#0f172a">Revenue by quarter</text>
</svg>
`,
  "pattern-dots.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20">
  <circle cx="10" cy="10" r="3" fill="#94a3b8"/>
</svg>
`,
};
for (const [name, src] of Object.entries(SVGS)) {
  writeFileSync(join(OUT, name), src);
  written.push(name);
}

rmSync(TMP, { recursive: true, force: true });
console.log(`gen-images: wrote ${written.length} files to ${OUT}`);
for (const n of written) console.log(`  ${n}  (${(readFileSync(join(OUT, n)).length / 1024).toFixed(1)} KB)`);
if (skipped.length) {
  console.log("skipped:");
  for (const s of skipped) console.log(`  - ${s}`);
}
