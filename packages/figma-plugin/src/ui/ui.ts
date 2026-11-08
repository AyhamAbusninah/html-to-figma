/** Plugin UI iframe: import (file / drag-drop / paste ≤ 5 MB), validate, preview, request render (PLG-I-1..3). */
import {
  parseCaptureJson,
  validateCapture,
  type CaptureDocument,
  type CaptureIssue,
} from '@h2f/schema';
import type { MainToUi, RenderReport, UiToMain } from '../shared/messages.ts';

const PASTE_MAX_BYTES = 5 * 1024 * 1024;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const toMain = (msg: UiToMain) => parent.postMessage({ pluginMessage: msg }, '*');

let loaded: CaptureDocument | undefined;

function setStatus(text: string) {
  $('status').textContent = text;
}

function showErrors(errors: CaptureIssue[]) {
  const box = $('errors');
  box.textContent = errors.map((e) => `${e.message}\n  at ${e.path}`).join('\n\n');
  box.hidden = false;
}

function load(text: string, sourceLabel: string) {
  $('errors').hidden = true;
  const parsed = parseCaptureJson(text);
  if (!parsed.ok) return showErrors(parsed.errors);
  const result = validateCapture(parsed.value);
  if (!result.ok) {
    setStatus(`${sourceLabel} is not a valid capture.`);
    return showErrors(result.errors);
  }
  loaded = result.document;
  const { meta } = loaded;
  $('pvTitle').textContent = meta.title || meta.sourceUrl;
  const rows: [string, string][] = [
    ['Source', meta.sourceUrl],
    ['Captured', new Date(meta.capturedAt).toLocaleString()],
    ['Document', `${meta.document.width} × ${meta.document.height}`],
    ['Direction', `${meta.direction.toUpperCase()}${meta.lang ? ` · ${meta.lang}` : ''}`],
    [
      'Nodes · images · vectors',
      `${meta.stats.nodeCount} · ${meta.stats.imageCount} · ${meta.stats.svgCount}`,
    ],
    ['Capture warnings', String(meta.warnings.length)],
    ['Schema', loaded.schemaVersion],
  ];
  $('pvStats').replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    }),
  );
  $('load').hidden = true;
  $('preview').hidden = false;
  setStatus('');
}

async function loadFile(file: File) {
  setStatus(`Reading ${file.name}…`);
  load(await file.text(), file.name);
}

const drop = $('drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = e.dataTransfer?.files[0];
  if (file) void loadFile(file);
});
$('file').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void loadFile(file);
});
$('parsePaste').addEventListener('click', () => {
  const text = ($('paste') as HTMLTextAreaElement).value;
  if (new Blob([text]).size > PASTE_MAX_BYTES) {
    showErrors([
      {
        code: 'SCHEMA',
        path: '/',
        message: 'Pasted JSON is larger than 5 MB. Use file import instead.',
      },
    ]);
  } else {
    load(text, 'Pasted JSON');
  }
});
$('reset').addEventListener('click', () => {
  loaded = undefined;
  $('preview').hidden = true;
  $('load').hidden = false;
  setStatus('');
});
$('render').addEventListener('click', () => {
  if (!loaded) return;
  setStatus('Rendering…');
  toMain({ type: 'render', document: loaded });
});

window.addEventListener('message', (event: MessageEvent<{ pluginMessage?: MainToUi }>) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;
  if (msg.type === 'progress') setStatus(msg.text);
  else if (msg.type === 'error') showErrors([{ code: 'SCHEMA', path: '/', message: msg.message }]);
  else if (msg.type === 'rendered') {
    const r = msg.report;
    setStatus(
      `Created "${r.rootName}": ${r.layersCreated} layer(s), ${r.layersFailed.length} failed, ${r.durationMs} ms.`,
    );
    showReport(r);
  }
});

/** Render report details (PLG-RP-1): failures, font substitutions, placeholders, unsupported features. */
function showReport(r: RenderReport) {
  const lines: string[] = [];
  for (const f of r.layersFailed) lines.push(`✗ ${f.path}: ${f.error}`);
  for (const s of r.fontSubstitutions ?? []) {
    const req = `${s.requested} ${s.weight}${s.italic ? ' italic' : ''}`;
    lines.push(
      `${s.arabicRule ? 'ℹ' : '⚠'} Font ${req} → ${s.used.family} ${s.used.style} (${s.count} layer(s))`,
    );
  }
  for (const f of r.fontsFallback ?? [])
    lines.push(
      `⚠ Could not load ${f.requested.family} ${f.requested.style} → ${f.used.family} ${f.used.style}`,
    );
  if (r.placeholders)
    lines.push(`⚠ ${r.placeholders} placeholder(s) for content not captured yet (images/SVG)`);
  for (const u of r.unsupported ?? []) lines.push(`⚠ Not rendered yet: ${u}`);
  if (r.captureWarnings)
    lines.push(`ℹ ${r.captureWarnings} capture warning(s) recorded in the file (meta.warnings)`);
  const box = $('details');
  box.textContent = lines.join('\n');
  box.hidden = lines.length === 0;
}
