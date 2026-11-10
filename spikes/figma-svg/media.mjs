/**
 * Phase 1 Figma spike: what does Figma's SVG import do with images, icons and gradients, and how big can a pasted
 * SVG be? Writes out/media.json (one test board + three size tests) for media.html. Images are the repo's own
 * generated fixture images; size tests use random-noise JPEGs (python3 + Pillow) so they can't compress.
 * Run: node spikes/figma-svg/media.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const img = (name) => readFileSync(join(repo, 'fixtures/assets/img', name)).toString('base64');
const photo = `data:image/jpeg;base64,${img('photo-800x500.jpg')}`;
const avatar = `data:image/png;base64,${img('avatar-1.png')}`;
const alpha = `data:image/png;base64,${img('alpha-256.png')}`;
const inner = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const star = inner(readFileSync(join(repo, 'fixtures/assets/img/icon-star.svg'), 'utf8'));
const logo = inner(readFileSync(join(repo, 'fixtures/assets/img/logo.svg'), 'utf8')).replace(/id="lg"/, 'id="logo_lg"').replace(/url\(#lg\)/g, 'url(#logo_lg)');

const label = (x, y, t) =>
  `<text font-family="Inter-SemiBold, Inter" font-size="13" font-weight="600" fill="rgb(17,24,39)" xml:space="preserve"><tspan x="${x}" y="${y}">${t}</tspan></text>`;
const cell = (col, row) => [40 + col * 300, 60 + row * 260];

// Each case: a label + content inside a 260x200 cell. Layer ids say what is being tested.
const parts = [];
const defs = [];
let [x, y] = cell(0, 0);
parts.push(label(x, y - 14, 'A · image (data URI)'), `<image id="A_image_plain" x="${x}" y="${y}" width="260" height="162" preserveAspectRatio="none" href="${photo}"/>`);
[x, y] = cell(1, 0);
defs.push(`<image id="imgB" width="80" height="80" preserveAspectRatio="none" href="${avatar}"/>`);
parts.push(label(x, y - 14, 'B · same image reused (use ×3)'), ...[0, 90, 180].map((d, i) => `<use id="B_use_${i + 1}" href="#imgB" x="${x + d}" y="${y}"/>`));
[x, y] = cell(2, 0);
defs.push(`<pattern id="pC" patternUnits="objectBoundingBox" width="1" height="1"><image width="260" height="162" preserveAspectRatio="xMidYMid slice" href="${photo}"/></pattern>`);
parts.push(label(x, y - 14, 'C · pattern fill, rounded rect'), `<rect id="C_pattern_rounded" x="${x}" y="${y}" width="260" height="162" rx="16" fill="url(#pC)"/>`);
[x, y] = cell(3, 0);
defs.push(`<clipPath id="cD"><circle cx="${x + 50}" cy="${y + 50}" r="50"/></clipPath>`);
parts.push(label(x, y - 14, 'D · circle-clipped avatar'), `<image id="D_clip_circle" x="${x}" y="${y}" width="100" height="100" clip-path="url(#cD)" href="${avatar}"/>`);
[x, y] = cell(0, 1);
parts.push(label(x, y - 14, 'E · nested svg icons'), `<svg id="E_icon_star" x="${x}" y="${y}" width="48" height="48" viewBox="0 0 24 24">${star}</svg>`, `<svg id="E_logo" x="${x + 70}" y="${y + 4}" width="160" height="40" viewBox="0 0 160 40">${logo}</svg>`);
[x, y] = cell(1, 1);
defs.push(`<linearGradient id="gF" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(99,102,241)"/><stop offset="0.5" stop-color="rgb(236,72,153)" stop-opacity="0.8"/><stop offset="1" stop-color="rgb(245,158,11)"/></linearGradient>`);
parts.push(label(x, y - 14, 'F · linear gradient (135°, 3 stops)'), `<rect id="F_linear_gradient" x="${x}" y="${y}" width="260" height="162" rx="12" fill="url(#gF)"/>`);
[x, y] = cell(2, 1);
defs.push(`<radialGradient id="gG" gradientUnits="objectBoundingBox" cx="0.3" cy="0.3" r="0.8"><stop offset="0" stop-color="rgb(255,255,255)"/><stop offset="1" stop-color="rgb(37,99,235)"/></radialGradient>`);
parts.push(label(x, y - 14, 'G · radial gradient'), `<rect id="G_radial_gradient" x="${x}" y="${y}" width="260" height="162" rx="12" fill="url(#gG)"/>`);
[x, y] = cell(3, 1);
parts.push(label(x, y - 14, 'H · Arabic text over an image'), `<g id="H_text_over_image"><image x="${x}" y="${y}" width="260" height="162" preserveAspectRatio="none" href="${photo}"/><text font-family="Tajawal-Bold, Tajawal" font-size="24" font-weight="700" fill="rgb(255,255,255)" text-anchor="end" xml:space="preserve"><tspan x="${x + 244}" y="${y + 40}">عنوان فوق الصورة</tspan></text></g>`);
[x, y] = cell(0, 2);
parts.push(label(x, y - 14, 'I · image "cover" (slice) in a wide box'), `<image id="I_image_cover" x="${x}" y="${y}" width="260" height="100" preserveAspectRatio="xMidYMid slice" href="${photo}"/>`);
[x, y] = cell(1, 2);
parts.push(label(x, y - 14, 'J · PNG with transparency + opacity 0.5'), `<rect x="${x}" y="${y}" width="128" height="128" fill="rgb(254,243,199)"/><image id="J_alpha_png" x="${x}" y="${y}" width="128" height="128" href="${alpha}"/><image id="J_alpha_png_half" x="${x + 140}" y="${y}" width="100" height="100" opacity="0.5" href="${alpha}"/>`);

const board =
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1240" height="800" viewBox="0 0 1240 800"><defs>${defs.join('')}</defs>` +
  `<rect id="Background" x="0" y="0" width="1240" height="800" fill="rgb(255,255,255)"/>${parts.join('')}</svg>`;

/** Size test: a grid of incompressible noise JPEGs adding up to about `mb` megabytes of base64. */
function sizeTest(mb) {
  const per = 470_000; // one 700x700 noise JPEG (q92) ≈ 470 KB, ×4/3 in base64
  const n = Math.max(1, Math.round((mb * 1024 * 1024) / ((per * 4) / 3)));
  const py = `import io,os,base64,sys
from PIL import Image
n=int(sys.argv[1])
for i in range(n):
    im=Image.frombytes('RGB',(700,700),os.urandom(700*700*3))
    b=io.BytesIO(); im.save(b,'JPEG',quality=92); sys.stdout.write(base64.b64encode(b.getvalue()).decode()+'\\n')`;
  const b64s = execFileSync('python3', ['-I', '-c', py, String(n)], { maxBuffer: 1 << 30 }).toString().trim().split('\n');
  const cols = Math.ceil(Math.sqrt(n));
  const imgs = b64s.map((b, i) => `<image id="noise_${i + 1}" x="${(i % cols) * 210}" y="${Math.floor(i / cols) * 210 + 40}" width="200" height="200" preserveAspectRatio="none" href="data:image/jpeg;base64,${b}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * 210}" height="${Math.ceil(n / cols) * 210 + 40}"><rect id="Background" width="100%" height="100%" fill="rgb(255,255,255)"/>${label(0, 24, `Size test ~${mb} MB, ${n} images`)}${imgs.join('')}</svg>`;
}

const cases = [{ id: 'media-board', label: 'Images, icons and gradients board (cases A–J)', svg: board }];
for (const mb of [2, 8, 25]) cases.push({ id: `size-${mb}mb`, label: `Paste size test ~${mb} MB`, svg: sizeTest(mb) });
writeFileSync(join(out, 'media.json'), JSON.stringify(cases));
for (const c of cases) console.log(`${c.id}: ${(c.svg.length / 1024 / 1024).toFixed(2)} MB`);
