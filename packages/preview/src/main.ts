/**
 * Local CaptureDocument preview (Fedora-friendly, no Figma, no server, no upload).
 * Same validation (validateCapture) and same render plan (buildPlan) as the Figma plugin; drawn with HTML/CSS.
 */
import { buildPlan, type RenderPlan } from '@h2f/figma-plugin/plan';
import { KNOWN_FIGMA_FONTS } from '@h2f/figma-plugin/known-figma-fonts';
import {
  parseCaptureJson,
  validateCapture,
  type CaptureDocument,
  type CaptureNode,
} from '@h2f/schema';
import { fontStylesheets, planCounts, renderPlanHtml } from './render.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $('canvas');
const viewport = $('viewport');
const stage = $('stage');

let doc: CaptureDocument | undefined;
let plan: RenderPlan | undefined;
let zoom = 1;
const nodeIndex = new Map<string, CaptureNode>();

function setList(id: string, rows: [string, string][]) {
  $(id).replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

function setItems(id: string, items: string[]) {
  $(id).replaceChildren(
    ...items.map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
}

function showErrors(lines: string[]) {
  $('errors').textContent = lines.join('\n\n');
  $('errors').hidden = false;
  $('empty').hidden = true;
  viewport.hidden = true;
  for (const id of ['docInfo', 'statsBox', 'fontsBox', 'warnBox', 'hoverBox']) $(id).hidden = true;
}

function countTypes(root: CaptureNode) {
  const c: Record<string, number> = { FRAME: 0, TEXT: 0, IMAGE: 0, SVG: 0 };
  nodeIndex.clear();
  const visit = (n: CaptureNode) => {
    c[n.type] = (c[n.type] ?? 0) + 1;
    nodeIndex.set(n.id, n);
    if (n.type === 'FRAME') n.children.forEach(visit);
  };
  visit(root);
  return c;
}

function applyZoom(next: number, anchor?: { x: number; y: number }) {
  if (!plan) return;
  const prev = zoom;
  zoom = Math.min(8, Math.max(0.05, next));
  const ax = anchor?.x ?? canvas.clientWidth / 2;
  const ay = anchor?.y ?? canvas.clientHeight / 2;
  const docX = (canvas.scrollLeft + ax - 24) / prev;
  const docY = (canvas.scrollTop + ay - 24) / prev;
  stage.style.transform = `scale(${zoom})`;
  viewport.style.width = `${plan.root.width * zoom}px`;
  viewport.style.height = `${plan.root.height * zoom}px`;
  canvas.scrollLeft = docX * zoom - ax + 24;
  canvas.scrollTop = docY * zoom - ay + 24;
  $('zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
}

/** Fit the document width into the canvas and go back to the top-left corner. */
function fitWidth() {
  if (!plan) return;
  applyZoom((canvas.clientWidth - 48) / plan.root.width);
  canvas.scrollLeft = 0;
  canvas.scrollTop = 0;
}

function loadFonts(p: RenderPlan) {
  document.querySelectorAll('link[data-h2f-font]').forEach((l) => l.remove());
  for (const href of fontStylesheets(p)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.h2fFont = '';
    document.head.append(link);
  }
}

export function load(text: string, fileName: string) {
  $('fileName').textContent = fileName;
  const parsed = parseCaptureJson(text);
  if (!parsed.ok) return showErrors(parsed.errors.map((e) => `${e.message}\n  at ${e.path}`));
  const result = validateCapture(parsed.value);
  if (!result.ok) {
    return showErrors([
      `${fileName} is not a valid CaptureDocument v1 (same check as the Figma plugin):`,
      ...result.errors.map((e) => `${e.message}\n  at ${e.path}`),
    ]);
  }
  doc = result.document;
  plan = buildPlan(doc, KNOWN_FIGMA_FONTS);
  loadFonts(plan);
  stage.innerHTML = renderPlanHtml(plan);
  stage.style.width = `${plan.root.width}px`;
  stage.style.height = `${plan.root.height}px`;
  $('errors').hidden = true;
  $('empty').hidden = true;
  viewport.hidden = false;

  const m = doc.meta;
  setList('docList', [
    ['Source', m.sourceUrl],
    ['Title', m.title || '—'],
    ['Captured', new Date(m.capturedAt).toLocaleString()],
    ['Direction', `${m.direction.toUpperCase()}${m.lang ? ` · ${m.lang}` : ''}`],
    ['Document', `${m.document.width} × ${m.document.height}`],
    ['Viewport', `${m.viewport.width} × ${m.viewport.height} @${m.devicePixelRatio}x`],
    ['Schema', `${doc.schemaVersion} (extractor ${m.extractorVersion})`],
    ['Size', `${(m.stats.bytes / 1024).toFixed(1)} KB`],
  ]);
  const types = countTypes(doc.root);
  const pc = planCounts(plan);
  setList('statsList', [
    ['Nodes', String(m.stats.nodeCount)],
    ['Frames', String(types.FRAME)],
    ['Text', String(types.TEXT)],
    ['Images', `${types.IMAGE} (placeholders)`],
    ['SVG', `${types.SVG} (placeholders)`],
    [
      'Rendered layers',
      `${pc.frame + pc.rect + pc.text + pc.placeholder} (${pc.frame} frames, ${pc.rect} rects, ${pc.text} text, ${pc.placeholder} placeholders)`,
    ],
  ]);
  setItems(
    'fontsList',
    plan.fonts.length
      ? [
          ...plan.fonts.map((f) => `${f.family} ${f.style}`),
          ...plan.substitutions.map(
            (s) =>
              `${s.arabicRule ? 'ℹ' : '⚠'} ${s.requested} ${s.weight}${s.italic ? ' italic' : ''} → ${s.used.family} ${s.used.style} (${s.count})`,
          ),
        ]
      : ['(no text)'],
  );
  setItems('warnList', [
    ...m.warnings.map((w) => `${w.code}: ${w.message}`),
    ...plan.unsupported.map((u) => `PLUGIN: ${u} not rendered yet`),
  ]);
  for (const id of ['docInfo', 'statsBox', 'fontsBox']) $(id).hidden = false;
  $('warnBox').hidden = m.warnings.length + plan.unsupported.length === 0;
  zoom = 1;
  fitWidth();
}

async function loadFile(file: File) {
  load(await file.text(), file.name); // read-only: File.text() never writes back
}

// ── Events ──────────────────────────────────────────────────────────────────────────────────────────────────────
$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void loadFile(f);
});
canvas.addEventListener('dragover', (e) => {
  e.preventDefault();
  canvas.classList.add('drop');
});
canvas.addEventListener('dragleave', () => canvas.classList.remove('drop'));
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  canvas.classList.remove('drop');
  const f = e.dataTransfer?.files[0];
  if (f) void loadFile(f);
});

$('zoomIn').addEventListener('click', () => applyZoom(zoom * 1.25));
$('zoomOut').addEventListener('click', () => applyZoom(zoom / 1.25));
$('zoom100').addEventListener('click', () => applyZoom(1));
$('zoomFit').addEventListener('click', () => fitWidth());
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
    });
  },
  { passive: false },
);
document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key === '+' || e.key === '=') applyZoom(zoom * 1.25);
  else if (e.key === '-') applyZoom(zoom / 1.25);
  else if (e.key === '0') applyZoom(1);
  else if (e.key === 'f' || e.key === 'F') fitWidth();
});

// Drag to pan.
let drag: { x: number; y: number; left: number; top: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  drag = { x: e.clientX, y: e.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
  canvas.classList.add('dragging');
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  canvas.scrollLeft = drag.left - (e.clientX - drag.x);
  canvas.scrollTop = drag.top - (e.clientY - drag.y);
});
window.addEventListener('pointerup', () => {
  drag = null;
  canvas.classList.remove('dragging');
});

$<HTMLInputElement>('showLabels').addEventListener('change', (e) =>
  stage.classList.toggle('no-labels', !(e.target as HTMLInputElement).checked),
);
$<HTMLInputElement>('showOutlines').addEventListener('change', (e) =>
  stage.classList.toggle('outlines', (e.target as HTMLInputElement).checked),
);

// Hover: show the layer's source node.
stage.addEventListener('mouseover', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.n');
  const n = el?.dataset.id ? nodeIndex.get(el.dataset.id) : undefined;
  if (!n) return;
  const rows: [string, string][] = [
    ['Name', n.name],
    ['Type', n.type],
    ['Rect', `x ${n.rect.x}, y ${n.rect.y}, ${n.rect.width} × ${n.rect.height}`],
  ];
  if (n.type === 'TEXT')
    rows.push(
      ['Text', n.characters.slice(0, 120)],
      ['Font', `${n.style.fontFamilies.join(', ')} ${n.style.fontWeight} ${n.style.fontSize}px`],
      ['Direction', n.style.direction],
    );
  setList('hoverList', rows);
  $('hoverBox').hidden = false;
});

// Test/automation hook (read-only access to what is shown).
(window as unknown as { __h2fPreview: unknown }).__h2fPreview = {
  get zoom() {
    return zoom;
  },
  get document() {
    return doc;
  },
  get plan() {
    return plan;
  },
};
